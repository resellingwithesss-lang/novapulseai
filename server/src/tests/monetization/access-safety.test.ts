import test from "node:test"
import assert from "node:assert/strict"

import {
  buildEntitlementSnapshot,
  evaluateBillingAccess,
} from "../../modules/billing/billing.access"
import { getPlanOutputLimits, getWorkflowLimits } from "../../modules/plans/plan.constants"

test("invalid plan values normalize to FREE and do not grant paid tools", () => {
  const snapshot = buildEntitlementSnapshot({
    plan: "not_a_real_plan",
    subscriptionStatus: "ACTIVE",
    trialExpiresAt: null,
    stripeSubscriptionId: "sub_123",
    banned: false,
    credits: 100,
  })
  assert.equal(snapshot.normalizedPlan, "FREE")
  assert.equal(snapshot.featureAccess.storyMaker.allowed, false)
  assert.equal(snapshot.featureAccess.storyMaker.minimumPlan, "PRO")
})

test("FREE users can use script generation without a paid subscription", () => {
  const snapshot = buildEntitlementSnapshot({
    plan: "FREE",
    subscriptionStatus: "CANCELED",
    trialExpiresAt: null,
    stripeSubscriptionId: null,
    banned: false,
    credits: 4,
  })
  assert.equal(snapshot.blockedReason, null)
  assert.equal(snapshot.featureAccess.generation.allowed, true)
  assert.equal(snapshot.featureAccess.clip.allowed, false)
  assert.equal(snapshot.featureAccess.clip.minimumPlan, "STARTER")
  const wf = getWorkflowLimits("FREE")
  assert.equal(snapshot.workflowLimits.maxWorkspaces, wf.workspaces)
  assert.equal(snapshot.workflowLimits.maxBrandVoices, wf.brandVoices)
  assert.equal(snapshot.workflowLimits.maxContentPacks, wf.contentPacks)
  const limits = getPlanOutputLimits("FREE")
  assert.equal(snapshot.scriptVariantCount, limits.scriptVariantCount)
  assert.equal(snapshot.adVariantCount, limits.adVariantCount)
  assert.equal(snapshot.clipVariantCount, limits.clipVariantCount)
  assert.equal(snapshot.improveActionsLimit, limits.improveActionsLimit)
})

test("invalid subscription status does not unlock paid access", () => {
  const unknownStatusSnapshot = buildEntitlementSnapshot({
    plan: "ELITE",
    subscriptionStatus: "INVALID_STATUS",
    trialExpiresAt: null,
    stripeSubscriptionId: "sub_123",
    banned: false,
    credits: 100,
  })
  assert.equal(unknownStatusSnapshot.blockedReason, "SUBSCRIPTION_INACTIVE")
  assert.equal(unknownStatusSnapshot.featureAccess.generation.allowed, false)

  const pastDueSnapshot = buildEntitlementSnapshot({
    plan: "PRO",
    subscriptionStatus: "PAST_DUE",
    trialExpiresAt: null,
    stripeSubscriptionId: "sub_123",
    banned: false,
    credits: 100,
  })
  assert.equal(pastDueSnapshot.blockedReason, "SUBSCRIPTION_INACTIVE")
  assert.equal(pastDueSnapshot.featureAccess.storyMaker.allowed, false)
})

test("lower plans are blocked and allowed plans pass", () => {
  const starterSnapshot = buildEntitlementSnapshot({
    plan: "STARTER",
    subscriptionStatus: "ACTIVE",
    trialExpiresAt: null,
    stripeSubscriptionId: "sub_123",
    banned: false,
    credits: 100,
  })
  assert.equal(starterSnapshot.featureAccess.storyMaker.allowed, false)
  assert.equal(starterSnapshot.featureAccess.storyMaker.minimumPlan, "PRO")

  const proSnapshot = buildEntitlementSnapshot({
    plan: "PRO",
    subscriptionStatus: "ACTIVE",
    trialExpiresAt: null,
    stripeSubscriptionId: "sub_123",
    banned: false,
    credits: 100,
  })
  assert.equal(proSnapshot.featureAccess.storyMaker.allowed, true)

  const proBlockedForEliteOnly = buildEntitlementSnapshot({
    plan: "PRO",
    subscriptionStatus: "ACTIVE",
    trialExpiresAt: null,
    stripeSubscriptionId: "sub_123",
    banned: false,
    credits: 100,
  })
  assert.equal(proBlockedForEliteOnly.featureAccess.ads.allowed, false)
  assert.equal(proBlockedForEliteOnly.featureAccess.ads.minimumPlan, "ELITE")

  const eliteAllowed = buildEntitlementSnapshot({
    plan: "ELITE",
    subscriptionStatus: "ACTIVE",
    trialExpiresAt: null,
    stripeSubscriptionId: "sub_123",
    banned: false,
    credits: 100,
  })
  assert.equal(eliteAllowed.featureAccess.ads.allowed, true)
})

test("inactive subscription blocks top-level billing access safely", () => {
  const access = evaluateBillingAccess({
    plan: "ELITE",
    subscriptionStatus: "PAST_DUE",
    trialExpiresAt: null,
    stripeSubscriptionId: "sub_123",
    banned: false,
    credits: 100,
  })
  assert.equal(access.allowed, false)
})
