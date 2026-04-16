import test from "node:test"
import assert from "node:assert/strict"

import {
  billingProdFailureHint,
  stripePriceEnvVarForTier,
  stripePriceImportTimeVsRuntimeEnv,
  stripeSecretKeyMode,
} from "../../modules/billing/billing-production-diagnostics"

test("stripeSecretKeyMode reads key family only", () => {
  const prev = process.env.STRIPE_SECRET_KEY
  process.env.STRIPE_SECRET_KEY = "sk_live_xxxxxxxx"
  assert.equal(stripeSecretKeyMode(), "live")
  process.env.STRIPE_SECRET_KEY = "sk_test_xxxxxxxx"
  assert.equal(stripeSecretKeyMode(), "test")
  process.env.STRIPE_SECRET_KEY = ""
  assert.equal(stripeSecretKeyMode(), "unknown")
  process.env.STRIPE_SECRET_KEY = prev
})

test("stripePriceEnvVarForTier maps tier and interval", () => {
  assert.equal(stripePriceEnvVarForTier("PRO", "monthly"), "STRIPE_PRICE_PRO_MONTHLY")
  assert.equal(stripePriceEnvVarForTier("ELITE", "yearly"), "STRIPE_PRICE_ELITE_YEARLY")
})

test("stripePriceImportTimeVsRuntimeEnv detects drift", () => {
  const prev = process.env.STRIPE_PRICE_PRO_MONTHLY
  process.env.STRIPE_PRICE_PRO_MONTHLY = "price_runtime123"
  const d = stripePriceImportTimeVsRuntimeEnv("PRO", "monthly", "price_frozen456")
  assert.equal(d.importTimeDrift, true)
  assert.equal(d.envVar, "STRIPE_PRICE_PRO_MONTHLY")
  process.env.STRIPE_PRICE_PRO_MONTHLY = prev
})

test("billingProdFailureHint ties resource_missing to key mode", () => {
  assert.ok(
    billingProdFailureHint({
      billingFailureCode: "STRIPE_RESOURCE_MISSING",
      stripeKeyMode: "live",
    }).includes("live")
  )
  assert.ok(
    billingProdFailureHint({
      billingFailureCode: "STRIPE_RESOURCE_MISSING",
      stripeKeyMode: "test",
    }).includes("test")
  )
})
