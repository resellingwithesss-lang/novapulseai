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