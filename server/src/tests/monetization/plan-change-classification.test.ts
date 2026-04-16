import test from "node:test"
import assert from "node:assert/strict"
import { Plan, SubscriptionStatus } from "@prisma/client"

import { PLAN_CONFIG } from "../../modules/plans/plan.constants"
import {
  classifyPlanChangeRequest,
  inferBillingIntervalFromStripePriceId,
} from "../../modules/billing/plan-change-classification"

test("inferBillingIntervalFromStripePriceId maps PLAN_CONFIG prices", () => {
  const monthly = PLAN_CONFIG.PRO.priceId
  assert.ok(monthly)
  assert.equal(inferBillingIntervalFromStripePriceId(monthly), "monthly")
  const yearly = PLAN_CONFIG.PRO.yearlyPriceId
  if (yearly?.trim()) {
    assert.equal(inferBillingIntervalFromStripePriceId(yearly), "yearly")
  }
})

test("classifyPlanChangeRequest upgrade vs downgrade vs lateral", () => {
  const starterM = PLAN_CONFIG.STARTER.priceId
  const proM = PLAN_CONFIG.PRO.priceId
  const eliteM = PLAN_CONFIG.ELITE.priceId
  const proY = PLAN_CONFIG.PRO.yearlyPriceId

  assert.ok(starterM && proM && eliteM, "PLAN_CONFIG must expose monthly price ids")

  assert.equal(
    classifyPlanChangeRequest({
      currentPlan: Plan.STARTER,
      targetPlan: "PRO",
      targetBilling: "monthly",
      currentStripePriceId: starterM,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
    }).classification,
    "upgrade"
  )
  assert.equal(
    classifyPlanChangeRequest({
      currentPlan: Plan.ELITE,
      targetPlan: "STARTER",
      targetBilling: "monthly",
      currentStripePriceId: eliteM,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
    }).classification,
    "downgrade"
  )

  if (proY?.trim()) {
    assert.equal(
      classifyPlanChangeRequest({
        currentPlan: Plan.PRO,
        targetPlan: "PRO",
        targetBilling: "yearly",
        currentStripePriceId: proM,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      }).classification,
      "lateral_interval_change"
    )
  }

  assert.equal(
    classifyPlanChangeRequest({
      currentPlan: Plan.PRO,
      targetPlan: "PRO",
      targetBilling: "monthly",
      currentStripePriceId: proM,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
    }).classification,
    "no_change"
  )
})

test("classifyPlanChangeRequest invalid when not active-like", () => {
  const proM = PLAN_CONFIG.PRO.priceId
  assert.ok(proM)
  const r = classifyPlanChangeRequest({
    currentPlan: Plan.PRO,
    targetPlan: "ELITE",
    targetBilling: "monthly",
    currentStripePriceId: proM,
    subscriptionStatus: SubscriptionStatus.PAST_DUE,
  })
  assert.equal(r.classification, "invalid_change")
  assert.ok(r.reason)
})
