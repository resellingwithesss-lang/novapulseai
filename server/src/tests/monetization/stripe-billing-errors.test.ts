import test from "node:test"
import assert from "node:assert/strict"
import Stripe from "stripe"

import {
  classifyBillingRouteError,
  isPlausibleStripePriceId,
  isStripeSubscriptionMissingError,
} from "../../modules/billing/stripe-billing-errors"

test("isPlausibleStripePriceId accepts real-looking ids", () => {
  assert.equal(isPlausibleStripePriceId("price_1ABCdefGHIjklMN"), true)
})

test("isPlausibleStripePriceId rejects junk", () => {
  assert.equal(isPlausibleStripePriceId(""), false)
  assert.equal(isPlausibleStripePriceId("pi_123"), false)
  assert.equal(isPlausibleStripePriceId("price_"), false)
  assert.equal(isPlausibleStripePriceId("price_bad id"), false)
})

test("classifyBillingRouteError maps subscription resource_missing to 409", () => {
  const err = new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code: "resource_missing",
    message: "No such subscription: 'sub_test_123'",
  })
  const c = classifyBillingRouteError(err, { requestId: "r1", operation: "subscription_update" })
  assert.equal(c.httpStatus, 409)
  assert.equal(c.code, "STRIPE_SUBSCRIPTION_NOT_FOUND")
})

test("classifyBillingRouteError maps price resource_missing to STRIPE_PRICE_NOT_FOUND", () => {
  const err = new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code: "resource_missing",
    message: "No such price: 'price_123'",
  })
  const c = classifyBillingRouteError(err, { requestId: "r1", operation: "checkout" })
  assert.equal(c.httpStatus, 400)
  assert.equal(c.code, "STRIPE_PRICE_NOT_FOUND")
})

test("isStripeSubscriptionMissingError is true only for subscription-shaped resource_missing", () => {
  const subErr = new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code: "resource_missing",
    message: "No such subscription: 'sub_x'",
  })
  assert.equal(isStripeSubscriptionMissingError(subErr), true)

  const priceErr = new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code: "resource_missing",
    message: "No such price: 'price_x'",
  })
  assert.equal(isStripeSubscriptionMissingError(priceErr), false)
})

test("classifyBillingRouteError maps customer resource_missing to STRIPE_CUSTOMER_NOT_FOUND", () => {
  const err = new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code: "resource_missing",
    message: "No such customer: 'cus_123'",
  })
  const c = classifyBillingRouteError(err, { requestId: "r1", operation: "checkout" })
  assert.equal(c.httpStatus, 400)
  assert.equal(c.code, "STRIPE_CUSTOMER_NOT_FOUND")
})

test("classifyBillingRouteError maps invalid API key to 503", () => {
  const err = new Stripe.errors.StripeAuthenticationError({
    type: "authentication_error",
    code: "invalid_api_key",
    message: "Invalid API Key",
  })
  const c = classifyBillingRouteError(err, { requestId: "r1", operation: "x" })
  assert.equal(c.httpStatus, 503)
  assert.equal(c.code, "STRIPE_AUTH_CONFIG")
})
