import { Router, Response } from "express"
import { stripe } from "../../lib/stripe"
import { prisma } from "../../lib/prisma"
import { resolveFrontendBaseUrl } from "../../lib/frontend-url"
import { requireAuth, AuthRequest } from "../auth/auth.middleware"
import { buildEntitlementSnapshot } from "./billing.access"

const router = Router()

/* =========================================
   GET CURRENT SUBSCRIPTION
========================================= */

router.get(
  "/entitlement",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false })
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          plan: true,
          subscriptionStatus: true,
          trialExpiresAt: true,
          stripeSubscriptionId: true,
          banned: true,
          credits: true,
          role: true,
        },
      })

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        })
      }

      const entitlement = buildEntitlementSnapshot(user)
      return res.json({
        success: true,
        entitlement,
      })
    } catch {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch entitlement",
      })
    }
  }
)

/* =========================================
  GET CURRENT SUBSCRIPTION
========================================= */

router.get(
  "/subscription",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false })
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          plan: true,
          subscriptionStatus: true,
          subscriptionStartedAt: true,
          subscriptionEndsAt: true,
          trialExpiresAt: true,
          cancelAtPeriodEnd: true,
          stripeSubscriptionId: true,
          stripeCustomerId: true,
        },
      })

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        })
      }

      const { stripeCustomerId, ...rest } = user

      return res.json({
        success: true,
        subscription: {
          ...rest,
          hasStripeCustomer: Boolean(stripeCustomerId),
        },
      })
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch subscription",
      })
    }
  }
)

/* =========================================
  INVOICES
========================================= */

router.get(
  "/invoices",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false })
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { stripeCustomerId: true },
      })

      if (!user?.stripeCustomerId) {
        return res.json({ success: true, invoices: [] })
      }

      const result = await stripe.invoices.list({
        customer: user.stripeCustomerId,
        limit: 20,
      })

      const invoices = result.data.map((invoice) => ({
        id: invoice.id,
        created: invoice.created,
        status: invoice.status,
        amount_paid: invoice.amount_paid,
        hosted_invoice_url: invoice.hosted_invoice_url,
      }))

      return res.json({ success: true, invoices })
    } catch {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch invoices",
      })
    }
  }
)

/* =========================================
  STRIPE PORTAL
========================================= */

router.post(
  "/portal",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false })
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { stripeCustomerId: true },
      })

      if (!user?.stripeCustomerId) {
        return res.status(400).json({
          success: false,
          message: "No Stripe customer",
        })
      }

      const base = resolveFrontendBaseUrl()
      if (!base) {
        return res.status(500).json({
          success: false,
          message:
            "Billing portal is not configured: set FRONTEND_URL or CLIENT_URL on the API server.",
        })
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${base}/dashboard/billing`,
      })

      return res.json({ success: true, url: session.url })
    } catch {
      return res.status(500).json({
        success: false,
        message: "Failed to open billing portal",
      })
    }
  }
)

/* =========================================
   CANCEL SUBSCRIPTION
========================================= */

router.post(
  "/cancel",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false })
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { stripeSubscriptionId: true },
      })

      if (!user?.stripeSubscriptionId) {
        return res.status(400).json({
          success: false,
          message: "No active subscription",
        })
      }

      await stripe.subscriptions.update(
        user.stripeSubscriptionId,
        {
          cancel_at_period_end: true,
        }
      )

      await prisma.user.update({
        where: { id: req.user.id },
        data: { cancelAtPeriodEnd: true },
      })

      return res.json({ success: true })
    } catch {
      return res.status(500).json({
        success: false,
        message: "Cancel failed",
      })
    }
  }
)

/* =========================================
   RESUME SUBSCRIPTION
========================================= */

router.post(
  "/resume",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false })
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { stripeSubscriptionId: true },
      })

      if (!user?.stripeSubscriptionId) {
        return res.status(400).json({
          success: false,
          message: "No subscription found",
        })
      }

      await stripe.subscriptions.update(
        user.stripeSubscriptionId,
        {
          cancel_at_period_end: false,
        }
      )

      await prisma.user.update({
        where: { id: req.user.id },
        data: { cancelAtPeriodEnd: false },
      })

      return res.json({ success: true })
    } catch {
      return res.status(500).json({
        success: false,
        message: "Resume failed",
      })
    }
  }
)

export default router