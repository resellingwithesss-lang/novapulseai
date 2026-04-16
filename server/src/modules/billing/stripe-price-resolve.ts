import type { Plan } from "@prisma/client"
import { PLAN_CONFIG, PAID_PLAN_TIERS, type PlanTier } from "../plans/plan.constants"

export type PaidPlanTier = Exclude<Plan, "FREE">

const PAID_SET = new Set<string>(PAID_PLAN_TIERS)

export function parsePaidPlanTier(raw: unknown): PaidPlanTier | null {
  if (typeof raw !== "string") return null
  const u = raw.toUpperCase().trim()
  if (u === "FREE") return null
  if (!PAID_SET.has(u)) return null
  return u as PaidPlanTier
}

export type BillingInterval = "monthly" | "yearly"

export function parseBillingInterval(raw: unknown): BillingInterval {
  return String(raw).toLowerCase() === "yearly" ? "yearly" : "monthly"
}

/**
 * Resolves internal tier + interval to the **server-approved** Stripe price id from env.
 * Never accepts a client-supplied price id.
 */
export function resolveApprovedStripePriceId(
  tier: PaidPlanTier,
  interval: BillingInterval
): string | null {
  const row = PLAN_CONFIG[tier as PlanTier]
  const id = interval === "yearly" ? row.yearlyPriceId : row.priceId
  if (!id?.trim()) return null
  const t = id.trim()
  if (/replace_with|STRIPE_(STARTER|PRO|ELITE)_ID/i.test(t)) return null
  return t
}
