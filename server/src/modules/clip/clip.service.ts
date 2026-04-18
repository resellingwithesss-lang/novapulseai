import { mkdir, rename, unlink } from "fs/promises"
import path from "path"
import { detectScenes } from "./engine/scene.detector"
import { generateClip } from "./engine/clipper.engine"
import { applyCaptionsToClip } from "./engine/subtitle.generator"
import type { ClipPipelineProgressEvent } from "./clip.job.types"
import type {
  ClipCandidate,
  ClipCaptionSource,
  ClipCaptionStatus,
  ClipRequest,
  ClipResult,
} from "./types/clip.types"
import { validateClipDurationGuardrail } from "./clip.guardrails"

type ClipRunContext = {
  requestId?: string
}

export type GenerateClipsOptions = {
  onProgress?: (e: ClipPipelineProgressEvent) => void | Promise<void>
}

export class ClipInputError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

function mapGenSourceToClipSource(src: string): ClipCaptionSource {
  if (src === "youtube_transcript") return "youtube_transcript"
  if (src === "whisper") return "whisper"
  if (src === "unavailable") return "unavailable"
  return "none"
}

function clampCandidateToTarget(
  clip: ClipCandidate,
  targetSec: number,
  videoDuration: number
): ClipCandidate {
  const room = Math.max(0, videoDuration - clip.start)
  if (room < 1) {
    return clip
  }
  const span = Math.min(Math.max(5, targetSec), room)
  const end = clip.start + span
  return {
    ...clip,
    end,
    durationSec: Number((end - clip.start).toFixed(2)),
  }
}

function timelineBeat(start: number, videoDuration: number): string {
  if (videoDuration <= 0) return "Segment"
  const r = start / videoDuration
  if (r < 0.22) return "Cold open"
  if (r < 0.5) return "Mid build"
  if (r < 0.78) return "Rising beat"
  return "Late payoff"
}

function buildClipTitle(
  index: number,
  labels: string[],
  start: number,
  videoDuration: number
): string {
  const hook = labels[0]?.replace(/_/g, " ") ?? "highlight"
  return `Clip ${index + 1} · ${timelineBeat(start, videoDuration)} · ${hook}`
}

function buildClipSummary(
  labels: string[],
  durationSec: number,
  score: number
): string {
  const bits = labels.slice(0, 2).map((l) => l.replace(/_/g, " "))
  const tail = bits.length ? bits.join(" · ") : "Balanced cut"
  return `${tail} · ${durationSec.toFixed(1)}s · score ${Math.round(score)}`
}

function formatTimestampLabel(startSec: number, endSec: number): string {
  const fmt = (t: number) => {
    const s = Math.max(0, Math.floor(t))
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
  }
  return `${fmt(startSec)}–${fmt(endSec)}`
}

export function summarizeClipQualitySignals(
  result: Array<{ reasonLabels: string[]; score: number }>
) {
  const labels = new Set<string>()
  let highestScore = 0
  for (const clip of result) {
    highestScore = Math.max(highestScore, clip.score)
    for (const label of clip.reasonLabels.slice(0, 2)) {
      labels.add(label)
    }
  }
  if (highestScore >= 85) labels.add("high_confidence_moments")
  if (labels.size === 0) labels.add("balanced_segments")
  return Array.from(labels).slice(0, 6)
}

export const generateClips = async (
  req: ClipRequest,
  context: ClipRunContext = {},
  options: GenerateClipsOptions = {}
) => {
  const requestId = context.requestId ?? "unknown_request_id"
  const startedAt = Date.now()
  const report = options.onProgress

  const r = async (e: ClipPipelineProgressEvent) => {
    if (report) await report(e)
  }

  console.info("CLIP_STAGE", {
    requestId,
    stage: "pipeline",
    status: "start",
    requestedClips: req.clips,
    platform: req.platform,
    targetClipDurationSec: req.targetClipDurationSec,
    captionsEnabled: req.captionsEnabled,
    sourceType: req.sourceType,
  })

  await r({
    kind: "analyzing",
    fraction: 0,
    message: "Reading duration and keyframes…",
  })

  const detection = await detectScenes(req.videoPath, {
    requestId,
    platform: req.platform,
    desiredClips: req.clips,
    targetClipDurationSec: req.targetClipDurationSec,
  })

  await r({
    kind: "analyzing",
    fraction: 1,
    message: `Analyzed ${detection.durationSec.toFixed(1)}s source.`,
  })

  const durationGuardrail = validateClipDurationGuardrail({
    durationSec: detection.durationSec,
    requestedClips: req.clips,
    minClipDurationSec: detection.minClipDurationSec,
  })
  if (!durationGuardrail.allowed) {
    throw new ClipInputError(
      `Source video is too short for ${req.clips} clips at ~${req.targetClipDurationSec}s each. Need about ${durationGuardrail.minimumSourceDuration}s of footage, or fewer clips / a shorter target length.`
    )
  }

  await r({
    kind: "selecting_moments",
    fraction: 0,
    message: "Selecting strong, spaced moments…",
  })

  const minGapSec = Math.max(2.5, Math.min(14, req.targetClipDurationSec * 0.22))
  const selectedRaw = selectTopNonOverlappingSegments(
    detection.candidates,
    req.clips,
    minGapSec
  )
  if (selectedRaw.length === 0) {
    throw new ClipInputError(
      "Could not identify strong moments in this video. Try a longer file, a different platform preset, or a different clip length."
    )
  }

  const take = Math.min(req.clips, selectedRaw.length)
  const selected = selectedRaw
    .slice(0, take)
    .map((c) =>
      clampCandidateToTarget(c, req.targetClipDurationSec, detection.durationSec)
    )

  await r({
    kind: "selecting_moments",
    fraction: 1,
    message: `Locked ${selected.length} segments (min gap ${minGapSec.toFixed(1)}s).`,
  })

  const clipsDir = path.join(process.cwd(), "clips")
  await mkdir(clipsDir, {
    recursive: true,
  })

  const outputs: ClipResult[] = []
  let fullyFailedCount = 0
  const lastClipFailures: string[] = []
  const n = selected.length

  for (let i = 0; i < selected.length; i++) {
    const clip = selected[i]
    const baseName = `clip_${Date.now()}_${i}`
    const rawFileName = `${baseName}_raw.mp4`
    const finalFileName = `${baseName}.mp4`
    const rawOutput = path.join(clipsDir, rawFileName)
    const finalOutput = path.join(clipsDir, finalFileName)

    try {
    await r({
      kind: "trimming",
      fraction: n > 0 ? i / n : 1,
      clipIndex: i,
      clipTotal: n,
      message: `Trimming clip ${i + 1} of ${n}…`,
    })

    await runClipRenderWithRetry(
      () =>
        generateClip(
          req.videoPath,
          clip.start,
          clip.end,
          req.platform,
          rawOutput,
          {
            requestId,
            clipIndex: i,
            totalClips: selected.length,
          }
        ),
      requestId,
      i
    )

    await r({
      kind: "trimming",
      fraction: (i + 1) / n,
      clipIndex: i,
      clipTotal: n,
      message: `Encoded clip ${i + 1} of ${n}.`,
    })

    let publicPath = `/clips/${finalFileName}`
    let filePath = finalOutput
    let captionStatus: ClipCaptionStatus = req.captionsEnabled
      ? "skipped_empty"
      : "skipped_disabled"
    let captionSource: ClipCaptionSource = "none"
    let captionNote: string | undefined
    let subtitlePublicPath: string | undefined

    if (req.captionsEnabled) {
      await r({
        kind: "captioning",
        fraction: n > 0 ? i / n : 1,
        clipIndex: i,
        clipTotal: n,
        message: `Captions for clip ${i + 1} of ${n}…`,
      })

      const cap = await applyCaptionsToClip({
        clippedVideoPath: rawOutput,
        outputVideoPath: finalOutput,
        style: req.subtitleStyle,
        platform: req.platform,
        clipStartInSource: clip.start,
        clipEndInSource: clip.end,
        youtubeTranscript: req.youtubeTranscript,
        captionsEnabled: true,
        captionMode: req.captionMode,
        clipsDir,
        baseName,
      })

      captionSource = mapGenSourceToClipSource(cap.captionSource)

      if (cap.status === "burned_in") {
        captionStatus = "burned_in"
        await unlink(rawOutput).catch(() => {})
        if (cap.srtPath) {
          subtitlePublicPath = `/clips/${path.basename(cap.srtPath)}`
        }
      } else if (cap.status === "srt_only") {
        captionStatus = "srt_only"
        try {
          await rename(rawOutput, finalOutput)
        } catch {
          await unlink(rawOutput).catch(() => {})
          throw new ClipInputError("Could not finalize clip after SRT export.", 500)
        }
        if (cap.srtPath) {
          subtitlePublicPath = `/clips/${path.basename(cap.srtPath)}`
        }
      } else {
        try {
          await rename(rawOutput, finalOutput)
        } catch {
          await unlink(rawOutput).catch(() => {})
          throw new ClipInputError("Could not finalize clip file after caption step.", 500)
        }
        captionStatus = cap.status
        captionNote = cap.note
        if (cap.srtPath) {
          subtitlePublicPath = `/clips/${path.basename(cap.srtPath)}`
        }
      }

      await r({
        kind: "captioning",
        fraction: (i + 1) / n,
        clipIndex: i,
        clipTotal: n,
        message: `Caption pass done for clip ${i + 1}.`,
      })
    } else {
      await rename(rawOutput, finalOutput).catch(async () => {
        await unlink(rawOutput).catch(() => {})
      })
      captionStatus = "skipped_disabled"
      captionSource = "none"
    }

    const startSec = Number(clip.start.toFixed(2))
    const endSec = Number(clip.end.toFixed(2))

    outputs.push({
      index: i,
      startSec,
      endSec,
      durationSec: Number((clip.end - clip.start).toFixed(2)),
      platform: req.platform,
      subtitleStyle: req.subtitleStyle,
      score: clip.score,
      reasonLabels: clip.reasonLabels,
      fileName: finalFileName,
      filePath,
      publicPath,
      sourceType: req.sourceType,
      targetClipDurationSec: req.targetClipDurationSec,
      title: buildClipTitle(i, clip.reasonLabels, clip.start, detection.durationSec),
      summary: buildClipSummary(
        clip.reasonLabels,
        clip.end - clip.start,
        clip.score
      ),
      timestampRangeLabel: formatTimestampLabel(startSec, endSec),
      captionsEnabled: req.captionsEnabled,
      captionStatus,
      captionSource,
      captionNote,
      subtitlePublicPath,
    })
    } catch (perClipErr) {
      // A single clip failing should NOT lose the clips we already rendered.
      // Log, clean up half-written files, and carry on. If every clip fails
      // we throw a descriptive error AFTER the loop.
      fullyFailedCount += 1
      const summary =
        perClipErr instanceof Error ? perClipErr.message : String(perClipErr)
      if (lastClipFailures.length < 3) {
        lastClipFailures.push(`clip ${i + 1}: ${summary}`)
      }
      console.warn("CLIP_STAGE_WARN", {
        requestId,
        stage: "per_clip",
        status: "skipped_after_error",
        clipIndex: i,
        clipTotal: n,
        errorSummary: summary,
      })
      await unlink(rawOutput).catch(() => {})
      await unlink(finalOutput).catch(() => {})
    }
  }

  if (outputs.length === 0) {
    // Every selected moment failed to render. Preserve the most informative
    // failure text for the user; do not claim success with zero clips.
    throw new ClipInputError(
      lastClipFailures.length > 0
        ? `Could not produce any clips from this video. First failures: ${lastClipFailures.join(" | ")}`
        : "Could not produce any clips from this video.",
      500
    )
  }

  await r({
    kind: "finalizing",
    fraction: 1,
    message: "Packaging results…",
  })

  // `partial` is true when either (a) fewer strong moments were available than
  // requested, or (b) some per-clip renders were skipped after errors.
  const partial = outputs.length < req.clips

  console.info("CLIP_STAGE", {
    requestId,
    stage: "pipeline",
    status: "success",
    requestedClips: req.clips,
    generatedClips: outputs.length,
    skippedClipFailures: fullyFailedCount,
    partial,
    durationMs: Date.now() - startedAt,
  })

  return { clips: outputs, partial, requestedClips: req.clips }
}

async function runClipRenderWithRetry(
  render: () => Promise<unknown>,
  requestId: string,
  clipIndex: number
) {
  const maxAttempts = 2
  let attempt = 0
  let lastError: unknown = null
  while (attempt < maxAttempts) {
    attempt += 1
    try {
      await render()
      if (attempt > 1) {
        console.info("CLIP_STAGE", {
          requestId,
          stage: "render",
          status: "retry_success",
          clipIndex,
          attempt,
        })
      }
      return
    } catch (error) {
      lastError = error
      const summary = error instanceof Error ? error.message : "unknown_error"
      console.warn("CLIP_STAGE_WARN", {
        requestId,
        stage: "render",
        status: "attempt_failed",
        clipIndex,
        attempt,
        errorSummary: summary,
      })
      if (attempt >= maxAttempts || !isTransientRenderError(summary)) break
    }
  }
  throw lastError
}

function isTransientRenderError(errorSummary: string) {
  const message = errorSummary.toLowerCase()
  return (
    message.includes("resource temporarily unavailable") ||
    message.includes("timed out") ||
    message.includes("busy") ||
    message.includes("eagain")
  )
}

function selectTopNonOverlappingSegments(
  candidates: ClipCandidate[],
  targetCount: number,
  minGapSeconds: number
): ClipCandidate[] {
  if (!candidates.length || targetCount <= 0) return []

  const maxEnd = candidates.reduce((max, candidate) => Math.max(max, candidate.end), 0)
  const scoreFloor = resolveScoreFloor(candidates)
  const guardCandidates = [
    Math.max(minGapSeconds, 2),
    Math.max(minGapSeconds * 0.65, 1.2),
    0.5,
  ]
  let selected: ClipCandidate[] = []

  selected = selectAcrossTimelineThirds(
    candidates,
    scoreFloor,
    maxEnd,
    Math.max(1.5, minGapSeconds * 0.85)
  )
  if (selected.length >= targetCount) {
    return selected.slice(0, targetCount).sort((a, b) => a.start - b.start)
  }

  for (const overlapGuardSeconds of guardCandidates) {
    for (const candidate of candidates) {
      if (selected.length >= targetCount) break
      if (candidate.score < scoreFloor) continue
      const overlaps = selected.some((picked) =>
        areOverlapping(picked, candidate, overlapGuardSeconds)
      )
      if (!overlaps) {
        selected.push(candidate)
      }
    }
    if (selected.length >= targetCount) {
      return selected.sort((a, b) => a.start - b.start)
    }
  }

  if (selected.length < targetCount) {
    for (const candidate of candidates) {
      if (selected.length >= targetCount) break
      const exists = selected.some((picked) =>
        areOverlapping(picked, candidate, minGapSeconds * 0.9)
      )
      if (!exists) {
        selected.push(candidate)
      }
    }
  }

  return selected.sort((a, b) => a.start - b.start)
}

function resolveScoreFloor(candidates: ClipCandidate[]) {
  const topScore = candidates[0]?.score ?? 0
  return Math.max(28, Math.round(topScore * 0.52))
}

function selectAcrossTimelineThirds(
  candidates: ClipCandidate[],
  scoreFloor: number,
  maxEnd: number,
  gapSeconds: number
) {
  if (maxEnd <= 0) return []
  const segmentLength = maxEnd / 3
  const picks: ClipCandidate[] = []
  for (let segment = 0; segment < 3; segment++) {
    const start = segment * segmentLength
    const end = segment === 2 ? maxEnd + 0.01 : (segment + 1) * segmentLength
    const candidate = candidates.find((item) => {
      const withinSegment = item.start >= start && item.start < end
      if (!withinSegment || item.score < scoreFloor) return false
      return !picks.some((picked) => areOverlapping(picked, item, gapSeconds))
    })
    if (candidate) {
      picks.push(candidate)
    }
  }
  return picks
}

function areOverlapping(
  a: { start: number; end: number },
  b: { start: number; end: number },
  gapSeconds: number
): boolean {
  const aStart = a.start - gapSeconds
  const aEnd = a.end + gapSeconds
  return b.start < aEnd && b.end > aStart
}
