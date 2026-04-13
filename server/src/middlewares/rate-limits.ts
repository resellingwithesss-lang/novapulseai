import rateLimit from "express-rate-limit"

const isProduction = process.env.NODE_ENV === "production"

/** Health checks should not consume API quota. */
export function skipHealthAndStatic(req: import("express").Request): boolean {
  const p = req.path || ""
  if (p === "/health" || p.startsWith("/health/")) return true
  if (p.startsWith("/clips/") || p === "/clips") return true
  if (p.startsWith("/generated/") || p === "/generated") return true
  return false
}

/**
 * Auth routes already use dedicated limiters; counting them here too burns
 * the global budget on legitimate login bursts.
 */
export function skipAuthRoutes(req: import("express").Request): boolean {
  return req.path.startsWith("/api/auth")
}

/**
 * Default API limiter — skips health, static media, and /api/auth/*.
 */
export const globalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 800 : 5000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    skipHealthAndStatic(req) || skipAuthRoutes(req),
  message: { success: false, message: "Too many requests, please try again later." },
})

/**
 * Stricter limit for expensive or abuse-prone tool routes (mount on specific routers).
 */
export function createToolLimiter(maxPerWindow: number) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? maxPerWindow : Math.max(maxPerWindow, 200),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => skipHealthAndStatic(req),
    message: { success: false, message: "Too many tool requests, please slow down." },
  })
}
