import ffmpeg from "fluent-ffmpeg"
import fs from "fs"
import path from "path"
import os from "os"
import crypto from "crypto"

export interface MixOptions {
  voicePath: string
  musicPath?: string
  outputFileName: string
  durationSeconds?: number
}

const THREADS = Math.max(2, os.cpus().length)
const TMP_AUDIO_DIR = path.resolve("tmp", "audio")
const MIN_OUTPUT_BYTES = 10_000
const DEFAULT_DURATION_SECONDS = 30
const MIN_DURATION_SECONDS = 5
const MAX_DURATION_SECONDS = 300

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function ensureFile(file?: string): void {
  if (!file || !fs.existsSync(file)) throw new Error(`Missing audio file: ${file}`)
}

function normalizeFsPath(filePath: string): string {
  return path.resolve(filePath)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function uniqueTempFile(prefix: string, ext: string): string {
  ensureDir(TMP_AUDIO_DIR)
  return path.join(TMP_AUDIO_DIR, `${prefix}-${Date.now()}-${crypto.randomUUID()}.${ext}`)
}

function safeUnlink(filePath?: string): void {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch {}
}

function validateOutput(filePath: string): void {
  if (!fs.existsSync(filePath)) throw new Error("Audio mix failed: output file missing")
  const stats = fs.statSync(filePath)
  if (!stats.isFile()) throw new Error("Audio mix failed: output is not a file")
  if (stats.size < MIN_OUTPUT_BYTES) throw new Error("Audio mix failed: output too small")
}

function getOutputCodecOptions(outputFileName: string): { format?: string; codec: string; bitrate?: string } {
  const ext = path.extname(outputFileName).toLowerCase()
  if (ext === ".wav") return { format: "wav", codec: "pcm_s16le" }
  if (ext === ".mp3") return { format: "mp3", codec: "libmp3lame", bitrate: "192k" }
  if (ext === ".m4a") return { format: "ipod", codec: "aac", bitrate: "256k" }
  if (ext === ".aac") return { format: "adts", codec: "aac", bitrate: "256k" }
  return { format: "ipod", codec: "aac", bitrate: "256k" }
}

async function probeDuration(filePath: string): Promise<number> {
  return new Promise(resolve => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return resolve(DEFAULT_DURATION_SECONDS)
      const raw = Number(data?.format?.duration ?? 0)
      if (!Number.isFinite(raw) || raw <= 0) return resolve(DEFAULT_DURATION_SECONDS)
      resolve(raw)
    })
  })
}

async function renderMixToWave(params: {
  voicePath: string
  musicPath?: string
  outputPath: string
  duration: number
}): Promise<void> {
  const { voicePath, musicPath, outputPath, duration } = params
  const hasMusic = Boolean(musicPath && fs.existsSync(musicPath))
  const fadeOutStart = Math.max(0, duration - 2)

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg()
    cmd.input(normalizeFsPath(voicePath))
    if (hasMusic && musicPath) cmd.input(normalizeFsPath(musicPath))

    const filters: string[] = [
      `[0:a]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=0:${duration},asetpts=PTS-STARTPTS,highpass=f=80,lowpass=f=16000,acompressor=threshold=-20dB:ratio=3:attack=8:release=160,afade=t=in:st=0:d=0.25,afade=t=out:st=${fadeOutStart}:d=1.5,volume=1.12[voice]`
    ]

    if (hasMusic) {
      filters.push(
        `[1:a]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=0:${duration},asetpts=PTS-STARTPTS,volume=0.14,afade=t=in:st=0:d=0.8,afade=t=out:st=${fadeOutStart}:d=2.0[music]`,
        `[music][voice]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=250[ducked]`,
        `[voice][ducked]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[mix]`
      )
    } else {
      filters.push(`[voice]anull[mix]`)
    }

    cmd
      .complexFilter(filters)
      .outputOptions([
        "-map", "[mix]",
        "-c:a", "pcm_s16le",
        "-ar", "48000",
        "-ac", "2",
        "-t", String(duration),
        "-threads", String(THREADS)
      ])
      .on("end", () => resolve())
      .on("error", reject)
      .save(normalizeFsPath(outputPath))
  })
}

async function masterAndEncode(params: { inputPath: string; outputPath: string; duration: number }): Promise<void> {
  const { inputPath, outputPath, duration } = params
  const outputConfig = getOutputCodecOptions(outputPath)

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(normalizeFsPath(inputPath))
      .audioFilters([
        "loudnorm=I=-16:TP=-1.5:LRA=11",
        "acompressor=threshold=-12dB:ratio=2:attack=5:release=100",
        "alimiter=limit=0.97"
      ])
      .outputOptions([
        "-ar", "48000",
        "-ac", "2",
        "-t", String(duration),
        "-threads", String(THREADS)
      ])

    if (outputConfig.format) cmd.format(outputConfig.format)
    cmd.audioCodec(outputConfig.codec)
    if (outputConfig.bitrate) cmd.audioBitrate(outputConfig.bitrate)

    cmd.on("end", () => resolve()).on("error", reject).save(normalizeFsPath(outputPath))
  })
}

export async function mixAudio({
  voicePath,
  musicPath,
  outputFileName,
  durationSeconds
}: MixOptions): Promise<string> {
  ensureDir(TMP_AUDIO_DIR)
  ensureFile(voicePath)
  if (musicPath && fs.existsSync(musicPath)) ensureFile(musicPath)

  const probedVoiceDuration = await probeDuration(voicePath)
  const duration =
    typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
      ? clamp(durationSeconds, MIN_DURATION_SECONDS, MAX_DURATION_SECONDS)
      : clamp(probedVoiceDuration, MIN_DURATION_SECONDS, MAX_DURATION_SECONDS)

  const outputPath = path.join(TMP_AUDIO_DIR, path.basename(outputFileName))
  const tempWavePath = uniqueTempFile("premix", "wav")
  safeUnlink(outputPath)

  try {
    await renderMixToWave({ voicePath, musicPath, outputPath: tempWavePath, duration })
    await masterAndEncode({ inputPath: tempWavePath, outputPath, duration })
    validateOutput(outputPath)
    return outputPath
  } finally {
    safeUnlink(tempWavePath)
  }
}