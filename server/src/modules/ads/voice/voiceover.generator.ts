import path from "path"
import crypto from "crypto"
import ffmpeg from "fluent-ffmpeg"
import { generateVoiceover as generateServiceVoiceover, VoiceOption } from "../ads.service"

export interface VoiceoverOptions {
  script: string
  voice?: VoiceOption
}

export async function generateVoiceover(options: VoiceoverOptions): Promise<string> {
  return generateServiceVoiceover(
    options.script,
    options.voice || "alloy"
  )
}

const TMP_DIR = path.resolve("tmp")

/**
 * Silent stereo track for "music only" exports — honest alternative when skipping TTS.
 */
export async function generateSilentVoiceTrack(seconds: number): Promise<string> {
  const dur = Math.min(300, Math.max(3, seconds))
  const out = path.join(TMP_DIR, `silent-vo-${Date.now()}-${crypto.randomUUID()}.mp3`)
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input("anullsrc=r=48000:cl=stereo")
      .inputOptions(["-f", "lavfi", "-t", String(dur)])
      .audioCodec("libmp3lame")
      .audioBitrate("128k")
      .on("end", () => resolve())
      .on("error", err => reject(err))
      .save(out)
  })
  return out
}