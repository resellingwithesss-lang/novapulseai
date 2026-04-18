import { existsSync } from "fs"
import { unlink } from "fs/promises"
import path from "path"
import { YoutubeTranscript } from "youtube-transcript"
import { v4 as uuidv4 } from "uuid"
import pLimit from "p-limit"
import {
  cleanupYoutubeDownload,
  downloadYoutubeVideo,
} from "../../utils/youtube.downloader"
import { assertFfmpegAvailable } from "../../lib/ffmpeg-binaries"
import {
  ClipInputError,
  generateClips,
  summarizeClipQualitySignals,
} from "./clip.service"
import {
  listRecoverableJobIds,
  loadJob,
  pruneStaleJobs,
  saveJob,
} from "./clip.job.store"
import type {
  ClipJobRecord,
  ClipJobStage,
  ClipPipelineProgressEvent,
} from "./clip.job.types"
import type { ClipSourceType, YoutubeTranscriptLine } from "./types/clip.types"
import { logToolEvent } from "../../lib/tool-logger"
import { log, serializeErr } from "../../lib/logger"

const scheduled = new Set<string>()
const clipWorkerLimit = Math.max(
  1,
  Number(process.env.CLIP_JOB_CONCURRENCY ?? "2") || 2
)
const runLimited = pLimit(clipWorkerLimit)

function mergePipelineProgress(evt: ClipPipelineProgressEvent): {
  clipJobStage: ClipJobStage
  progress: number
  message: string
} {
  const f = Math.max(0, Math.min(1, evt.fraction))
  const msg = evt.message || ""
  switch (evt.kind) {
    case "analyzing":
      return {
        clipJobStage: "analyzing",
        progress: Math.round(8 + 22 * f),
        message: msg || "Analyzing video structure…",
      }
    case "selecting_moments":
      return {
        clipJobStage: "selecting_moments",
        progress: Math.round(30 + 12 * f),
        message: msg || "Selecting highlight windows…",
      }
    case "trimming":
      return {
        clipJobStage: "trimming",
        progress: Math.round(42 + 26 * f),
        message:
          msg ||
          (evt.clipTotal
            ? `Trimming clip ${(evt.clipIndex ?? 0) + 1}/${evt.clipTotal}…`
            : "Trimming clips…"),
      }
    case "captioning":
      return {
        clipJobStage: "captioning",
        progress: Math.round(68 + 18 * f),
        message:
          msg ||
          (evt.clipTotal
            ? `Caption track ${(evt.clipIndex ?? 0) + 1}/${evt.clipTotal}…`
            : "Generating captions…"),
      }
    case "finalizing":
      return {
        clipJobStage: "finalizing",
        progress: Math.round(86 + 13 * f),
        message: msg || "Packaging outputs…",
      }
    default:
      return { clipJobStage: "analyzing", progress: 12, message: msg }
  }
}

export function scheduleClipJob(jobId: string): void {
  if (scheduled.has(jobId)) return
  scheduled.add(jobId)
  setImmediate(() => {
    void runLimited(() => runClipJob(jobId))
      .catch((err) => {
        log.error("clip_job_unhandled_rejection", {
          jobId,
          ...serializeErr(err),
        })
      })
      .finally(() => {
        scheduled.delete(jobId)
      })
  })
}

export async function recoverPendingClipJobs(): Promise<void> {
  const recoverableJobIds = await listRecoverableJobIds()
  if (recoverableJobIds.length === 0) return
  for (const jobId of recoverableJobIds) {
    scheduleClipJob(jobId)
  }
  log.info("clip_job_recovery_scheduled", {
    count: recoverableJobIds.length,
    concurrency: clipWorkerLimit,
  })
}

async function patchJob(
  jobId: string,
  mutator: (job: ClipJobRecord) => void
): Promise<ClipJobRecord | null> {
  const job = await loadJob(jobId)
  if (!job) return null
  mutator(job)
  await saveJob(job)
  return job
}

/**
 * Statuses a job can have when `runClipJob` starts. `queued` is the normal
 * entry point; the rest are recovery entry points (the process crashed or was
 * redeployed mid-job and the job record is still on disk).
 */
const RUNNABLE_CLIP_JOB_STATUSES = new Set<ClipJobRecord["status"]>([
  "queued",
  "ingesting",
  "analyzing",
  "selecting_moments",
  "trimming",
  "captioning",
  "finalizing",
])

export async function runClipJob(jobId: string): Promise<void> {
  await pruneStaleJobs()

  let job = await loadJob(jobId)
  if (!job || !RUNNABLE_CLIP_JOB_STATUSES.has(job.status)) {
    return
  }
  const isResumed = job.status !== "queued"
  if (isResumed) {
    log.info("clip_job_resuming", {
      jobId,
      requestId: job.requestId,
      previousStatus: job.status,
      hadSourceVideoPath: Boolean(job.sourceVideoPath),
    })
    // Temp dirs (both the YouTube download and the uploaded-source dir) do not
    // survive container restarts on most deploys. If the recorded source file
    // is gone, clear it so either (a) the YouTube re-download path takes over,
    // or (b) the upload path fails fast below with a clear message.
    if (job.sourceVideoPath && !existsSync(job.sourceVideoPath)) {
      log.warn("clip_job_resume_source_missing", {
        jobId,
        requestId: job.requestId,
        missingPath: job.sourceVideoPath,
        source: job.params.source,
      })
      delete job.sourceVideoPath
    }
  }

  job.status = "ingesting"
  job.clipJobStage = "ingesting"
  job.progress = 3
  // First-class server-managed YouTube ingest: we download the source
  // ourselves and feed it into the pipeline exactly like an uploaded file.
  // Surface that explicitly in the job message so the client UI can show the
  // actual work being done instead of a generic "ingesting" state.
  job.message =
    job.params.source === "youtube"
      ? isResumed
        ? "Resuming: re-downloading YouTube source on the server…"
        : "Downloading YouTube source on the server…"
      : isResumed
        ? "Resuming: re-checking uploaded source…"
        : "Preparing uploaded source…"
  await saveJob(job)

  const requestId = job.requestId
  let videoPath: string | null = job.sourceVideoPath ?? null
  /**
   * True whenever this run owns a YouTube temp dir and is responsible for its
   * cleanup at exit — either because we just downloaded it, or because we
   * resumed a youtube job whose prior temp dir still exists. In both cases
   * `cleanupYoutubeDownload` is safe to call (it prefix-guards the path).
   */
  let ownsYoutubeTempDir = job.params.source === "youtube" && Boolean(videoPath)
  /** For uploaded sources: the file the processor is responsible for deleting. */
  let uploadedSourceToDelete: string | null =
    job.params.source === "upload" ? videoPath : null

  try {
    // Fail fast with an operator-actionable error if ffmpeg is clearly absent.
    // Cheaper than discovering ENOENT mid-pipeline after a YouTube download
    // already succeeded.
    try {
      assertFfmpegAvailable()
    } catch (ffErr) {
      throw new ClipInputError(
        ffErr instanceof Error ? ffErr.message : "ffmpeg is not available on this host.",
        500
      )
    }

    if (!videoPath && job.params.source === "youtube" && job.params.youtubeUrl) {
      // Server-managed ingest: yt-dlp runs the full 5-attempt format ladder
      // with SSRF re-validation, optional operator cookies, and isolated
      // per-job temp dirs. Only true non-recoverable failures throw here; the
      // catch block below turns those into the user-safe, UI-classifiable
      // messages in `youtube.downloader.ts` (see `classifyYoutubeDlError`).
      videoPath = await downloadYoutubeVideo(job.params.youtubeUrl)
      ownsYoutubeTempDir = true
      await patchJob(jobId, (j) => {
        j.sourceVideoPath = videoPath!
        j.progress = 12
        j.message = "YouTube source downloaded on the server. Starting analysis…"
      })
    }

    if (!videoPath) {
      throw new ClipInputError(
        job.params.source === "upload"
          ? "Uploaded source file is no longer available (likely cleared by a restart). Please re-upload."
          : "No video source available for this job.",
        400
      )
    }

    let youtubeTranscript: YoutubeTranscriptLine[] | null = null
    if (
      job.params.captionsEnabled &&
      job.params.source === "youtube" &&
      job.params.youtubeUrl
    ) {
      try {
        const raw = await YoutubeTranscript.fetchTranscript(
          job.params.youtubeUrl
        )
        // youtube-transcript may return non-array on unexpected response shapes;
        // guard so downstream subtitle code doesn't explode on `.map`.
        youtubeTranscript = Array.isArray(raw) && raw.length > 0 ? raw : null
        if (youtubeTranscript == null) {
          log.info("clip_job_youtube_transcript_empty", {
            jobId,
            requestId,
            rawType: Array.isArray(raw) ? "empty_array" : typeof raw,
          })
        }
      } catch (err) {
        youtubeTranscript = null
        // Not fatal — the pipeline falls back to whisper. Log so operators can
        // spot systemic transcript failures instead of diagnosing by user
        // reports of missing captions.
        log.warn("clip_job_youtube_transcript_failed", {
          jobId,
          requestId,
          ...serializeErr(err),
        })
      }
    }

    const sourceType: ClipSourceType =
      job.params.source === "youtube" ? "youtube" : "upload"

    const { clips, partial, requestedClips } = await generateClips(
      {
        videoPath,
        clips: job.params.clips,
        platform: job.params.platform,
        subtitleStyle: job.params.subtitleStyle,
        targetClipDurationSec: job.params.targetClipDurationSec,
        captionsEnabled: job.params.captionsEnabled,
        captionMode: job.params.captionMode,
        sourceType,
        youtubeUrl: job.params.youtubeUrl ?? null,
        youtubeTranscript,
      },
      { requestId },
      {
        onProgress: async (evt) => {
          const u = mergePipelineProgress(evt)
          await patchJob(jobId, (j) => {
            j.clipJobStage = u.clipJobStage
            j.progress = u.progress
            j.message = u.message
          })
        },
      }
    )

    const qualitySignals = summarizeClipQualitySignals(clips)

    await patchJob(jobId, (j) => {
      j.status = "completed"
      j.clipJobStage = "completed"
      j.progress = 100
      j.message = partial
        ? `Delivered ${clips.length} of ${requestedClips} clips (best fit for this source).`
        : `Delivered ${clips.length} clips.`
      j.result = {
        clipItems: clips,
        partial,
        requestedClips,
        generatedClips: clips.length,
        targetClipDurationSec: j.params.targetClipDurationSec,
        qualitySignals,
      }
      delete j.sourceVideoPath
    })

    logToolEvent("info", {
      tool: "clip",
      requestId,
      stage: "job",
      status: "completed",
      jobId,
      clipCount: clips.length,
    })
  } catch (err) {
    const message =
      err instanceof ClipInputError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Clip job failed"
    const code = err instanceof ClipInputError ? "TOO_SHORT" : "INTERNAL_ERROR"
    const httpStatus = err instanceof ClipInputError ? err.status : 500

    await patchJob(jobId, (j) => {
      j.status = "failed"
      j.clipJobStage = "failed"
      j.progress = 0
      j.message = message
      j.error = { code, message, httpStatus }
      delete j.sourceVideoPath
    })

    logToolEvent("error", {
      tool: "clip",
      requestId,
      stage: "job",
      status: "failed",
      jobId,
      message,
    })

    if (
      job.params.source === "youtube" &&
      /youtube|blocked|cookie|bot|javascript runtime|upload the video|server-side download/i.test(
        message
      )
    ) {
      log.info("clip_job_youtube_operator_hint", {
        jobId,
        requestId,
        messagePreview: message.slice(0, 240),
        operatorNote:
          "YouTube from servers: mount Netscape cookies.txt and set the operator cookies env (see docs/YOUTUBE_CLIPPER_OPERATORS.md). Creators can upload the MP4 for guaranteed processing. Datacenter IPs are still sometimes blocked even with cookies.",
      })
    }
  } finally {
    // For YouTube downloads: remove the ENTIRE `tmp/yt_job_<id>/` directory,
    // not just the `.mp4` — fragments, .part files, thumbnails, nfo, and
    // subtitle sidecars all live in that dir and were previously leaked on
    // every successful job. `cleanupYoutubeDownload` guards against touching
    // anything outside the expected prefix.
    if (ownsYoutubeTempDir && videoPath) {
      await cleanupYoutubeDownload(videoPath)
    }
    if (uploadedSourceToDelete) {
      await unlink(uploadedSourceToDelete).catch(() => {})
    }
  }
}

export function createJobId(): string {
  return uuidv4()
}
