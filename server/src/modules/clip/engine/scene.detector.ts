import ffmpeg from "fluent-ffmpeg"
import { spawn } from "child_process"
import type { ClipCandidate, ClipPlatform } from "../types/clip.types"

const DEFAULT_MIN_DURATION = 10
const DEFAULT_MAX_DURATION = 26
const STEP_SECONDS = 3
const MAX_CANDIDATES = 600

type SceneDetectionContext = {
  requestId?: string
  platform?: ClipPlatform
  desiredClips?: number
  /** When set, drives min/ideal/max segment length instead of platform defaults. */
  targetClipDurationSec?: number
}

export type SceneDetectionResult = {
  durationSec: number
  minClipDurationSec: number
  idealClipDurationSec: number
  maxClipDurationSec: number
  candidates: ClipCandidate[]
}

export const detectScenes = async (
  videoPath: string,
  context: SceneDetectionContext = {}
): Promise<SceneDetectionResult> => {
  const requestId = context.requestId ?? "unknown_request_id"
  const startedAt = Date.now()

  try {
    console.info("CLIP_STAGE", {
      requestId,
      stage: "detect",
      status: "start",
    })

    const duration = await getVideoDuration(videoPath)
    const keyframeTimes = await getKeyframeTimestamps(videoPath)
    const targets = resolveDurationTargets(
      context.platform,
      context.targetClipDurationSec
    )
    let candidates = buildScoredCandidates(duration, keyframeTimes, {
      platform: context.platform,
      desiredClips: context.desiredClips,
      targetClipDurationSec: context.targetClipDurationSec,
    })
    const desired = context.desiredClips ?? 5
    const weakCoverage =
      keyframeTimes.length < 10 ||
      candidates.length < Math.max(24, desired * 5)
    if (weakCoverage) {
      const anchors = buildUniformAnchorCandidates(
        duration,
        targets,
        desired
      )
      candidates = mergeCandidatePools(candidates, anchors)
    }

    console.info("CLIP_STAGE", {
      requestId,
      stage: "detect",
      status: "success",
      sceneCount: candidates.length,
      keyframeCount: keyframeTimes.length,
      durationMs: Date.now() - startedAt,
    })

    return {
      durationSec: Number(duration.toFixed(2)),
      minClipDurationSec: targets.minDuration,
      idealClipDurationSec: targets.idealDuration,
      maxClipDurationSec: targets.maxDuration,
      candidates,
    }
  } catch (error) {
    const errorSummary = error instanceof Error ? error.message : "unknown_error"

    console.error("CLIP_STAGE_FAIL", {
      requestId,
      stage: "detect",
      status: "error",
      errorSummary,
      durationMs: Date.now() - startedAt,
    })

    throw error
  }
}

const getVideoDuration = (videoPath: string): Promise<number> => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err) return reject(err)
      const duration = data.format.duration
      if (!Number.isFinite(duration) || duration <= 0) {
        return reject(new Error("Unable to resolve source duration"))
      }
      resolve(duration)
    })
  })
}

const getKeyframeTimestamps = (videoPath: string): Promise<number[]> => {
  const args = [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-skip_frame",
    "nokey",
    "-show_entries",
    "frame=best_effort_timestamp_time",
    "-of",
    "json",
    videoPath,
  ]

  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })

    child.on("error", (error) => {
      reject(error)
    })

    child.on("close", (code) => {
      if (code !== 0) {
        const summary = stderr.replace(/\s+/g, " ").trim().slice(0, 300)
        reject(new Error(summary || "ffprobe failed while reading keyframes"))
        return
      }

      try {
        const parsed = JSON.parse(stdout) as {
          frames?: Array<{ best_effort_timestamp_time?: string }>
        }
        const times = (parsed.frames ?? [])
          .map((frame) => Number(frame.best_effort_timestamp_time))
          .filter((value) => Number.isFinite(value) && value >= 0)
          .sort((a, b) => a - b)
        resolve(times)
      } catch {
        resolve([])
      }
    })
  })
}

function buildScoredCandidates(
  duration: number,
  keyframes: number[],
  options: {
    platform?: ClipPlatform
    desiredClips?: number
    targetClipDurationSec?: number
  }
): ClipCandidate[] {
  const { minDuration, maxDuration, idealDuration } = resolveDurationTargets(
    options.platform,
    options.targetClipDurationSec
  )
  const desiredClips = options.desiredClips ?? 5
  const stepSeconds =
    idealDuration >= 50 ? 6 : idealDuration >= 35 ? 5 : STEP_SECONDS

  const densityBaseline = Math.max(0.12, keyframes.length / Math.max(duration, 1))
  const candidates: ClipCandidate[] = []

  for (let start = 0; start + minDuration <= duration; start += stepSeconds) {
    const room = duration - start
    const maxAllowed = Math.min(maxDuration, room)
    if (maxAllowed < minDuration) continue

    const durationVariants = new Set<number>([
      clampDuration(idealDuration - 2, minDuration, maxAllowed),
      clampDuration(idealDuration, minDuration, maxAllowed),
      clampDuration(idealDuration + 2, minDuration, maxAllowed),
    ])

    for (const candidateDuration of durationVariants) {
      const end = Math.min(start + candidateDuration, duration)
      const actualDuration = end - start
      if (actualDuration < minDuration) continue

      const inWindow = keyframes.filter((t) => t >= start && t <= end)
      const keyframeDensity = inWindow.length / Math.max(actualDuration, 1)
      const densityScore = Math.min(keyframeDensity / (densityBaseline * 1.35), 1)

      const pacingScore = computePacingScore(inWindow)
      const hookPositionScore = computeHookPositionScore(start, duration)
      const lengthScore = 1 - Math.min(Math.abs(actualDuration - idealDuration) / 7, 1)
      const energyBlend = densityScore * 0.65 + pacingScore * 0.35

      const score =
        energyBlend * 0.45 +
        hookPositionScore * 0.22 +
        lengthScore * 0.2 +
        computeCoverageScore(start, duration) * 0.13

      const reasonLabels: string[] = []
      if (densityScore > 0.7) reasonLabels.push("strong_scene_changes")
      if (pacingScore > 0.65) reasonLabels.push("fast_pacing")
      if (hookPositionScore > 0.6) reasonLabels.push("hook_potential")
      if (lengthScore > 0.75) reasonLabels.push("shorts_ready_length")
      if (reasonLabels.length === 0) reasonLabels.push("balanced_segment")

      candidates.push({
        start,
        end,
        durationSec: Number(actualDuration.toFixed(2)),
        score: Number((score * 100).toFixed(2)),
        reasonLabels,
      })
    }
  }

  const sorted = candidates
    .sort((a, b) => b.score - a.score || a.start - b.start)
    .slice(0, Math.max(desiredClips * 20, MAX_CANDIDATES))

  return dedupeCandidates(sorted)
}

export function resolveDurationTargets(
  platform?: ClipPlatform,
  overrideIdealSec?: number
): {
  minDuration: number
  maxDuration: number
  idealDuration: number
} {
  if (
    overrideIdealSec !== undefined &&
    Number.isFinite(overrideIdealSec) &&
    overrideIdealSec > 0
  ) {
    const ideal = Math.round(
      Math.min(120, Math.max(5, overrideIdealSec))
    )
    const spread = Math.max(2, Math.round(ideal * 0.15))
    return {
      minDuration: Math.max(5, ideal - spread),
      maxDuration: Math.min(120, ideal + spread),
      idealDuration: ideal,
    }
  }
  if (platform === "youtube") {
    return { minDuration: 16, maxDuration: 30, idealDuration: 24 }
  }
  if (platform === "instagram") {
    return { minDuration: 12, maxDuration: 24, idealDuration: 18 }
  }
  if (platform === "tiktok") {
    return { minDuration: 10, maxDuration: 22, idealDuration: 16 }
  }
  return {
    minDuration: DEFAULT_MIN_DURATION,
    maxDuration: DEFAULT_MAX_DURATION,
    idealDuration: 17,
  }
}

function clampDuration(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function computePacingScore(keyframesInWindow: number[]): number {
  if (keyframesInWindow.length < 2) return 0.25

  const gaps: number[] = []
  for (let i = 1; i < keyframesInWindow.length; i++) {
    gaps.push(keyframesInWindow[i] - keyframesInWindow[i - 1])
  }
  const avgGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
  return 1 - Math.min(avgGap / 4, 1)
}

function computeHookPositionScore(start: number, duration: number): number {
  const ratio = duration > 0 ? start / duration : 0
  if (ratio <= 0.2) return 1
  if (ratio <= 0.45) return 0.72
  if (ratio <= 0.75) return 0.55
  return 0.35
}

function computeCoverageScore(start: number, duration: number): number {
  const ratio = duration > 0 ? start / duration : 0
  const distanceFromMiddle = Math.abs(ratio - 0.5)
  return 1 - Math.min(distanceFromMiddle / 0.5, 1)
}

function dedupeCandidates(candidates: ClipCandidate[]): ClipCandidate[] {
  const result: ClipCandidate[] = []
  for (const candidate of candidates) {
    const duplicate = result.some(
      (existing) =>
        Math.abs(existing.start - candidate.start) < 1.2 &&
        Math.abs(existing.end - candidate.end) < 1.2
    )
    if (!duplicate) {
      result.push(candidate)
    }
  }
  return result
}

function buildUniformAnchorCandidates(
  duration: number,
  targets: { minDuration: number; maxDuration: number; idealDuration: number },
  desiredClips: number
): ClipCandidate[] {
  const out: ClipCandidate[] = []
  const slots = Math.max(4, desiredClips + 2)
  const span = Math.min(
    targets.maxDuration,
    Math.max(targets.minDuration, targets.idealDuration)
  )
  for (let i = 0; i < slots; i++) {
    const anchor = ((i + 1) / (slots + 1)) * duration
    const start = Math.max(0, anchor - span / 2)
    const end = Math.min(duration, start + span)
    if (end - start < Math.min(targets.minDuration, duration * 0.5)) continue
    out.push({
      start,
      end,
      durationSec: Number((end - start).toFixed(2)),
      score: 44,
      reasonLabels: ["even_timeline_coverage"],
    })
  }
  return dedupeCandidates(out)
}

function mergeCandidatePools(
  primary: ClipCandidate[],
  secondary: ClipCandidate[]
): ClipCandidate[] {
  const merged = [...primary, ...secondary]
  merged.sort((a, b) => b.score - a.score || a.start - b.start)
  const result: ClipCandidate[] = []
  for (const c of merged) {
    const dup = result.some(
      (e) =>
        Math.abs(e.start - c.start) < 2.5 && Math.abs(e.end - c.end) < 2.5
    )
    if (!dup) result.push(c)
    if (result.length >= MAX_CANDIDATES) break
  }
  return result
}