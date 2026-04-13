import { Router, Request, Response } from "express"
import Stripe from "stripe"
import { stripe } from "../../lib/stripe"
import { prisma } from "../../lib/prisma"
import { queueSubscriptionChangeEmail } from "../../lib/email-outbound"
import { SubscriptionStatus, Plan, CreditType } from "@prisma/client"
import { isStaffBillingExemptRole } from "../../lib/staff-plan"
import {
  getPlanCredits,
  normalizePlanTier,
  planRank,
  resolvePlanFromStripePriceId,
} from "../plans/plan.constants"

const router = Router()

/* =====================================================
   Stripe Safe Helpers
===================================================== */

function getCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
): string | null {
  if (!customer) return null
  if (typeof customer === "string") return customer
  if ("deleted" in customer) return null
  return customer.id
}

/**
 * Your Stripe typings/version do NOT expose subscription.current_period_start/end
 * (TS2339). Those timestamps live on the subscription item:
 *   subscription.items.data[0].current_period_start/end
 */
function getItemPeriodStart(sub: Stripe.Subscription): number | null {
  const item = sub.items?.data?.[0]
  return item?.current_period_start ?? null
}

function getItemPeriodEnd(sub: Stripe.Subscription): number | null {
  const item = sub.items?.data?.[0]
  return item?.current_period_end ?? null
}

function normalizePlan(raw: unknown): Plan | null {
  if (!raw) return null
  const value = String(raw).toUpperCase().trim()
  if (value !== "STARTER" && value !== "PRO" && value !== "ELITE") return null
  return normalizePlanTier(value)
}

function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active":
      return SubscriptionStatus.ACTIVE
    case "trialing":
      return SubscriptionStatus.TRIALING
    case "past_due":
    case "unpaid":
    case "incomplete":
      return SubscriptionStatus.PAST_DUE
    case "canceled":
    case "incomplete_expired":
      return SubscriptionStatus.CANCELED
    default:
      return SubscriptionStatus.CANCELED
  }
}

/**
 * Credits-per-plan from centralized PLAN_CONFIG.
 */
function creditsForPlan(plan: Plan): number {
  return getPlanCredits(plan)
}

/**
 * Type-safe subscription id extraction across Stripe versions.
 * Some Stripe TS versions don't include `invoice.subscription` on `Stripe.Invoice` typings.
 */
function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const sub = (invoice as any)?.subscription
  if (!sub) return null
  if (typeof sub === "string") return sub
  if (typeof sub === "object" && typeof sub.id === "string") return sub.id
  return null
}

/* =====================================================
   WEBHOOK
===================================================== */

router.post("/", async (req: Request, res: Response) => {
  const signature = req.headers["stripe-signature"] as string
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim()

  if (!signature) return res.status(400).send("Missing Stripe signature")
  if (!webhookSecret) {
    return res.status(500).send("Webhook secret missing")
  }

  let event: Stripe.Event

  try {
    // IMPORTANT: req.body must be RAW BUFFER for Stripe signature verification.
    // Make sure your Express app uses:
    // app.post("/api/billing/webhook", express.raw({ type: "application/json" }), webhookRouter)
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      webhookSecret
    )
  } catch (err: any) {
    console.error("Signature verification failed:", err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  const existingEvent = await prisma.stripeEvent.findUnique({
    where: { stripeEventId: event.id },
    select: { processed: true },
  })
  if (existingEvent?.processed) {
    return res.json({ received: true })
  }

  const lockRows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(hashtext(${event.id})) AS locked
  `
  const lockAcquired = lockRows[0]?.locked === true
  if (!lockAcquired) {
    return res.json({ received: true })
  }

  try {
    const postLockEvent = await prisma.stripeEvent.findUnique({
      where: { stripeEventId: event.id },
      select: { processed: true },
    })
    if (postLockEvent?.processed) {
      return res.json({ received: true })
    }

    switch (event.type) {
      /* =====================================================
         INVOICE PAID (CREDIT RESET / REFILL)
         - This runs each billing cycle.
         - "Hard reset" credits so they always match plan (no drift).
      ===================================================== */
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice

        const subId = getInvoiceSubscriptionId(invoice)
        if (!subId) break

        const subscription = await stripe.subscriptions.retrieve(subId)

        const userId = subscription.metadata?.userId
        const plan =
          normalizePlan(subscription.metadata?.plan) ??
          resolvePlanFromStripePriceId(subscription.items?.data?.[0]?.price?.id)

        if (!userId) {
          console.warn("Webhook invoice.paid missing userId metadata", {
            stripeEventId: event.id,
            subscriptionId: subscription.id,
          })
          break
        }
        if (!plan) {
          console.warn("Webhook invoice.paid plan resolution failed", {
            stripeEventId: event.id,
            subscriptionId: subscription.id,
            metadataPlan: subscription.metadata?.plan ?? null,
            priceId: subscription.items?.data?.[0]?.price?.id ?? null,
          })
          break
        }

        const refillCredits = creditsForPlan(plan)

        await prisma.$transaction(async (tx) => {
          const user = await tx.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              stripeCustomerId: true,
              role: true,
            },
          })

          if (!user) return
          if (isStaffBillingExemptRole(user.role)) {
            return
          }

          const stripeCustomerId = getCustomerId(subscription.customer)

          // ownership guard
          if (
            user.stripeCustomerId &&
            stripeCustomerId &&
            user.stripeCustomerId !== stripeCustomerId
          ) {
            console.warn("Stripe ownership mismatch:", userId)
            return
          }

          // ✅ Hard reset credits to plan credits (prevents 1k vs 5k drift)
          await tx.user.update({
            where: { id: userId },
            data: {
              subscriptionStatus: mapStripeStatus(subscription.status),
              subscriptionEndsAt: getItemPeriodEnd(subscription)
                ? new Date(getItemPeriodEnd(subscription)! * 1000)
                : null,
              plan,

              // HARD RESET:
              credits: refillCredits,
              monthlyCredits: refillCredits,
              monthlyResetAt: new Date(),
            },
          })

          await tx.creditTransaction.create({
            data: {
              userId,
              amount: refillCredits,
              type: CreditType.CREDIT_ADD,
              reason: "Monthly billing reset",
              metadata: {
                stripeEventId: event.id,
                stripeInvoiceId: invoice.id,
                stripeSubscriptionId: subscription.id,
                plan,
              },
            } as any, // keep compat if metadata type is JsonValue
          })
        })

        break
      }

      /* =====================================================
         SUB CREATED / UPDATED
         - Keep DB in sync with Stripe source-of-truth.
         - If plan changed, align credits to new plan cap.
      ===================================================== */
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription

        const userId = subscription.metadata?.userId
        const metadataPlan = normalizePlan(subscription.metadata?.plan)
        const pricePlan = resolvePlanFromStripePriceId(subscription.items?.data?.[0]?.price?.id)
        const plan = metadataPlan ?? pricePlan

        if (!userId) {
          console.warn("Webhook subscription event missing userId metadata", {
            stripeEventId: event.id,
            subscriptionId: subscription.id,
            type: event.type,
          })
          break
        }
        const existingUser = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            plan: true,
            trialExpiresAt: true,
            credits: true,
            role: true,
          },
        })
        if (!existingUser) break

        if (!plan) {
          console.warn("Webhook subscription plan resolution fallback used", {
            stripeEventId: event.id,
            subscriptionId: subscription.id,
            type: event.type,
            metadataPlan: subscription.metadata?.plan ?? null,
            priceId: subscription.items?.data?.[0]?.price?.id ?? null,
            fallbackPlan: existingUser.plan,
          })
        }

        let resolvedPlan = (plan ?? existingUser.plan) as Plan
        if (
          isStaffBillingExemptRole(existingUser.role) &&
          plan &&
          planRank(normalizePlanTier(plan)) < planRank(normalizePlanTier(existingUser.plan))
        ) {
          resolvedPlan = existingUser.plan as Plan
        }

        const shouldResetCreditsForPlanChange = existingUser.plan !== resolvedPlan
        const resetCredits = creditsForPlan(resolvedPlan)

        await prisma.user.update({
          where: { id: userId },
          data: {
            stripeCustomerId: getCustomerId(subscription.customer),
            stripeSubscriptionId: subscription.id,

            plan: resolvedPlan,
            subscriptionStatus: mapStripeStatus(subscription.status),

            trialExpiresAt: subscription.trial_end
              ? new Date(subscription.trial_end * 1000)
              : existingUser.trialExpiresAt,

            subscriptionStartedAt: getItemPeriodStart(subscription)
              ? new Date(getItemPeriodStart(subscription)! * 1000)
              : null,

            subscriptionEndsAt: getItemPeriodEnd(subscription)
              ? new Date(getItemPeriodEnd(subscription)! * 1000)
              : null,

            cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
            ...(shouldResetCreditsForPlanChange
              ? {
                  credits: resetCredits,
                  monthlyCredits: resetCredits,
                  monthlyResetAt: new Date(),
                }
              : {}),
          },
        })

        void queueSubscriptionChangeEmail(userId).catch((err) => {
          console.warn("[stripe] subscription email queue", err)
        })

        break
      }

      /* =====================================================
         SUB DELETED
      ===================================================== */
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata?.userId
        if (!userId) break

        const subUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { role: true },
        })
        if (!subUser) break

        if (isStaffBillingExemptRole(subUser.role)) {
          await prisma.user.update({
            where: { id: userId },
            data: {
              stripeSubscriptionId: null,
              subscriptionStatus: SubscriptionStatus.CANCELED,
              subscriptionStartedAt: null,
              subscriptionEndsAt: null,
              cancelAtPeriodEnd: false,
            },
          })
        } else {
          await prisma.user.update({
            where: { id: userId },
            data: {
              plan: Plan.FREE,
              subscriptionStatus: SubscriptionStatus.CANCELED,
              stripeSubscriptionId: null,
              subscriptionStartedAt: null,
              subscriptionEndsAt: null,
              cancelAtPeriodEnd: false,
              credits: creditsForPlan(Plan.FREE),
              monthlyCredits: creditsForPlan(Plan.FREE),
              monthlyResetAt: new Date(),
            },
          })
        }

        void queueSubscriptionChangeEmail(userId).catch((err) => {
          console.warn("[stripe] subscription email queue", err)
        })

        break
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice
        const subId = getInvoiceSubscriptionId(invoice)
        if (!subId) break
        const subscription = await stripe.subscriptions.retrieve(subId)
        const userId = subscription.metadata?.userId
        if (!userId) break
        await prisma.user.update({
          where: { id: userId },
          data: {
            subscriptionStatus: SubscriptionStatus.PAST_DUE,
            subscriptionEndsAt: getItemPeriodEnd(subscription)
              ? new Date(getItemPeriodEnd(subscription)! * 1000)
              : null,
          },
        })
        break
      }

      default:
        break
    }

    await prisma.stripeEvent.upsert({
      where: { stripeEventId: event.id },
      update: {
        type: event.type,
        processed: true,
      },
      create: {
        stripeEventId: event.id,
        type: event.type,
        processed: true,
      },
    })

    return res.json({ received: true })
  } catch (error) {
    console.error("Webhook error:", error)
    return res.status(500).send("Webhook failed")
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(hashtext(${event.id}))`
  }
})

export default router