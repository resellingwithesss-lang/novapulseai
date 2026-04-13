import { Router, Response } from "express"
import { stripe } from "../../lib/stripe"
import { resolveFrontendBaseUrl } from "../../lib/frontend-url"
import { requireAuth, AuthRequest } from "../auth/auth.middleware"
import { prisma } from "../../lib/prisma"
import { fail, ok } from "../../lib/http"
import { SubscriptionStatus, Plan } from "@prisma/client"
import { PLAN_CONFIG, PAID_PLAN_TIERS, planRank } from "../plans/plan.constants"

const router = Router()

type BillingCycle = "monthly" | "yearly"

type PaidPlan = Exclude<Plan, "FREE">

/* =====================================================
   STRIPE PRICE MAP (ENV SAFE) — paid tiers only
===================================================== */

const PRICE_MAP: Record<PaidPlan, { monthly?: string; yearly?: string }> = {
  STARTER: {
    monthly: PLAN_CONFIG.STARTER.priceId,
    yearly: PLAN_CONFIG.STARTER.yearlyPriceId,
  },
  PRO: {
    monthly: PLAN_CONFIG.PRO.priceId,
    yearly: PLAN_CONFIG.PRO.yearlyPriceId,
  },
  ELITE: {
    monthly: PLAN_CONFIG.ELITE.priceId,
    yearly: PLAN_CONFIG.ELITE.yearlyPriceId,
  },
}

/* =====================================================
   HELPERS
===================================================== */

function normalizeIncomingPlan(raw: string): PaidPlan | null {
  if (!raw) return null
  const upper = raw.toUpperCase()
  if (upper === "FREE") return null
  if (!PAID_PLAN_TIERS.includes(upper as PaidPlan)) return null
  return upper as PaidPlan
}

function normalizeBilling(raw: unknown): BillingCycle {
  return String(raw).toLowerCase() === "yearly" ? "yearly" : "monthly"
}

function isStripeSubscriptionReusable(status: string): boolean {
  return (
    status === "active" ||
    status === "trialing" ||
    status === "past_due" ||
    status === "unpaid"
  )
}

function hasUsedProTrial(trialExpiresAt: Date | null): boolean {
  return Boolean(trialExpiresAt)
}

function isDowngradePlan(current: Plan, target: Plan): boolean {
  return planRank(target) < planRank(current)
}

/* =====================================================
   MAIN HANDLER
===================================================== */

async function checkoutOrChangePlan(req: AuthRequest, res: Response) {
  try {
    if (!req.user?.id) {
      return fail(res, 401, "Unauthorized")
    }

    const plan = normalizeIncomingPlan(req.body?.plan)
    const billing = normalizeBilling(req.body?.billing)

    if (!plan) {
      return fail(res, 400, "Invalid plan selected")
    }

    const priceId = PRICE_MAP[plan]?.[billing]

    if (!priceId) {
      return fail(
        res,
        500,
        `Stripe price not configured for ${plan} (${billing})`
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    })

    if (!user) {
      return fail(res, 404, "User not found")
    }

    const frontendBase = resolveFrontendBaseUrl()
    if (!frontendBase) {
      return fail(
        res,
        500,
        "Billing is not configured: set FRONTEND_URL or CLIENT_URL on the API server."
      )
    }

    const targetPlan = plan
    const currentPlan = user.plan as Plan

    /* =====================================================
       IF ACTIVE SUBSCRIPTION → UPDATE
    ===================================================== */

    if (
      user.stripeSubscriptionId &&
      (user.subscriptionStatus === SubscriptionStatus.ACTIVE ||
        user.subscriptionStatus === SubscriptionStatus.TRIALING)
    ) {
      const subscription = await stripe.subscriptions.retrieve(
        user.stripeSubscriptionId
      )

      if (!subscription || subscription.status === "canceled") {
        return fail(res, 400, "Subscription not active in Stripe")
      }

      const currentItem = subscription.items.data[0]

      if (!currentItem) {
        return fail(res, 500, "Subscription item missing")
      }

      /* === Already on this plan === */

      if (currentItem.price.id === priceId) {
        return ok(res, {
          type: "no_change",
        })
      }
      if (isDowngradePlan(currentPlan, targetPlan)) {
        return fail(res, 400, "Downgrades are handled in Stripe billing portal")
      }

      await stripe.subscriptions.update(user.stripeSubscriptionId, {
        proration_behavior: "create_prorations",
        items: [
          {
            id: currentItem.id,
            price: priceId,
          },
        ],
        metadata: {
          userId: user.id,
          newPlan: targetPlan,
          billing,
        },
      })

      return ok(res, {
        type: "updated",
      })
    }

    /* =====================================================
       CREATE CUSTOMER IF NEEDED
    ===================================================== */

    let customerId = user.stripeCustomerId

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { userId: user.id },
      })

      customerId = customer.id

      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      })
    }

    /* =====================================================
       REUSE EXISTING STRIPE SUBSCRIPTION IF PRESENT
       (prevents duplicate subscriptions on stale DB state)
    ===================================================== */

    const existingSubscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
    })

    const reusableSubscription = existingSubscriptions.data.find((sub) =>
      isStripeSubscriptionReusable(sub.status)
    )

    if (reusableSubscription) {
      const currentItem = reusableSubscription.items.data[0]
      if (!currentItem) {
        return fail(res, 500, "Subscription item missing")
      }

      if (currentItem.price.id === priceId) {
        if (!user.stripeSubscriptionId) {
          await prisma.user.update({
            where: { id: user.id },
            data: { stripeSubscriptionId: reusableSubscription.id },
          })
        }

        return ok(res, {
          type: "no_change",
        })
      }
      if (isDowngradePlan(currentPlan, targetPlan)) {
        return fail(res, 400, "Downgrades are handled in Stripe billing portal")
      }

      await stripe.subscriptions.update(reusableSubscription.id, {
        proration_behavior: "create_prorations",
        items: [
          {
            id: currentItem.id,
            price: priceId,
          },
        ],
        metadata: {
          userId: user.id,
          newPlan: targetPlan,
          billing,
        },
      })

      if (user.stripeSubscriptionId !== reusableSubscription.id) {
        await prisma.user.update({
          where: { id: user.id },
          data: { stripeSubscriptionId: reusableSubscription.id },
        })
      }

      return ok(res, {
        type: "updated",
      })
    }

    /* =====================================================
       CREATE CHECKOUT SESSION
    ===================================================== */

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      payment_method_types: ["card"],
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days:
          targetPlan === Plan.PRO && !hasUsedProTrial(user.trialExpiresAt)
            ? PLAN_CONFIG.PRO.trialDays
            : undefined,
        metadata: {
          userId: user.id,
          plan: targetPlan,
          billing,
          proTrialEligible: String(
            targetPlan === Plan.PRO && !hasUsedProTrial(user.trialExpiresAt)
          ),
        },
      },
      success_url: `${frontendBase}/dashboard/billing?success=true`,
      cancel_url: `${frontendBase}/dashboard/billing?canceled=true`,
    })

    return ok(res, {
      type: "checkout",
      url: session.url,
    })
  } catch (error: any) {
    console.error("CHECKOUT_ERROR:", error?.message)

    return fail(res, 500, "Checkout failed")
  }
}

/* =====================================================
   ROUTES
===================================================== */

router.post("/checkout", requireAuth, checkoutOrChangePlan)
router.post("/change-plan", requireAuth, checkoutOrChangePlan)

export default router