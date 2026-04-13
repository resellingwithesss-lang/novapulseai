import path from "path"
import fs from "fs"
import crypto from "crypto"
import { spawn } from "child_process"

export interface AnimateOptions {
  imagePath: string
  outputName: string
  duration: number
  resolution: "1080x1920" | "1080x1350" | "1920x1080"
  enableVignette?: boolean
  enableFilmGrain?: boolean
  quality?: "high" | "ultra"
  fps?: 24 | 30 | 60
  seed?: number
  motionProfile?: "premium" | "aggressive" | "subtle" | "auto"
  spotlight?: boolean
  shimmer?: boolean
  microShake?: boolean
}

const OUTPUT_DIR = path.resolve("tmp/animated")
const MIN_OUTPUT_BYTES = 25_000
const FFMPEG_TIMEOUT_MS = 1000 * 60 * 4

type ResolvedMotionProfile = "premium" | "aggressive" | "subtle"

function ensureFileExists(file: string): void {
  if (!file || !fs.existsSync(file)) throw new Error(`Image not found: ${file}`)
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function parseResolution(resolution: string): { w: number; h: number } {
  const match = /^(\d+)x(\d+)$/.exec(resolution)
  if (!match) throw new Error(`Invalid resolution: ${resolution}`)
  return { w: Number(match[1]), h: Number(match[2]) }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function safeNameMp4(name: string): string {
  const cleaned = String(name || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  const base = cleaned || `anim-${Date.now()}-${crypto.randomUUID()}`
  return base.endsWith(".mp4") ? base : `${base}.mp4`
}

function ffPath(p: string): string {
  return path.resolve(p).replace(/\\/g, "/")
}

function cleanupFile(filePath: string | null | undefined): void {
  if (!filePath) return
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch {}
}

function validateOutput(outputPath: string): void {
  if (!fs.existsSync(outputPath)) throw new Error("Output missing")
  const stats = fs.statSync(outputPath)
  if (!stats.isFile()) throw new Error("Output is not a file")
  if (stats.size < MIN_OUTPUT_BYTES) throw new Error("Output video too small")
}

function rng(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6D2B79F5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function createRandom(seed?: number): () => number {
  return seed !== undefined ? rng(seed) : Math.random
}

function resolveProfile(profile: AnimateOptions["motionProfile"], duration: number): ResolvedMotionProfile {
  if (profile && profile !== "auto") return profile
  if (duration <= 6) return "aggressive"
  if (duration <= 12) return "premium"
  return "subtle"
}

function createMotionProfile(
  frames: number,
  profile: ResolvedMotionProfile,
  seed?: number
): { zoomExpr: string; xExpr: string; yExpr: string } {
  const rand = createRandom(seed)
  const driftX = (rand() - 0.5) * (profile === "aggressive" ? 0.002 : profile === "premium" ? 0.0012 : 0.0008)
  const driftY = (rand() - 0.5) * (profile === "aggressive" ? 0.0014 : profile === "premium" ? 0.0009 : 0.0006)

  const zoomStart = profile === "aggressive" ? 1.06 : profile === "premium" ? 1.035 : 1.02
  const zoomPeak = profile === "aggressive" ? 1.18 : profile === "premium" ? 1.11 : 1.07
  const totalFrames = Math.max(2, frames)
  const t = `min(1,max(0,on/${totalFrames}))`
  const ease = `(3*pow(${t},2)-2*pow(${t},3))`

  return {
    zoomExpr: `z='${zoomStart}+(${zoomPeak}-${zoomStart})*${ease}'`,
    xExpr: `x='iw/2-(iw/zoom/2)+(${driftX}*iw)*${ease}'`,
    yExpr: `y='ih/2-(ih/zoom/2)+(${driftY}*ih)*${ease}'`
  }
}

export async function animateImageToVideo(options: AnimateOptions): Promise<string> {
  const {
    imagePath,
    outputName,
    duration,
    resolution,
    enableVignette = true,
    enableFilmGrain = false,
    quality = "high",
    fps = 30,
    seed,
    motionProfile = "auto",
    spotlight = false,
    shimmer = false,
    microShake = false
  } = options

  ensureFileExists(imagePath)
  ensureDir(OUTPUT_DIR)

  const outputPath = path.join(OUTPUT_DIR, safeNameMp4(outputName))
  const { w, h } = parseResolution(resolution)
  const safeDuration = clamp(duration, 1, 180)
  const safeFps = clamp(fps, 24, 60)
  const frames = Math.max(2, Math.floor(safeDuration * safeFps))
  const profile = resolveProfile(motionProfile, safeDuration)
  const motion = createMotionProfile(frames, profile, seed)

  const filters: string[] = [
    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
    `crop=${w}:${h}`,
    "setsar=1",
    `zoompan=${motion.zoomExpr}:${motion.xExpr}:${motion.yExpr}:d=1:s=${w}x${h}`
  ]

  if (microShake) {
    filters.push("rotate='0.002*sin(2*PI*t*0.7)':ow=rotw(iw):oh=roth(ih):c=black@0")
    filters.push(`crop=${w}:${h}`)
  }

  filters.push(
    "eq=contrast=1.12:saturation=1.05:brightness=0.01",
    "curves=preset=lighter",
    "unsharp=5:5:0.55:5:5:0.0"
  )

  if (spotlight) filters.push("vignette=PI/10")
  if (enableVignette) filters.push("vignette=PI/7")
  if (shimmer) filters.push("eq=gamma='1+0.02*sin(2*PI*t*0.35)'")
  if (enableFilmGrain) filters.push("noise=alls=3:allf=t")
  filters.push(`fps=${safeFps}`, "format=yuv420p")

  const vf = filters.join(",")
  const crf = quality === "ultra" ? "14" : "18"
  const preset = quality === "ultra" ? "veryslow" : "slow"

  return new Promise((resolve, reject) => {
    let stderr = ""
    let settled = false

    const args = [
      "-y",
      "-loop", "1",
      "-i", ffPath(imagePath),
      "-vf", vf,
      "-t", String(safeDuration),
      "-r", String(safeFps),
      "-c:v", "libx264",
      "-preset", preset,
      "-crf", crf,
      "-profile:v", "high",
      "-level", "4.2",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      ffPath(outputPath)
    ]

    const proc = spawn("ffmpeg", args, { windowsHide: true })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { proc.kill("SIGKILL") } catch {}
      cleanupFile(outputPath)
      reject(new Error("FFmpeg animation timed out"))
    }, FFMPEG_TIMEOUT_MS)

    proc.stderr.on("data", chunk => {
      stderr += chunk.toString()
    })

    proc.on("error", err => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanupFile(outputPath)
      reject(err)
    })

    proc.on("close", code => {
      if (settled) return
      settled = true
      clearTimeout(timer)

      if (code === 0) {
        try {
          validateOutput(outputPath)
          resolve(outputPath)
        } catch (err) {
          cleanupFile(outputPath)
          reject(err)
        }
        return
      }

      cleanupFile(outputPath)
      reject(new Error(`FFmpeg failed (${code})${stderr ? `\n${stderr.slice(0, 3000)}` : ""}`))
    })
  })
}