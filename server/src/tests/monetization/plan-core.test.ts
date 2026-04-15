import test from "node:test"
import assert from "node:assert/strict"

import {
  PLAN_CONFIG,
  getPlanCredits,
  getProCheckoutTrialDays,
  hasPlanAtLeast,
  normalizePlanTier,
  planIncludesTool,
  resolvePlanFromStripePriceId,
} from "../../modules/plans/plan.constants"

test("plan config credits and tools are correct", () => {
  assert.equal(PLAN_CONFIG.FREE.credits, 4)
  assert.deepEqual(PLAN_CONFIG.FREE.tools, ["video-script"])
  assert.equal(PLAN_CONFIG.STARTER.credits, 200)
  assert.equal(PLAN_CONFIG.PRO.credits, 1000)
  assert.equal(PLAN_CONFIG.ELITE.credits, 5000)

  assert.deepEqual(PLAN_CONFIG.STARTER.tools, ["clipper", "prompt"])
  assert.deepEqual(PLAN_CONFIG.PRO.tools, [
    "clipper",
    "prompt",
    "story-maker",
    "video-script",
  ])
  assert.equal(PLAN_CONFIG.ELITE.tools, "ALL")
  assert.equal(planIncludesTool("ELITE", "story-video-maker"), true)
  assert.equal(planIncludesTool("FREE", "video-script"), true)
  assert.equal(planIncludesTool("FREE", "clipper"), false)
  assert.equal(planIncludesTool("STARTER", "video-script"), false)
})

test("plan ladder ordering and minimum checks are safe", () => {
  assert.equal(hasPlanAtLeast("FREE", "FREE"), true)
  assert.equal(hasPlanAtLeast("STARTER", "FREE"), true)
  assert.equal(hasPlanAtLeast("STARTER", "STARTER"), true)
  assert.equal(hasPlanAtLeast("PRO", "STARTER"), true)
  assert.equal(hasPlanAtLeast("ELITE", "PRO"), true)

  assert.equal(hasPlanAtLeast("FREE", "STARTER"), false)
  assert.equal(hasPlanAtLeast("STARTER", "PRO"), false)
  assert.equal(hasPlanAtLeast("PRO", "ELITE"), false)

  assert.equal(normalizePlanTier("free"), "FREE")
  assert.equal(normalizePlanTier("starter"), "STARTER")
  assert.equal(normalizePlanTier("pro"), "PRO")
  assert.equal(normalizePlanTier("elite"), "ELITE")
  assert.equal(normalizePlanTier("unknown_plan"), "FREE")
})

test("stripe price id mapping and trial policy are correct", () => {
  const trialDays = getProCheckoutTrialDays()
  assert.ok(trialDays >= 0 && trialDays <= 90)
  assert.equal(PLAN_CONFIG.FREE.priceId, undefined)
  assert.equal(PLAN_CONFIG.STARTER.priceId !== undefined, true)

  assert.equal(
    resolvePlanFromStripePriceId(PLAN_CONFIG.STARTER.priceId),
    "STARTER"
  )
  if (PLAN_CONFIG.STARTER.yearlyPriceId) {
    assert.equal(
      resolvePlanFromStripePriceId(PLAN_CONFIG.STARTER.yearlyPriceId),
      "STARTER"
    )
  }
  assert.equal(resolvePlanFromStripePriceId(PLAN_CONFIG.PRO.priceId), "PRO")
  if (PLAN_CONFIG.PRO.yearlyPriceId) {
    assert.equal(
      resolvePlanFromStripePriceId(PLAN_CONFIG.PRO.yearlyPriceId),
      "PRO"
    )
  }
  assert.equal(resolvePlanFromStripePriceId(PLAN_CONFIG.ELITE.priceId), "ELITE")
  if (PLAN_CONFIG.ELITE.yearlyPriceId) {
    assert.equal(
      resolvePlanFromStripePriceId(PLAN_CONFIG.ELITE.yearlyPriceId),
      "ELITE"
    )
  }

  assert.equal(resolvePlanFromStripePriceId("price_invalid"), null)
  assert.equal(resolvePlanFromStripePriceId(undefined), null)
  assert.equal(getPlanCredits("unknown_plan"), 4)
})
