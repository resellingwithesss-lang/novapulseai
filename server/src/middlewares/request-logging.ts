import type { Request, Response, NextFunction } from "express"
import { log } from "../lib/logger"
import { resolveRequestId } from "../lib/tool-response"

const isProduction = process.env.NODE_ENV === "production"
const SLOW_MS = Number(process.env.REQUEST_LOG_SLOW_MS ?? "2000")

/**
 * Structured access log on response finish (pairs with `X-Request-Id`).
 * In development, successful fast requests are omitted to avoid duplicating `morgan`.
 */
export function requestLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now()
  res.on("finish", () => {
    const durationMs = Date.now() - start
    const requestId = resolveRequestId(req)
    const fields = {
      requestId,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      durationMs,
    }

    if (!isProduction) {
      if (res.statusCode < 400 && durationMs < SLOW_MS) return
    }

    if (res.statusCode >= 500) {
      log.error("http_request", fields)
    } else if (res.statusCode >= 400) {
      log.warn("http_request", fields)
    } else if (durationMs >= SLOW_MS) {
      log.warn("http_request_slow", fields)
    } else {
      log.info("http_request", fields)
    }
  })
  next()
}
