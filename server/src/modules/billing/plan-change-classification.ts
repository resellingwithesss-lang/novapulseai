import { Plan, SubscriptionStatus } from "@prisma/client"
import { normalizePlanTier, planRank, PLAN_CONFIG, type PlanTier } from "../plans/plan.constants"
import type { PaidPlanTier } from "./stripe-price-resolve"
import type { BillingInterval } from "./stripe-price-resolve"

export type PlanChangeClassification =
  | "upgrade"
  | "downgrade"
  | "lateral_interval_change"
  | "cancel_to_free"
  | "no_change"
  | "invalid_change"

export type BillingIntervalLabel = BillingInterval

/** Infer monthly vs yearly from which env-backed Stripe price id matches. */
export function inferBillingIntervalFromStripePriceId(
  priceId: string | null | undefined
): BillingIntervalLabel | null {
  if (!priceId?.trim()) return null
  const id = priceId.trim()
  for (const tier of ["STARTER", "PRO", "ELITE"] as const) {
    const row = PLAN_CONFIG[tier]
    if (row.priceId === id) return "monthly"
    if (row.yearlyPriceId === id) return "yearly"
  }
  return null
}

export type PlanChangeRequestInput = {
  currentPlan: Plan
  targetPlan: PaidPlanTier
  targetBilling: BillingIntervalLabel
  currentStripePriceId: string | null | undefined
  subscriptionStatus: SubscriptionStatus
}

export type PlanChangeRequestResult = {
  classification: PlanChangeClassification
  currentBilling: BillingIntervalLabel | null
  reason?: string
}

const ACTIVE_LIKE = new Set<SubscriptionStatus>([
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
])

/**
 * Classifies a requested paid plan change for an existing Stripe subscriber.
 * Does not perform Stripe calls — safe for unit tests.
 */
export function classifyPlanChangeRequest(input: PlanChangeRequestInput): PlanChangeRequestResult {
  const currentTier = normalizePlanTier(input.currentPlan) as PlanTier
  const targetTier = normalizePlanTier(input.targetPlan) as PlanTier

  if (!ACTIVE_LIKE.has(input.subscriptionStatus)) {
    return {
      classification: "invalid_change",
      currentBilling: inferBillingIntervalFromStripePriceId(input.currentStripePriceId),
      reason: "subscription_not_active_for_plan_change",
    }
  }

  if (!input.currentStripePriceId?.trim()) {
    return {
      classification: "invalid_change",
      currentBilling: null,
      reason: "missing_current_stripe_price",
    }
  }

  const currentBilling = inferBillingIntervalFromStripePriceId(input.currentStripePriceId)
  if (!currentBilling) {
    return {
      classification: "invalid_change",
      currentBilling: null,
      reason: "unknown_current_stripe_price_interval",
    }
  }

  const rankCur = planRank(currentTier)
  const rankTgt = planRank(targetTier)

  if (rankTgt > rankCur) {
    return { classification: "upgrade", currentBilling }
  }

  if (rankTgt < rankCur) {
    return { classification: "downgrade", currentBilling }
  }

  // Same paid tier — billing interval change only
  if (currentBilling !== input.targetBilling) {
    return { classification: "lateral_interval_change", currentBilling }
  }

  return { classification: "no_change", currentBilling }
}
