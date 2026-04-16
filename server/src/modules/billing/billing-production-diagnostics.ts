import type { PaidPlanTier } from "./stripe-price-resolve"
import type { BillingInterval } from "./stripe-price-resolve"

/** Never log the full secret — prefix family only. */
export function stripeSecretKeyMode(): "live" | "test" | "unknown" {
  const k = process.env.STRIPE_SECRET_KEY?.trim() ?? ""
  if (k.startsWith("sk_live_") || k.startsWith("rk_live_")) return "live"
  if (k.startsWith("sk_test_") || k.startsWith("rk_test_")) return "test"
  return "unknown"
}

export function stripePriceEnvVarForTier(
  tier: PaidPlanTier,
  interval: BillingInterval
): string {
  const y = interval === "yearly"
  if (tier === "STARTER") return y ? "STRIPE_PRICE_STARTER_YEARLY" : "STRIPE_PRICE_STARTER_MONTHLY"
  if (tier === "PRO") return y ? "STRIPE_PRICE_PRO_YEARLY" : "STRIPE_PRICE_PRO_MONTHLY"
  return y ? "STRIPE_PRICE_ELITE_YEARLY" : "STRIPE_PRICE_ELITE_MONTHLY"
}

/**
 * PLAN_CONFIG embeds `process.env.*` at module load. If env changes without a cold
 * restart (rare on Vercel, possible in long-lived workers), resolved id can disagree
 * with current `process.env`.
 */
export function stripePriceImportTimeVsRuntimeEnv(
  tier: PaidPlanTier,
  interval: BillingInterval,
  resolvedFromPlanConfig: string
): {
  envVar: string
  importTimeDrift: boolean
  runtimeEnvPrefix: string
  resolvedPrefix: string
} {
  const envVar = stripePriceEnvVarForTier(tier, interval)
  const runtime = process.env[envVar]?.trim() ?? ""
  return {
    envVar,
    importTimeDrift: Boolean(runtime) && runtime !== resolvedFromPlanConfig,
    runtimeEnvPrefix: runtime.slice(0, 12),
    resolvedPrefix: resolvedFromPlanConfig.slice(0, 12),
  }
}

export function safeRequestHostFields(req: {
  hostname?: string
  get(name: string): string | undefined
}): Record<string, string> {
  const xfHost = req.get("x-forwarded-host")?.trim().slice(0, 120) ?? ""
  const host = (req.hostname ?? "").slice(0, 120)
  return {
    reqHost: host,
    xForwardedHost: xfHost || "(none)",
  }
}

export function bodyShapeForBillingLog(
  body: unknown,
  contentType: string
): { contentTypePrefix: string; bodyKind: string; bodyKeys: string } {
  const bodyKind =
    body === null || body === undefined
      ? "empty"
      : Array.isArray(body)
        ? "array"
        : typeof body
  const bodyKeys =
    body && typeof body === "object" && !Array.isArray(body)
      ? Object.keys(body as Record<string, unknown>).join(",")
      : ""
  return {
    contentTypePrefix: contentType.slice(0, 80),
    bodyKind,
    bodyKeys: bodyKeys.slice(0, 120),
  }
}

/** Short, grep-friendly hints for Vercel — no PII. */
export function billingProdFailureHint(args: {
  billingFailureCode: string
  stripeKeyMode: ReturnType<typeof stripeSecretKeyMode>
}): string {
  const { billingFailureCode, stripeKeyMode } = args
  if (
    billingFailureCode === "STRIPE_RESOURCE_MISSING" ||
    billingFailureCode === "STRIPE_PRICE_NOT_FOUND"
  ) {
    if (stripeKeyMode === "live") {
      return "live_key_no_resource_use_live_dashboard_price_ids_not_test"
    }
    if (stripeKeyMode === "test") {
      return "test_key_no_resource_use_test_dashboard_price_ids_not_live"
    }
    return "resource_missing_check_sk_prefix_matches_price_dashboard_mode"
  }
  if (billingFailureCode === "STRIPE_CUSTOMER_NOT_FOUND") {
    return "customer_id_stale_or_wrong_mode_clear_or_new_checkout"
  }
  if (billingFailureCode === "STRIPE_SUBSCRIPTION_NOT_FOUND") {
    return "sub_missing_clear_db_or_sk_mode_mismatch_vs_subscription_origin"
  }
  return ""
}
