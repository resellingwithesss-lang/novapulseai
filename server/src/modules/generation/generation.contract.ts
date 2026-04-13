import { z } from "zod"
import type { ParseFailureReason } from "./generation.output"

export const GENERATION_COST = 1
export const GENERATION_COOLDOWN_MS = 3000
export const GENERATION_MAX_TOKENS = 4500
export const GENERATION_MAX_SCRIPTS = 5
export const GENERATION_MAX_RETRIES = 3
export const GENERATION_MAX_OUTPUT_LENGTH = 32000
/** Full model for multi-script JSON — stronger reasoning than mini. */
export const GENERATION_MODEL = "gpt-4o"
export const GENERATION_RETRY_BASE_DELAY_MS = 300
export const GENERATION_RETRY_MAX_DELAY_MS = 2000
export const GENERATION_RETRY_JITTER_RATIO = 0.2

export type GenerationType = "VIDEO" | "STORY"

export const generationInputSchema = z.object({
  input: z.string().min(3).max(500),
  type: z.enum(["VIDEO", "STORY"]).default("VIDEO"),
  tone: z.string().min(1).max(60).default("Educational"),
  intensity: z.coerce.number().min(1).max(10).default(5),
  controversy: z.coerce.number().min(1).max(10).default(3),
  platform: z.string().max(48).optional(),
  audience: z.string().max(96).optional(),
  experience: z.string().max(48).optional(),
  goal: z.string().max(48).optional(),
  psychology: z.string().max(72).optional(),
  format: z.string().max(48).optional(),
  pov: z.string().max(48).optional(),
  emotion: z.string().max(48).optional(),
  workspaceId: z.string().min(5).max(64).optional(),
  brandVoiceId: z.string().min(5).max(64).optional(),
  sourceContentPackId: z.string().min(5).max(64).optional(),
  sourceGenerationId: z.string().min(5).max(64).optional(),
  sourceType: z.enum(["CONTENT_PACK", "GENERATION", "MANUAL"]).optional(),
})

export type GenerationInput = z.infer<typeof generationInputSchema>

export type RawScript = {
  hook?: unknown
  openLoop?: unknown
  body?: unknown
  cta?: unknown
  caption?: unknown
  hashtags?: unknown
  retentionScore?: unknown
  hookStrength?: unknown
  controversyScore?: unknown
}

export type FinalScript = {
  hook: string
  openLoop: string
  body: string
  cta: string
  caption: string
  hashtags: string[]
  retentionScore: number
  hookStrength: number
  controversyScore: number
}

export type GenerationErrorClass =
  | "OPENAI_REQUEST_ERROR"
  | "OPENAI_EMPTY_CONTENT"
  | "MODEL_PARSE_FAILED"
  | "MODEL_UNSUPPORTED_SHAPE"
  | "MODEL_OUTPUT_INVALID"
  | "UNKNOWN"

export type GenerationAttemptDiagnostic = {
  requestId: string
  attempt: number
  maxAttempts: number
  errorClass?: GenerationErrorClass
  retriable: boolean
  elapsedMs: number
  attemptDurationMs?: number
  delayBeforeNextMs?: number
  parseFailureReason?: ParseFailureReason
}

export type RetryDecision = {
  retriable: boolean
  errorClass: GenerationErrorClass
  reason: string
}

export type RetryTiming = {
  delayMs: number
  jitterMs: number
}

export type GenerationAccountingErrorCode =
  | "USER_NOT_FOUND"
  | "ACCOUNT_SUSPENDED"
  | "SUBSCRIPTION_REQUIRED"
  | "TRIAL_EXPIRED"
  | "INSUFFICIENT_CREDITS"
  | "COOLDOWN_ACTIVE"
