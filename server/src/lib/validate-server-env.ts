import { buildProductionCorsOriginSet } from "./cors-allowlist"
import { isPlausibleStripePriceId } from "../modules/billing/stripe-billing-errors"

const isProduction = process.env.NODE_ENV === "production"

function die(msg: string): never {
  console.error(msg)
  process.exit(1)
}

function requireNonEmpty(name: string, value: string | undefined): string {
  const v = value?.trim()
  if (!v) die(`❌ Missing required environment variable: ${name}`)
  return v
}

/**
 * Validates environment at process startup (after `loadServerEnv()`).
 * In `NODE_ENV=production`, applies stricter checks for billing, AI, CORS, and Stripe webhooks.
 */
export function validateServerEnvironment(): void {
  requireNonEmpty("JWT_SECRET", process.env.JWT_SECRET)
  const jwt = process.env.JWT_SECRET!.trim()
  if (jwt.length < 32) {
    die("❌ JWT_SECRET must be at least 32 characters in all environments.")
  }

  requireNonEmpty("GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID)
  requireNonEmpty("GOOGLE_CLIENT_SECRET", process.env.GOOGLE_CLIENT_SECRET)

  if (!isProduction) return

  requireNonEmpty("DATABASE_URL", process.env.DATABASE_URL)

  requireNonEmpty("OPENAI_API_KEY", process.env.OPENAI_API_KEY)

  requireNonEmpty("STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY)
  requireNonEmpty("STRIPE_WEBHOOK_SECRET", process.env.STRIPE_WEBHOOK_SECRET)

  const cors = buildProductionCorsOriginSet()
  if (cors.size === 0) {
    die(
      "❌ Production CORS allowlist is empty. Set at least one of: CLIENT_URL, FRONTEND_URL, or ALLOWED_ORIGINS " +
        "(comma-separated origins, no paths)."
    )
  }

  const frontend =
    process.env.FRONTEND_URL?.trim() ||
    process.env.CLIENT_URL?.trim() ||
    process.env.PUBLIC_APP_URL?.trim()
  if (!frontend) {
    die(
      "❌ Production requires FRONTEND_URL or CLIENT_URL (or PUBLIC_APP_URL) for Stripe billing portal return URLs and email links."
    )
  }

  const placeholder = (v: string | undefined) =>
    !v?.trim() || /replace_with|STRIPE_(STARTER|PRO|ELITE)_ID/i.test(v.trim())

  const stripePriceEnvKeys = [
    "STRIPE_PRICE_STARTER_MONTHLY",
    "STRIPE_PRICE_STARTER_YEARLY",
    "STRIPE_PRICE_PRO_MONTHLY",
    "STRIPE_PRICE_PRO_YEARLY",
    "STRIPE_PRICE_ELITE_MONTHLY",
    "STRIPE_PRICE_ELITE_YEARLY",
  ] as const

  for (const key of stripePriceEnvKeys) {
    const raw = process.env[key]
    if (placeholder(raw)) {
      die(
        `❌ Production requires ${key} set to a real Stripe Price id (price_...). Placeholders break checkout and plan changes.`
      )
    }
    const v = raw!.trim()
    if (!isPlausibleStripePriceId(v)) {
      die(
        `❌ ${key} must look like a Stripe price id (price_...). Got malformed value (length ${v.length}).`
      )
    }
  }

  const trialRaw = process.env.STRIPE_PRO_TRIAL_DAYS?.trim()
  if (trialRaw) {
    const n = Number.parseInt(trialRaw, 10)
    if (!Number.isFinite(n) || n < 0 || n > 90) {
      console.warn(
        "⚠️ STRIPE_PRO_TRIAL_DAYS must be an integer 0–90 when set; ignoring invalid value at runtime."
      )
    }
  }
}
