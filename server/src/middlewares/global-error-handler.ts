import type { Request, Response, NextFunction } from "express"
import { normalizeHttpError } from "../lib/http-error"
import { log, serializeErr } from "../lib/logger"
import { resolveRequestId, toolFail } from "../lib/tool-response"

const isProduction = process.env.NODE_ENV === "production"

/**
 * Central Express error middleware. Prefer `next(err)` from async handlers
 * with `HttpError` or thrown Prisma / Zod errors.
 *
 * Response shape matches existing `toolFail` contracts.
 */
export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (res.headersSent) {
    log.error("response_already_sent", {
      requestId: resolveRequestId(req),
      ...serializeErr(err),
    })
    return
  }

  const http = normalizeHttpError(err)
  const requestId = resolveRequestId(req)

  const payload: Record<string, unknown> = {
    requestId,
    stage: "failed",
    status: "failed",
    code: http.code,
  }

  if (!isProduction && http.details !== undefined) {
    payload.details = http.details
  }

  if (!http.isOperational || http.statusCode >= 500) {
    log.error("request_failed", {
      requestId,
      path: req.originalUrl,
      method: req.method,
      statusCode: http.statusCode,
      code: http.code,
      operational: http.isOperational,
      ...serializeErr(err),
    })
  } else if (!isProduction && http.statusCode >= 400) {
    log.warn("request_client_error", {
      requestId,
      path: req.originalUrl,
      method: req.method,
      statusCode: http.statusCode,
      code: http.code,
      message: http.message,
    })
  }

  const clientMessage =
    isProduction && !http.isOperational
      ? "Internal server error"
      : http.message

  toolFail(res, http.statusCode, clientMessage, payload)
}

/** Async wrapper: forwards rejections to Express error handler. */
export function asyncHandler<
  Req extends Request,
  Res extends Response,
  Ret,
>(
  fn: (req: Req, res: Res, next: NextFunction) => Promise<Ret>
): (req: Req, res: Res, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
