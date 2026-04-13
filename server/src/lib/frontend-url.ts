/**
 * Canonical browser origin for Stripe Customer Portal return_url and similar redirects.
 * Prefer FRONTEND_URL, then CLIENT_URL, then PUBLIC_APP_URL.
 */
export function resolveFrontendBaseUrl(): string {
  const raw =
    process.env.FRONTEND_URL?.trim() ||
    process.env.CLIENT_URL?.trim() ||
    process.env.PUBLIC_APP_URL?.trim() ||
    ""
  if (!raw) return ""
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  return withScheme.replace(/\/$/, "")
}
