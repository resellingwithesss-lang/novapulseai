import test from "node:test"
import assert from "node:assert/strict"

import { SubscriptionStatus, Plan } from "@prisma/client"
import {
  proTrialPeriodDaysForCheckout,
  shouldApplyProMonthlyTrialInCheckout,
} from "../../modules/billing/pro-trial-eligibility"

const baseUser = {
  plan: Plan.FREE,
  subscriptionStatus: SubscriptionStatus.CANCELED,
  stripeSubscriptionId: null as string | null,
  billingProTrialConsumedAt: null as Date | null,
}

test("PRO monthly trial only when FREE, not consumed, trial days > 0", () => {
  const prev = process.env.STRIPE_PRO_TRIAL_DAYS
  process.env.STRIPE_PRO_TRIAL_DAYS = "14"
  assert.equal(
    shouldApplyProMonthlyTrialInCheckout("PRO", "monthly", { ...baseUser }),
    true
  )
  assert.equal(
    shouldApplyProMonthlyTrialInCheckout("PRO", "yearly", { ...baseUser }),
    false
  )
  assert.equal(
    shouldApplyProMonthlyTrialInCheckout("STARTER", "monthly", { ...baseUser }),
    false
  )
  assert.equal(
    shouldApplyProMonthlyTrialInCheckout("PRO", "monthly", {
      ...baseUser,
      billingProTrialConsumedAt: new Date(),
    }),
    false
  )
  assert.equal(
    shouldApplyProMonthlyTrialInCheckout("PRO", "monthly", {
      ...baseUser,
      plan: Plan.STARTER,
    }),
    false
  )
  process.env.STRIPE_PRO_TRIAL_DAYS = "0"
  assert.equal(shouldApplyProMonthlyTrialInCheckout("PRO", "monthly", { ...baseUser }), false)
  process.env.STRIPE_PRO_TRIAL_DAYS = prev
})

test("proTrialPeriodDaysForCheckout mirrors eligibility", () => {
  const prev = process.env.STRIPE_PRO_TRIAL_DAYS
  process.env.STRIPE_PRO_TRIAL_DAYS = "7"
  assert.equal(proTrialPeriodDaysForCheckout("PRO", "monthly", { ...baseUser }), 7)
  assert.equal(proTrialPeriodDaysForCheckout("PRO", "yearly", { ...baseUser }), undefined)
  process.env.STRIPE_PRO_TRIAL_DAYS = prev
})
