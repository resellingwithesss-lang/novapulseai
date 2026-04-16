import type { Plan, SubscriptionStatus } from "@prisma/client"
import { getProCheckoutTrialDays, isFreePlanTier } from "../plans/plan.constants"
import type { BillingInterval } from "./stripe-price-resolve"
import type { PaidPlanTier } from "./stripe-price-resolve"

export type TrialEligibilityUserFields = {
  plan: Plan
  subscriptionStatus: SubscriptionStatus
  stripeSubscriptionId: string | null
  billingProTrialConsumedAt: Date | null
}

/**
 * PRO **monthly** checkout only: Stripe `subscription_data.trial_period_days` when eligible.
 * Server-side only; never trust the client for trial.
 */
export function shouldApplyProMonthlyTrialInCheckout(
  targetTier: PaidPlanTier,
  billingInterval: BillingInterval,
  user: TrialEligibilityUserFields
): boolean {
  if (targetTier !== "PRO" || billingInterval !== "monthly") return false

  const days = getProCheckoutTrialDays()
  if (days <= 0) return false

  if (user.billingProTrialConsumedAt) return false

  if (!isFreePlanTier(user.plan)) return false

  if (
    user.stripeSubscriptionId &&
    (user.subscriptionStatus === "ACTIVE" || user.subscriptionStatus === "TRIALING")
  ) {
    return false
  }

  return true
}

export function proTrialPeriodDaysForCheckout(
  targetTier: PaidPlanTier,
  billingInterval: BillingInterval,
  user: TrialEligibilityUserFields
): number | undefined {
  if (!shouldApplyProMonthlyTrialInCheckout(targetTier, billingInterval, user)) {
    return undefined
  }
  const d = getProCheckoutTrialDays()
  return d > 0 ? d : undefined
}
