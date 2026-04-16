import test from "node:test"
import assert from "node:assert/strict"

import {
  parseBillingInterval,
  parsePaidPlanTier,
  resolveApprovedStripePriceId,
} from "../../modules/billing/stripe-price-resolve"

test("parsePaidPlanTier rejects FREE and junk", () => {
  assert.equal(parsePaidPlanTier("FREE"), null)
  assert.equal(parsePaidPlanTier("enterprise"), null)
  assert.equal(parsePaidPlanTier("PRO"), "PRO")
  assert.equal(parsePaidPlanTier("elite"), "ELITE")
})

test("parseBillingInterval defaults to monthly", () => {
  assert.equal(parseBillingInterval(undefined), "monthly")
  assert.equal(parseBillingInterval("MONTHLY"), "monthly")
  assert.equal(parseBillingInterval("yearly"), "yearly")
})

test("resolveApprovedStripePriceId returns null for placeholders", () => {
  const prev = { ...process.env }
  process.env.STRIPE_PRICE_PRO_MONTHLY = "replace_with_stripe_price_id"
  assert.equal(resolveApprovedStripePriceId("PRO", "monthly"), null)
  process.env.STRIPE_PRICE_PRO_MONTHLY = prev.STRIPE_PRICE_PRO_MONTHLY
})
