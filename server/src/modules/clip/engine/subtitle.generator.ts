import { spawn } from "child_process"
import { createReadStream, promises as fs } from "fs"
import path from "path"
import ffmpeg from "fluent-ffmpeg"
import { getFfmpegBinaryPath } from "../../../lib/ffmpeg-binaries"
import type {
  ClipCaptionMode,
  ClipPlatform,
  ClipSubtitleStyle,
  YoutubeTranscriptLine,
} from "../types/clip.types"
import { PLATFORM_PRESETS } from "../types/clip.types"
import { openai } from "../../../lib/openai"

type WhisperSegment = { start: number; end: number; text: string }

export type ClipCaptionGenSource =
  | "youtube_transcript"
  | "whisper"
  | "none"
  | "unavailable"

type CaptionOutcome = {
  applied: boolean
  status: "burned_in" | "srt_only" | "skipped_disabled" | "skipped_empty" | "failed"
  assPath?: string
  srtPath?: string
  note?: string
  captionSource: ClipCaptionGenSource
}

const ASS_STYLE: Record<
  ClipSubtitleStyle,
  { fontSize: number; bold: boolean; primary: string; outline: number }
> = {
  clean: { fontSize: 22, bold: false, primary: "&H00FFFFFF&", outline: 2 },
  bold: { fontSize: 26, bold: true, primary: "&H00FFFF66&", outline: 3 },
  viral: { fontSize: 28, bold: true, primary: "&H00B466FF&", outline: 4 },
  minimal: { fontSize: 18, bold: false, primary: "&H00CCCCCC&", outline: 1 },
}

/**
 * Whisper / YouTube often emit many tiny segments; overlapping ASS Dialogue events
 * stack vertically and look like a column from top to bottom. Merge into fewer cues.
 */
function mergeOverlappingOrAdjacentSegments(
  segments: WhisperSegment[],
  maxGapSec = 0.22
): WhisperSegment[] {
  const sorted = [...segments]
    .filter((s) => s.text?.trim())
    .sort((a, b) => a.start - b.start)
  if (sorted.length === 0) return []

  const out: WhisperSegment[] = []
  let cur = {
    start: sorted[0].start,
    end: sorted[0].end,
    text: sorted[0].text.trim(),
  }

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]
    const nt = next.text.trim()
    if (!nt) continue
    if (next.start <= cur.end + maxGapSec) {
      cur.end = Math.max(cur.end, next.end)
      cur.text = `${cur.text} ${nt}`.trim()
      if (cur.text.length > 130) {
        cur.text = `${cur.text.slice(0, 127)}…`
      }
    } else {
      out.push({ ...cur })
      cur = { start: next.start, end: next.end, text: nt }
    }
  }
  out.push(cur)
  return out
}

/**
 * Word-wrap for ASS \\N breaks. maxLen is chosen from frame width ÷ estimated glyph width
 * so lines stay inside the safe title area on 9:16 exports.
 */
function wrapSubtitleLines(text: string, maxLen: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ")
  if (!words.length) return []

  const lines: string[] = []
  let wordIndex = 0
  let current = ""

  while (wordIndex < words.length && lines.length < maxLines) {
    const w = words[wordIndex]!

    if (current) {
      const trial = `${current} ${w}`
      if (trial.length <= maxLen) {
        current = trial
        wordIndex++
        continue
      }
      lines.push(current)
      current = ""
      continue
    }

    if (w.length <= maxLen) {
      current = w
      wordIndex++
      continue
    }

    lines.push(w.slice(0, maxLen))
    const rest = w.slice(maxLen)
    if (rest) {
      words[wordIndex] = rest
    } else {
      wordIndex++
    }
  }

  if (current) {
    if (lines.length < maxLines) {
      lines.push(current.length > maxLen ? `${current.slice(0, maxLen - 1)}…` : current)
    } else if (lines.length > 0) {
      const last = lines[lines.length - 1]!
      const merged = `${last} ${current}`.trim()
      lines[lines.length - 1] =
        merged.length <= maxLen ? merged : `${merged.slice(0, Math.max(0, maxLen - 1))}…`
    }
  }

  if (wordIndex < words.length && lines.length > 0) {
    const li = lines.length - 1
    const base = lines[li]!.replace(/…$/, "")
    lines[li] = `${base.slice(0, Math.max(0, maxLen - 1))}…`
  }

  return lines
}

function escapeAssDialogue(
  text: string,
  maxCharsPerLine: number,
  maxLines: number
): string {
  const lines = wrapSubtitleLines(text.replace(/\r/g, ""), maxCharsPerLine, maxLines)
  return lines.join("\\N").replace(/{/g, "(").replace(/}/g, ")").trim()
}

function formatAssTime(seconds: number): string {
  const s = Math.max(0, seconds)
  const cs = Math.floor((s % 1) * 100)
  const t = Math.floor(s)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`
}

function buildAssFromSegments(
  segments: WhisperSegment[],
  style: ClipSubtitleStyle,
  playResX: number,
  playResY: number
): string {
  const s = ASS_STYLE[style]
  const boldFlag = s.bold ? -1 : 0
  /** Base sizes were tuned for ~720px frame height; scale so text isn’t microscopic at 1080×1920. */
  const yScale = playResY / 720
  const fontSize = Math.max(18, Math.round(s.fontSize * yScale))
  const outline = Math.max(1, Math.round(s.outline * yScale))
  /** Bottom-center (numpad 2); wider side margins = narrower text column so lines don’t bleed off-frame. */
  const marginL = Math.round(playResX * 0.09)
  const marginR = marginL
  const marginV = Math.round(playResY * 0.055)
  const innerWidth = Math.max(120, playResX - marginL - marginR)
  /** ~0.58–0.65 em per glyph for Arial + outline bleed; cap line length so subtitles stay inside innerWidth. */
  const glyphEstimate = fontSize * 0.62 + outline * 0.45
  const wrapChars = Math.max(12, Math.min(22, Math.floor(innerWidth / glyphEstimate)))
  const maxAssLines = 4
  const header = `[Script Info]
Title: NovaPulseAI Clipper
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},${s.primary},&H000000FF&,&H80000000&,&H80000000&,${boldFlag},0,0,0,100,100,0,0,1,${outline},2,2,${marginL},${marginR},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const lines = segments
    .filter((seg) => seg.text?.trim())
    .map((seg) => {
      const start = formatAssTime(seg.start)
      const end = formatAssTime(Math.max(seg.end, seg.start + 0.12))
      const text = escapeAssDialogue(seg.text, wrapChars, maxAssLines)
      return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`
    })
  return `${header}${lines.join("\n")}\n`
}

function youtubeLinesToSegments(
  lines: YoutubeTranscriptLine[],
  clipStart: number,
  clipEnd: number
): WhisperSegment[] {
  const windowEnd = clipEnd
  const windowStart = clipStart
  const out: WhisperSegment[] = []
  for (const line of lines) {
    const segStart = line.offset
    const segEnd = line.offset + line.duration
    if (segEnd <= windowStart || segStart >= windowEnd) continue
    const relStart = Math.max(0, segStart - windowStart)
    const relEnd = Math.min(windowEnd - windowStart, segEnd - windowStart)
    if (relEnd > relStart + 0.05) {
      out.push({
        start: relStart,
        end: relEnd,
        text: line.text.trim(),
      })
    }
  }
  return out
}

async function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegBin = getFfmpegBinaryPath()
    const child = spawn(
      ffmpegBin,
      ["-hide_banner", "-loglevel", "error", ...args],
      {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      }
    )
    let err = ""
    child.stderr?.on("data", (c: Buffer) => {
      err += c.toString("utf8")
    })
    child.on("error", (spawnErr: NodeJS.ErrnoException) => {
      if (spawnErr.code === "ENOENT") {
        reject(
          new Error(
            `ffmpeg binary not found at "${ffmpegBin}". Install ffmpeg or set FFMPEG_PATH.`
          )
        )
        return
      }
      reject(spawnErr)
    })
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(err.trim().slice(0, 400) || `ffmpeg_exit_${code}`))
    })
  })
}

async function extractAudioWav(videoPath: string, wavPath: string): Promise<void> {
  await runFfmpeg([
    "-y",
    "-i",
    videoPath,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    "16000",
    "-ac",
    "1",
    wavPath,
  ])
}

async function probeDurationSeconds(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err) return reject(err)
      const d = data.format.duration
      if (!Number.isFinite(d) || d <= 0) return reject(new Error("bad_duration"))
      resolve(d)
    })
  })
}

async function whisperSegmentsForClip(
  wavPath: string,
  clippedVideoPath: string
): Promise<WhisperSegment[]> {
  const readStream = createReadStream(wavPath)
  const transcription = await openai.audio.transcriptions.create({
    file: readStream,
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  } as unknown as Parameters<typeof openai.audio.transcriptions.create>[0])

  const verbose = transcription as unknown as {
    segments?: Array<{ start: number; end: number; text: string }>
    text?: string
  }
  let segments = (verbose.segments ?? []).map((seg) => ({
    start: seg.start,
    end: seg.end,
    text: (seg.text || "").trim(),
  }))

  if (!segments.length && verbose.text?.trim()) {
    const dur = await probeDurationSeconds(clippedVideoPath).catch(() => 12)
    segments = [
      {
        start: 0,
        end: Math.max(2, Math.min(dur, 120)),
        text: verbose.text.trim(),
      },
    ]
  }

  return segments
}

function escapeSubtitlesPathForFfmpeg(filePath: string): string {
  const normalized = path.resolve(filePath).replace(/\\/g, "/")
  return normalized.replace(/:/g, "\\:").replace(/'/g, "\\'")
}

export async function burnAssOnVideo(
  inputMp4: string,
  assPath: string,
  outputMp4: string
): Promise<void> {
  const escaped = escapeSubtitlesPathForFfmpeg(assPath)
  const vf = `ass='${escaped}'`
  await runFfmpeg([
    "-y",
    "-i",
    inputMp4,
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "20",
    "-c:a",
    "copy",
    outputMp4,
  ])
}

function writeSrtFile(usable: WhisperSegment[], srtPath: string): Promise<void> {
  let srtIndex = 1
  const srtLines: string[] = []
  const toSrt = (t: number) => {
    const ms = Math.floor(t * 1000)
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    const z = ms % 1000
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(z).padStart(3, "0")}`
  }
  for (const seg of usable) {
    const body = wrapSubtitleLines(seg.text, 40, 2).join("\n")
    srtLines.push(String(srtIndex++))
    srtLines.push(`${toSrt(seg.start)} --> ${toSrt(Math.max(seg.end, seg.start + 0.1))}`)
    srtLines.push(body)
    srtLines.push("")
  }
  return fs.writeFile(srtPath, srtLines.join("\n"), "utf8")
}

export async function applyCaptionsToClip(options: {
  clippedVideoPath: string
  outputVideoPath: string
  style: ClipSubtitleStyle
  platform: ClipPlatform
  clipStartInSource: number
  clipEndInSource: number
  youtubeTranscript?: YoutubeTranscriptLine[] | null
  captionsEnabled: boolean
  captionMode: ClipCaptionMode
  clipsDir: string
  baseName: string
}): Promise<CaptionOutcome> {
  const {
    clippedVideoPath,
    outputVideoPath,
    style,
    platform,
    clipStartInSource,
    clipEndInSource,
    youtubeTranscript,
    captionsEnabled,
    captionMode,
    clipsDir,
    baseName,
  } = options

  const { width: playResX, height: playResY } = PLATFORM_PRESETS[platform]

  if (!captionsEnabled) {
    return { applied: false, status: "skipped_disabled", captionSource: "none" }
  }

  let segments: WhisperSegment[] = []
  let captionSource: ClipCaptionGenSource = "none"

  if (youtubeTranscript?.length) {
    segments = youtubeLinesToSegments(
      youtubeTranscript,
      clipStartInSource,
      clipEndInSource
    )
    if (segments.length) captionSource = "youtube_transcript"
  }

  if (segments.length === 0) {
    const wavPath = path.join(clipsDir, `${baseName}_cap.wav`)
    try {
      await extractAudioWav(clippedVideoPath, wavPath)
      segments = await whisperSegmentsForClip(wavPath, clippedVideoPath)
      if (segments.some((s) => s.text.length > 0)) captionSource = "whisper"
    } catch (e) {
      const msg = e instanceof Error ? e.message : "whisper_failed"
      return {
        applied: false,
        status: "failed",
        note: msg.slice(0, 200),
        captionSource: "none",
      }
    } finally {
      await fs.unlink(wavPath).catch(() => {})
    }
  }

  const usable = segments.filter((s) => s.text.length > 0)
  if (usable.length === 0) {
    return {
      applied: false,
      status: "skipped_empty",
      note: "No speech detected in this segment for captions.",
      captionSource: "unavailable",
    }
  }

  const mergedSegments = mergeOverlappingOrAdjacentSegments(usable)

  const wantBurn = captionMode === "burn" || captionMode === "both"
  const wantSrt = captionMode === "srt" || captionMode === "both"

  const assPath = path.join(clipsDir, `${baseName}.ass`)
  const srtPath = path.join(clipsDir, `${baseName}.srt`)
  const assContent = buildAssFromSegments(mergedSegments, style, playResX, playResY)
  await fs.writeFile(assPath, assContent, "utf8")
  if (wantSrt) {
    await writeSrtFile(mergedSegments, srtPath)
  }

  if (!wantBurn && wantSrt) {
    return {
      applied: true,
      status: "srt_only",
      assPath,
      srtPath,
      captionSource,
    }
  }

  if (wantBurn) {
    try {
      await burnAssOnVideo(clippedVideoPath, assPath, outputVideoPath)
      return {
        applied: true,
        status: "burned_in",
        assPath,
        srtPath: wantSrt ? srtPath : undefined,
        captionSource,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "burn_failed"
      if (wantSrt) {
        return {
          applied: false,
          status: "failed",
          assPath,
          srtPath,
          note: `Burn-in failed; SRT available. ${msg.slice(0, 120)}`,
          captionSource,
        }
      }
      return {
        applied: false,
        status: "failed",
        assPath,
        srtPath,
        note: msg.slice(0, 200),
        captionSource,
      }
    }
  }

  return {
    applied: false,
    status: "skipped_disabled",
    captionSource: "none",
  }
}
