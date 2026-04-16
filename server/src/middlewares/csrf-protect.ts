import type { NextFunction, Request, Response } from "express"
import { buildProductionCorsOriginSet } from "../lib/cors-allowlist"

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

function cookieSessionPresent(req: Request): boolean {
  return typeof req.cookies?.token === "string" && req.cookies.token.trim().length > 0
}

function requestOrigin(req: Request): string | null {
  const origin = req.get("origin")?.trim()
  if (origin) return origin

  const referer = req.get("referer")?.trim()
  if (!referer) return null
  try {
    return new URL(referer).origin
  } catch {
    return null
  }
}

function allowedOriginsForEnvironment(isProduction: boolean): Set<string> {
  if (!isProduction) {
    return new Set(["http://localhost:3000", "http://127.0.0.1:3000"])
  }
  return buildProductionCorsOriginSet()
}

function requestIdFrom(req: Request): string | undefined {
  const value = (req as Request & { requestId?: string }).requestId
  return typeof value === "string" ? value : undefined
}

/**
 * Protect mutating endpoints from browser CSRF when using cookie sessions.
 * Bearer-token clients remain unaffected.
 */
export function requireCsrfForCookieAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
    return next()
  }

  if (!cookieSessionPresent(req)) {
    return next()
  }

  if (req.get("x-requested-with") !== "XMLHttpRequest") {
    return res.status(403).json({
      success: false,
      code: "CSRF_BLOCKED",
      message: "Missing CSRF request header.",
      requestId: requestIdFrom(req),
    })
  }

  const origin = requestOrigin(req)
  const allowed = allowedOriginsForEnvironment(process.env.NODE_ENV === "production")
  if (!origin || !allowed.has(origin)) {
    return res.status(403).json({
      success: false,
      code: "CSRF_BLOCKED",
      message: "Origin not allowed.",
      requestId: requestIdFrom(req),
    })
  }

  return next()
}
