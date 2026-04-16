import test from "node:test"
import assert from "node:assert/strict"

import { checkoutOrChangePlanBodySchema } from "../../modules/billing/checkout-body.schema"

test("checkout body accepts plan + billing and defaults billing to monthly", () => {
  const a = checkoutOrChangePlanBodySchema.safeParse({ plan: "PRO" })
  assert.equal(a.success, true)
  if (a.success) {
    assert.equal(a.data.plan, "PRO")
    assert.equal(a.data.billing, "monthly")
  }
})

test("checkout body rejects unknown keys (strict)", () => {
  const b = checkoutOrChangePlanBodySchema.safeParse({
    plan: "PRO",
    billing: "monthly",
    priceId: "price_evil",
  })
  assert.equal(b.success, false)
})

test("checkout body rejects FREE plan string", () => {
  const c = checkoutOrChangePlanBodySchema.safeParse({ plan: "FREE" })
  assert.equal(c.success, false)
})
