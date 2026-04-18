import { unlink } from "fs/promises"
import path from "path"
import { YoutubeTranscript } from "youtube-transcript"
import { v4 as uuidv4 } from "uuid"
import pLimit from "p-limit"
import { downloadYoutubeVideo } from "../../utils/youtube.downloader"
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

export async function runClipJob(jobId: string): Promise<void> {
  await pruneStaleJobs()

  let job = await loadJob(jobId)
  if (!job || job.status !== "queued") {
    return
  }

  job.status = "ingesting"
  job.clipJobStage = "ingesting"
  job.progress = 3
  job.message =
    job.params.source === "youtube"
      ? "Downloading from YouTube…"
      : "Preparing uploaded source…"
  await saveJob(job)

  const requestId = job.requestId
  let videoPath: string | null = job.sourceVideoPath ?? null
  let cleanupPath: string | null = videoPath

  try {
    if (!videoPath && job.params.source === "youtube" && job.params.youtubeUrl) {
      videoPath = await downloadYoutubeVideo(job.params.youtubeUrl)
      cleanupPath = videoPath
      await patchJob(jobId, (j) => {
        j.sourceVideoPath = videoPath!
        j.progress = 12
        j.message = "Download complete. Starting analysis…"
      })
    }

    if (!videoPath) {
      throw new ClipInputError("No video source available for this job.", 400)
    }

    let youtubeTranscript: YoutubeTranscriptLine[] | null = null
    if (
      job.params.captionsEnabled &&
      job.params.source === "youtube" &&
      job.params.youtubeUrl
    ) {
      try {
        youtubeTranscript = await YoutubeTranscript.fetchTranscript(
          job.params.youtubeUrl
        )
      } catch {
        youtubeTranscript = null
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
    if (cleanupPath) {
      await unlink(cleanupPath).catch(() => {})
    }
  }
}

export function createJobId(): string {
  return uuidv4()
}
