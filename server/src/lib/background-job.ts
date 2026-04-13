import type { LimitFunction } from "p-limit"
import { log, serializeErr } from "./logger"

export type BackgroundJobMeta = Record<string, unknown>

/**
 * Runs async work through a limiter (e.g. p-limit) with structured logging.
 * Does not change job row state — domain code should persist success/failure.
 */
export function runLimitedBackgroundJob(
  limit: LimitFunction,
  meta: BackgroundJobMeta,
  task: () => Promise<void>
): void {
  void limit(async () => {
    const started = Date.now()
    try {
      await task()
    } catch (err) {
      log.error("background_job_unhandled", {
        ...meta,
        durationMs: Date.now() - started,
        ...serializeErr(err),
      })
    }
  })
}

export type RetryOptions = {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Small exponential backoff helper for transient failures (network, busy workers).
 * Caller decides whether an error is retriable.
 */
export async function withBackoffRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
  isRetriable: (err: unknown) => boolean
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastErr = err
      if (attempt >= options.maxAttempts || !isRetriable(err)) {
        throw err
      }
      const exp = Math.min(
        options.maxDelayMs,
        options.baseDelayMs * 2 ** (attempt - 1)
      )
      const jitter = Math.floor(Math.random() * 250)
      await sleep(exp + jitter)
    }
  }
  throw lastErr
}
