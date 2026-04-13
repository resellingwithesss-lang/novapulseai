import ffmpeg from "fluent-ffmpeg"
import fs from "fs"
import path from "path"
import os from "os"
import crypto from "crypto"

export type Platform = "tiktok" | "instagram" | "youtube"
export type Quality = "standard" | "high" | "ultra"

export interface Caption {
  text: string
  start: number
  end: number
}

export interface RenderOptions {
  clips: string[]
  voicePath: string
  captions: Caption[]
  outputFileName: string
  platform?: Platform
  quality?: Quality
  hook?: string
  cta?: string
  watermarkText?: string
  /** Tighter hook overlay timing / size for feed-native UGC mode. */
  overlayStyle?: "cinematic" | "ugc_social"
  /** Override hook title card window (seconds); e.g. NovaPulseAI uses a shorter read window. */
  hookOverlayStartSec?: number
  hookOverlayEndSec?: number
  /** Faster libx264 preset + standard CRF for dev preview runs. */
  fastPreview?: boolean
}

const GENERATED_DIR = path.resolve("generated")
const TMP_DIR = path.resolve("tmp")
const TMP_TEXT_DIR = path.resolve(TMP_DIR, "render-text")
const THREADS = Math.max(2, os.cpus().length)
const MIN_OUTPUT_BYTES = 50_000

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function ensureFile(file?: string): void {
  if (!file || !fs.existsSync(file)) throw new Error(`Missing file: ${file}`)
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomUUID()}`
}

function clean(text?: string): string {
  return String(text ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function roundTime(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.round(value * 1000) / 1000
}

function escapeFilterPath(filePath: string): string {
  return path
    .resolve(filePath)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
}

function writeTextAsset(text: string, prefix: string): string {
  ensureDir(TMP_TEXT_DIR)
  const filePath = path.join(TMP_TEXT_DIR, `${uid(prefix)}.txt`)
  fs.writeFileSync(filePath, clean(text) || " ", "utf8")
  return filePath
}

function createConcatList(clips: string[]): string {
  ensureDir(TMP_DIR)

  const listPath = path.join(TMP_DIR, `${uid("concat")}.txt`)
  const lines = clips.map(clip => {
    const normalized = path.resolve(clip).replace(/\\/g, "/").replace(/'/g, "'\\''")
    return `file '${normalized}'`
  })

  fs.writeFileSync(listPath, lines.join("\n"), "utf8")
  return listPath
}

function splitCaption(text: string): string {
  const words = clean(text).split(" ").filter(Boolean)
  if (words.length <= 3) return words.join(" ")
  if (words.length <= 6) {
    const mid = Math.ceil(words.length / 2)
    return `${words.slice(0, mid).join(" ")}\n${words.slice(mid).join(" ")}`
  }
  return `${words.slice(0, 3).join(" ")}\n${words.slice(3, 6).join(" ")}`
}

function getPreset(platform: Platform = "youtube"): { width: number; height: number; fps: number } {
  switch (platform) {
    case "youtube": return { width: 1920, height: 1080, fps: 30 }
    case "instagram": return { width: 1080, height: 1080, fps: 30 }
    default: return { width: 1080, height: 1920, fps: 30 }
  }
}

function getCRF(quality: Quality = "high"): string {
  if (quality === "ultra") return "15"
  if (quality === "standard") return "22"
  return "18"
}

function buildBaseFilters(width: number, height: number, fps: number): string[] {
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    `fps=${fps}`,
    "setsar=1",
    "format=yuv420p",
    "eq=contrast=1.08:saturation=1.12:brightness=0.02",
    "unsharp=5:5:0.4:5:5:0.0"
  ]
}

function buildCaptionFilters(captions: Caption[], width: number, height: number): string[] {
  const filters: string[] = []
  const isVertical = height > width
  const isSquare = Math.abs(height - width) < 24
  const safeBottom = isVertical ? 88 : isSquare ? 72 : 64
  const boxW = Math.min(width - (isVertical ? 96 : 100), Math.floor(width * (isSquare ? 0.82 : 0.78)))
  const boxH = isVertical ? 168 : isSquare ? 140 : 118
  const fontSize = isVertical ? 68 : isSquare ? 52 : 46
  const boxY = height - boxH - safeBottom
  const textY = boxY + Math.floor(boxH * 0.22)

  for (const caption of captions) {
    const text = splitCaption(caption.text)
    if (!text) continue

    const start = roundTime(caption.start)
    const end = roundTime(caption.end)
    if (end <= start) continue

    const textFile = writeTextAsset(text, "caption")
    const escaped = escapeFilterPath(textFile)

    filters.push(`drawbox=x=(iw-${boxW})/2:y=${boxY}:w=${boxW}:h=${boxH}:color=black@0.46:t=fill:enable='between(t,${start},${end})'`)

    filters.push([
      `drawtext=textfile='${escaped}'`,
      "reload=0",
      "fontcolor=white",
      `fontsize=${fontSize}`,
      "line_spacing=12",
      "borderw=5",
      "bordercolor=black",
      "text_align=center",
      "x=(w-text_w)/2",
      `y=${textY}`,
      `alpha='if(lt(t,${start}+0.15),(t-${start})/0.15,if(lt(t,${end}-0.15),1,(${end}-t)/0.15))'`,
      `enable='between(t,${start},${end})'`
    ].join(":"))
  }

  return filters
}

function buildOverlayFilter(
  text: string | undefined,
  prefix: string,
  start: number,
  end: number,
  fontSize: number,
  y: number
): string | null {
  const cleaned = clean(text)
  if (!cleaned) return null

  const textFile = writeTextAsset(cleaned, prefix)
  const escaped = escapeFilterPath(textFile)
  const safeStart = roundTime(start)
  const safeEnd = roundTime(end)
  if (safeEnd <= safeStart) return null

  return [
    `drawtext=textfile='${escaped}'`,
    "reload=0",
    "fontcolor=white",
    `fontsize=${fontSize}`,
    "borderw=6",
    "bordercolor=black",
    "x=(w-text_w)/2",
    `y=${y}`,
    `alpha='if(lt(t,${safeStart}+0.35),(t-${safeStart})/0.35,if(lt(t,${safeEnd}-0.35),1,(${safeEnd}-t)/0.35))'`,
    `enable='between(t,${safeStart},${safeEnd})'`
  ].join(":")
}

function validateOutput(filePath: string): void {
  if (!fs.existsSync(filePath)) throw new Error("Render output missing")
  const stats = fs.statSync(filePath)
  if (!stats.isFile()) throw new Error("Render output is not a file")
  if (stats.size < MIN_OUTPUT_BYTES) throw new Error("Render output too small")
}

export async function renderVideo(opts: RenderOptions): Promise<string> {
  if (!opts?.clips?.length) throw new Error("No clips provided")
  opts.clips.forEach(ensureFile)
  ensureFile(opts.voicePath)

  ensureDir(GENERATED_DIR)
  ensureDir(TMP_DIR)
  ensureDir(TMP_TEXT_DIR)

  const { width, height, fps } = getPreset(opts.platform)
  const output = path.join(GENERATED_DIR, path.basename(opts.outputFileName))
  const captionDuration = opts.captions?.length ? Math.max(...opts.captions.map(c => roundTime(c.end))) : 0
  const totalDuration = Math.max(captionDuration, 10)

  return new Promise((resolve, reject) => {
    const command = ffmpeg()
    let concatListPath: string | null = null

    try {
      if (opts.clips.length === 1) {
        command.input(path.resolve(opts.clips[0]))
      } else {
        concatListPath = createConcatList(opts.clips)
        command.input(concatListPath)
        command.inputOptions(["-f", "concat", "-safe", "0"])
      }

      command.input(path.resolve(opts.voicePath))

      const filters: string[] = [
        ...buildBaseFilters(width, height, fps),
        ...buildCaptionFilters(opts.captions || [], width, height)
      ]

      const topY = height > width ? 112 : Math.abs(height - width) < 24 ? 96 : 84
      const ugc = opts.overlayStyle === "ugc_social"
      const hookFontRaw = height > width ? 76 : Math.abs(height - width) < 24 ? 58 : 54
      const ctaFontRaw = height > width ? 74 : Math.abs(height - width) < 24 ? 56 : 52
      const hookFont = ugc ? Math.round(hookFontRaw * 0.94) : hookFontRaw
      const ctaFont = ugc ? Math.round(ctaFontRaw * 0.96) : ctaFontRaw

      const hookStart = opts.hookOverlayStartSec ?? (ugc ? 0.45 : 0.6)
      const hookEnd = opts.hookOverlayEndSec ?? (ugc ? 2.65 : 3.8)
      const hookFilter = buildOverlayFilter(opts.hook, "hook", hookStart, hookEnd, hookFont, topY)
      if (hookFilter) filters.push(hookFilter)

      const ctaStart = Math.max(0, totalDuration - (ugc ? 2.15 : 2.6))
      const ctaFilter = buildOverlayFilter(opts.cta, "cta", ctaStart, totalDuration, ctaFont, topY)
      if (ctaFilter) filters.push(ctaFilter)

      if (opts.watermarkText) {
        const mark = buildOverlayFilter(opts.watermarkText, "wm", 0, totalDuration, 26, height - 46)
        if (mark) filters.push(mark)
      }

      const encQuality: Quality = opts.fastPreview ? "standard" : (opts.quality ?? "high")
      const encPreset = opts.fastPreview ? "veryfast" : "slow"

      command
        .videoFilters(filters)
        .outputOptions([
          "-map", "0:v:0",
          "-map", "1:a:0",
          "-shortest",
          "-r", String(fps),
          "-pix_fmt", "yuv420p",
          "-movflags", "+faststart",
          "-preset", encPreset,
          "-crf", getCRF(encQuality),
          "-c:v", "libx264",
          "-c:a", "aac",
          "-b:a", "256k",
          "-ar", "48000",
          "-ac", "2",
          "-threads", String(THREADS)
        ])
        .on("end", () => {
          try {
            validateOutput(output)
            resolve(output)
          } catch (error) {
            reject(error)
          } finally {
            if (concatListPath && fs.existsSync(concatListPath)) fs.unlinkSync(concatListPath)
          }
        })
        .on("error", error => {
          if (concatListPath && fs.existsSync(concatListPath)) fs.unlinkSync(concatListPath)
          reject(error)
        })
        .save(output)
    } catch (error) {
      if (concatListPath && fs.existsSync(concatListPath)) fs.unlinkSync(concatListPath)
      reject(error)
    }
  })
}