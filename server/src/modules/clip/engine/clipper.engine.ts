import { spawn } from "child_process"
import { PLATFORM_PRESETS } from "../types/clip.types"
import type { ClipPlatform } from "../types/clip.types"

type ClipGenerationContext = {
  requestId?: string
  clipIndex?: number
  totalClips?: number
}

export const generateClip = async (
  input: string,
  start: number,
  end: number,
  platform: ClipPlatform,
  output: string,
  context: ClipGenerationContext = {}
) => {
  const requestId = context.requestId ?? "unknown_request_id"
  const startedAt = Date.now()
  const preset = PLATFORM_PRESETS[platform]

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error("Invalid clip range")
  }
  if (!input || !output || input.includes("\0") || output.includes("\0")) {
    throw new Error("Invalid clip path")
  }

  const duration = end - start

  console.info("CLIP_STAGE", {
    requestId,
    stage: "clip",
    status: "start",
    clipIndex: context.clipIndex,
    totalClips: context.totalClips,
    startSec: start,
    endSec: end,
    platform,
  })

  const videoFilter = `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=increase,crop=${preset.width}:${preset.height}`
  const args = [
    "-y",
    "-ss",
    String(start),
    "-t",
    String(duration),
    "-i",
    input,
    "-vf",
    videoFilter,
    "-c:v",
    "libx264",
    "-preset",
    preset.x264Preset,
    "-profile:v",
    preset.profile,
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(preset.fps),
    "-g",
    String(preset.fps * 2),
    "-b:v",
    preset.videoBitrate,
    "-maxrate",
    preset.maxRate,
    "-bufsize",
    preset.bufferSize,
    "-c:a",
    "aac",
    "-b:a",
    preset.audioBitrate,
    "-movflags",
    "+faststart",
    output,
  ]

  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    })

    let stderrTail = ""
    const stderrLimit = 2048

    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail += chunk.toString("utf8")
      if (stderrTail.length > stderrLimit) {
        stderrTail = stderrTail.slice(-stderrLimit)
      }
    })

    child.on("error", (err) => {
      const errorSummary = err.message || "ffmpeg_spawn_error"
      console.error("CLIP_STAGE_FAIL", {
        requestId,
        stage: "clip",
        status: "error",
        clipIndex: context.clipIndex,
        totalClips: context.totalClips,
        errorSummary,
        durationMs: Date.now() - startedAt,
      })
      reject(err)
    })

    child.on("close", (code, signal) => {
      if (code === 0 && signal === null) {
        console.info("CLIP_STAGE", {
          requestId,
          stage: "clip",
          status: "success",
          clipIndex: context.clipIndex,
          totalClips: context.totalClips,
          durationMs: Date.now() - startedAt,
        })
        resolve(true)
        return
      }

      const compactStderr = stderrTail
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300)
      const errorSummary = compactStderr || `ffmpeg_exit_${String(code)}`
      const error = new Error(errorSummary)

      console.error("CLIP_STAGE_FAIL", {
        requestId,
        stage: "clip",
        status: "error",
        clipIndex: context.clipIndex,
        totalClips: context.totalClips,
        errorSummary,
        exitCode: code,
        signal: signal ?? undefined,
        durationMs: Date.now() - startedAt,
      })
      reject(error)
    })
  })
}