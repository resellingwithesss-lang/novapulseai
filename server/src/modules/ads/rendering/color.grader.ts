import ffmpeg from "fluent-ffmpeg"
import fs from "fs"
import path from "path"
import crypto from "crypto"

export interface ColorGradeOptions {
  inputPath: string
  outputFileName: string
  platform?: "tiktok" | "instagram" | "youtube"
  tone?: "aggressive" | "emotional" | "clean" | "cinematic" | "luxury"
  useLUT?: boolean
  lutPath?: string
  useFilmGrain?: boolean
  grainStrength?: number
  useVignette?: boolean
  highlightRollOff?: boolean
  shadowLift?: boolean
  quality?: "standard" | "high" | "ultra"
  /** Skip heavy denoise / use faster x264 preset + standard CRF. */
  fastPreview?: boolean
}

const GENERATED_DIR = path.resolve("generated")
const MIN_OUTPUT_BYTES = 100_000

function ensureFileExists(file?: string): void {
  if (!file || !fs.existsSync(file)) throw new Error(`Input video not found: ${file}`)
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function ffPath(p: string): string {
  return path.resolve(p).replace(/\\/g, "/")
}

function ffFilterPath(p: string): string {
  return path.resolve(p).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'")
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function safeOutputName(name: string): string {
  const cleaned = String(name || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  const base = cleaned || `graded-${Date.now()}-${crypto.randomUUID()}.mp4`
  return base.endsWith(".mp4") ? base : `${base}.mp4`
}

function getCRF(q?: string): string {
  if (q === "ultra") return "14"
  if (q === "standard") return "22"
  return "18"
}

function platformGrade(platform?: string): string {
  switch (platform) {
    case "youtube": return "eq=contrast=1.08:brightness=0.02:saturation=1.06"
    case "instagram": return "eq=contrast=1.14:brightness=0.03:saturation=1.12"
    default: return "eq=contrast=1.16:brightness=0.03:saturation=1.16"
  }
}

function toneCurve(tone?: string): string {
  switch (tone) {
    case "aggressive": return "curves=preset=strong_contrast"
    case "emotional": return "curves=preset=lighter"
    case "luxury": return "curves=preset=medium_contrast"
    case "cinematic": return "curves=preset=strong_contrast"
    case "clean": return "curves=preset=linear"
    default: return ""
  }
}

function validateOutput(file: string): void {
  if (!fs.existsSync(file)) throw new Error("Color grade output missing")
  const stats = fs.statSync(file)
  if (!stats.isFile()) throw new Error("Color grade output is not a file")
  if (stats.size < MIN_OUTPUT_BYTES) throw new Error("Color graded file too small")
}

function cleanupFile(file?: string): void {
  if (!file) return
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file)
  } catch {}
}

export async function applyColorGrade({
  inputPath,
  outputFileName,
  platform,
  tone = "cinematic",
  useLUT = false,
  lutPath,
  useFilmGrain = true,
  grainStrength = 5,
  useVignette = true,
  highlightRollOff = true,
  shadowLift = true,
  quality = "high",
  fastPreview = false
}: ColorGradeOptions): Promise<string> {
  ensureFileExists(inputPath)
  if (useLUT && lutPath) ensureFileExists(lutPath)
  ensureDir(GENERATED_DIR)

  const outputPath = path.join(GENERATED_DIR, safeOutputName(outputFileName))
  const filters: string[] = []
  if (!fastPreview) filters.push("hqdn3d=1.1:1.1:3:3")
  filters.push(platformGrade(platform))

  const curve = toneCurve(tone)
  if (curve) filters.push(curve)
  if (tone === "cinematic") {
    filters.push("eq=gamma=0.99:contrast=1.025:saturation=1.025")
  }
  if (shadowLift) filters.push("eq=gamma=1.02")
  /* Master curve only: `curves=highlights` is unsupported on common Windows FFmpeg builds. */
  if (highlightRollOff) {
    filters.push("curves=all='0/0 0.48/0.46 0.75/0.71 1/0.965'")
  }
  if (useLUT && lutPath) filters.push(`lut3d='${ffFilterPath(lutPath)}'`)
  filters.push("unsharp=5:5:0.7:5:5:0.0")
  if (useVignette) filters.push("vignette=PI/10")
  if (useFilmGrain) filters.push(`noise=alls=${clamp(grainStrength, 1, 12)}:allf=t+u`)
  filters.push("format=yuv420p")

  const encPreset = fastPreview ? "veryfast" : "slow"
  const encCrf = getCRF(fastPreview ? "standard" : quality)

  return new Promise((resolve, reject) => {
    ffmpeg(ffPath(inputPath))
      .videoFilters(filters)
      .videoCodec("libx264")
      .audioCodec("copy")
      .outputOptions([
        `-preset ${encPreset}`,
        "-movflags +faststart",
        "-pix_fmt yuv420p",
        "-profile:v high",
        "-level 4.2",
        `-crf ${encCrf}`
      ])
      .on("end", () => {
        try {
          validateOutput(outputPath)
          resolve(outputPath)
        } catch (error) {
          cleanupFile(outputPath)
          reject(error)
        }
      })
      .on("error", err => {
        cleanupFile(outputPath)
        reject(err)
      })
      .save(ffPath(outputPath))
  })
}