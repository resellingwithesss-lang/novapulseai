import type {
  GenerationAttemptDiagnostic,
  GenerationErrorClass,
  RetryDecision,
  RetryTiming,
} from "./generation.contract";
import type { ParseFailureReason } from "./generation.output";
import {
  GENERATION_RETRY_BASE_DELAY_MS,
  GENERATION_RETRY_JITTER_RATIO,
  GENERATION_RETRY_MAX_DELAY_MS,
} from "./generation.contract";

type RetryTaggedError = Error & {
  nonRetriable?: boolean
  parseFailureReason?: ParseFailureReason
}

export function classifyRetryableError(error: unknown): RetryDecision {
  const err = error as RetryTaggedError
  const message = (err?.message || "").toLowerCase()

  if (err?.nonRetriable) {
    if (err.parseFailureReason === "JSON_PARSE_FAILED") {
      return {
        retriable: false,
        errorClass: "MODEL_PARSE_FAILED",
        reason: "parse_failure",
      }
    }
    if (err.parseFailureReason === "UNSUPPORTED_SHAPE") {
      return {
        retriable: false,
        errorClass: "MODEL_UNSUPPORTED_SHAPE",
        reason: "unsupported_shape",
      }
    }
    if (err.parseFailureReason === "EMPTY_OR_TOO_LARGE") {
      return {
        retriable: false,
        errorClass: "OPENAI_EMPTY_CONTENT",
        reason: "empty_or_too_large",
      }
    }
    return {
      retriable: false,
      errorClass: "MODEL_OUTPUT_INVALID",
      reason: "non_retriable_marked",
    }
  }

  const transientPatterns = [
    "timeout",
    "network",
    "fetch",
    "rate limit",
    "too many requests",
    "temporarily unavailable",
    "service unavailable",
    "bad gateway",
    "gateway timeout",
    "econnreset",
    "etimedout",
    "enotfound",
    "eai_again",
    "429",
    "500",
    "502",
    "503",
    "504",
  ]

  const isTransient = transientPatterns.some((pattern) =>
    message.includes(pattern)
  )

  if (isTransient) {
    return {
      retriable: true,
      errorClass: "OPENAI_REQUEST_ERROR",
      reason: "transient_error_match",
    }
  }

  return {
    retriable: false,
    errorClass: "UNKNOWN",
    reason: "unknown_non_retriable_default",
  }
}

export function computeRetryDelay(
  attempt: number,
  options?: {
    baseDelayMs?: number
    maxDelayMs?: number
    jitterRatio?: number
  }
): RetryTiming {
  const baseDelayMs = options?.baseDelayMs ?? GENERATION_RETRY_BASE_DELAY_MS
  const maxDelayMs = options?.maxDelayMs ?? GENERATION_RETRY_MAX_DELAY_MS
  const jitterRatio = options?.jitterRatio ?? GENERATION_RETRY_JITTER_RATIO

  const exponential = baseDelayMs * Math.pow(2, Math.max(0, attempt - 1))
  const clamped = Math.min(maxDelayMs, exponential)
  const jitterSpan = Math.round(clamped * jitterRatio)
  const jitterMs = Math.floor(Math.random() * (jitterSpan * 2 + 1)) - jitterSpan
  const delayMs = Math.max(0, clamped + jitterMs)

  return { delayMs, jitterMs }
}

export async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runWithRetry<T>(
  task: (attempt: number) => Promise<T>,
  options: {
    requestId: string
    getElapsedMs: () => number
    maxAttempts: number
    onAttemptFailure: (diag: GenerationAttemptDiagnostic) => void
    shouldRetry?: (decision: RetryDecision) => boolean
  }
): Promise<T> {
  const {
    requestId,
    getElapsedMs,
    maxAttempts,
    onAttemptFailure,
    shouldRetry,
  } = options

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStartedAt = Date.now()

    try {
      return await task(attempt)
    } catch (error) {
      const err = error as RetryTaggedError
      const decision = classifyRetryableError(error)
      const allowRetry = shouldRetry ? shouldRetry(decision) : decision.retriable
      const isFinalAttempt = attempt >= maxAttempts

      let delayBeforeNextMs: number | undefined
      if (allowRetry && !isFinalAttempt) {
        const timing = computeRetryDelay(attempt)
        delayBeforeNextMs = timing.delayMs
      }

      onAttemptFailure({
        requestId,
        attempt,
        maxAttempts,
        errorClass: decision.errorClass,
        retriable: allowRetry && !isFinalAttempt,
        elapsedMs: getElapsedMs(),
        attemptDurationMs: Date.now() - attemptStartedAt,
        delayBeforeNextMs,
        parseFailureReason: err.parseFailureReason,
      })

      if (!allowRetry || isFinalAttempt) {
        throw error
      }

      await sleepMs(delayBeforeNextMs || 0)
    }
  }

  throw new Error("retry_exhausted")
}
