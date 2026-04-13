/**
 * Public site URL for links inside emails (unsubscribe, billing, login).
 * Set in production: PUBLIC_APP_URL=https://yourdomain.com
 */
export function getPublicAppUrl(): string {
  const raw =
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000"
  return raw.replace(/\/$/, "")
}

/** Verified sender in Resend (domain or onboarding@resend.dev in dev). */
export function getResendFromAddress(): string {
  return (
    process.env.RESEND_FROM_EMAIL?.trim() || "NovaPulseAI <onboarding@resend.dev>"
  )
}

export function isEmailSystemConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim())
}
