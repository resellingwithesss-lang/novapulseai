/**
 * Centralized operator / affiliate contact emails from environment.
 * Do not hardcode personal addresses in product UI or business logic.
 */

function trimEnv(key: string): string {
  return (process.env[key] ?? "").trim()
}

/** Primary owner / business contact (support escalations, legal). */
export function ownerContactEmail(): string | null {
  const v = trimEnv("OWNER_CONTACT_EMAIL")
  return v || null
}

/** Shown to users for affiliate questions; falls back to owner, then null. */
export function affiliateSupportEmail(): string | null {
  const v = trimEnv("AFFILIATE_SUPPORT_EMAIL")
  if (v) return v
  return ownerContactEmail()
}

/** Optional: internal notifications for admin/affiliate ops. */
export function adminNotificationEmail(): string | null {
  const v = trimEnv("ADMIN_NOTIFICATION_EMAIL")
  if (v) return v
  return ownerContactEmail()
}

/** True when at least one public-URL env is set (not using the dev fallback). */
export function publicAppUrlIsExplicitlyConfigured(): boolean {
  return Boolean(
    trimEnv("PUBLIC_APP_URL") || trimEnv("FRONTEND_URL") || trimEnv("CLIENT_URL")
  )
}

export function publicAppUrl(): string {
  return (
    trimEnv("PUBLIC_APP_URL") ||
    trimEnv("FRONTEND_URL") ||
    trimEnv("CLIENT_URL") ||
    "http://localhost:3000"
  ).replace(/\/$/, "")
}

/** Used to warn operators when share links may not match production. */
export function publicAppUrlLooksLikeLocalFallback(url: string): boolean {
  const u = url.toLowerCase()
  return u.includes("localhost") || u.includes("127.0.0.1")
}
