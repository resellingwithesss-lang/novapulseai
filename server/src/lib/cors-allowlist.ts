import type { CorsOptions } from "cors"

/**
 * Normalizes env URLs to `Origin` header form (`scheme://host[:port]`, no path).
 */
function normalizeToOrigin(raw: string | undefined): string | null {
  if (!raw?.trim()) return null
  const t = raw.trim()
  try {
    const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`
    return new URL(withScheme).origin
  } catch {
    return null
  }
}

/**
 * Origins permitted for credentialed browser requests in production.
 * Sources: `CLIENT_URL`, `FRONTEND_URL`, and comma-separated `ALLOWED_ORIGINS`.
 */
export function buildProductionCorsOriginSet(): Set<string> {
  const set = new Set<string>()
  const add = (raw: string | undefined) => {
    const o = normalizeToOrigin(raw)
    if (o) set.add(o)
  }
  add(process.env.CLIENT_URL)
  add(process.env.FRONTEND_URL)
  const extra =
    process.env.ALLOWED_ORIGINS?.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean) ??
    []
  for (const e of extra) add(e)
  return set
}

/**
 * - **Development:** permissive (any `Origin`), same as historical `origin: true`.
 * - **Production:** explicit allowlist; missing config → deny credentialed browser CORS (logged).
 */
export function createCorsOptions(isProduction: boolean): CorsOptions {
  const allowed = buildProductionCorsOriginSet()

  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true)
        return
      }
      if (!isProduction) {
        callback(null, true)
        return
      }
      if (allowed.size === 0) {
        console.error(
          "[cors] Production allowlist is empty. Set CLIENT_URL, FRONTEND_URL, and/or ALLOWED_ORIGINS."
        )
        callback(null, false)
        return
      }
      callback(null, allowed.has(origin))
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-Id",
      "X-Requested-With",
      "Idempotency-Key",
    ],
    exposedHeaders: ["X-Request-Id"],
  }
}
