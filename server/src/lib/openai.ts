import OpenAI from "openai"

/* =====================================================
MODEL CONFIG
===================================================== */

export const AI_MODELS = {
  SCRIPT: "gpt-4o",
  SCORING: "gpt-4o-mini",
  CHAT: "gpt-4o-mini",
  TTS: "gpt-4o-mini-tts",
}

/* =====================================================
OPENAI CLIENT (lazy — server can boot without OPENAI_API_KEY)
===================================================== */

let _openai: OpenAI | null = null

function requireOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to server/.env to use generation, story-maker, clips, ads, or content packs."
    )
  }
  if (!_openai) {
    _openai = new OpenAI({
      apiKey,
      timeout: 60_000,
      maxRetries: 3,
    })
  }
  return _openai
}

/** Lazily created on first use so `app.ts` can load without AI keys. */
export const openai = new Proxy({} as OpenAI, {
  get(_target, prop: string | symbol) {
    const client = requireOpenAI()
    const value = Reflect.get(client as object, prop, client) as unknown
    if (typeof value === "function") {
      return (value as (...a: unknown[]) => unknown).bind(client)
    }
    return value
  },
})

/* =====================================================
SAFE REQUEST WRAPPER
===================================================== */

export async function safeChatCompletion(options: {
  model?: string
  messages: any[]
  temperature?: number
  max_tokens?: number
}) {
  try {
    const res = await openai.chat.completions.create({
      model: options.model ?? AI_MODELS.CHAT,
      messages: options.messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 800,
    })

    return res
  } catch (err: any) {
    console.error("OpenAI Chat Error:", err?.message)
    throw err
  }
}

/* =====================================================
SCRIPT GENERATION
===================================================== */

export async function generateScriptAI(prompt: string) {
  return safeChatCompletion({
    model: AI_MODELS.SCRIPT,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.9,
    max_tokens: 1000,
  })
}

/* =====================================================
SCRIPT SCORING
===================================================== */

/** @deprecated Not used; ad scoring lives in `modules/ads/pipeline/ad.scoring` (`evaluateAdVariant`). Kept for backwards compatibility if referenced externally. */
export async function scoreScriptAI(script: string) {
  return safeChatCompletion({
    model: AI_MODELS.SCORING,
    messages: [
      {
        role: "user",
        content: `Score this ad script from 1-100.

Criteria:
Hook strength
Clarity
Persuasion
Virality potential

Script:
${script}

Return only number.`,
      },
    ],
    temperature: 0.3,
    max_tokens: 10,
  })
}

/* =====================================================
TEXT TO SPEECH
===================================================== */

export async function generateSpeech(text: string) {
  const speech = await openai.audio.speech.create({
    model: AI_MODELS.TTS,
    voice: "alloy",
    input: text,
  })

  return speech
}
