import { Response, NextFunction } from "express"
import { prisma } from "../../lib/prisma"
import { AuthRequest } from "../auth/auth.middleware"
import { CreditType } from "@prisma/client"
import { getPlanCredits, isFreePlanTier, normalizePlanTier } from "../plans/plan.constants"

interface CreditOptions {
  allowNegativeCost?: boolean
  maxCostOverride?: number
  skipLogging?: boolean
  enforceDailyLimit?: boolean
  enforceMonthlyLimit?: boolean
}

export const requireCredits = (
  cost: number,
  reason = "Usage",
  options: CreditOptions = {}
) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const startTime = Date.now()

    try {
      /* =====================================================
         1. AUTH VALIDATION
      ===================================================== */
      if (!req.user?.id) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        })
      }

      const userId = req.user.id

      /* =====================================================
         2. COST VALIDATION & SANITY CHECKS
      ===================================================== */

      if (typeof cost !== "number" || isNaN(cost)) {
        return res.status(400).json({
          success: false,
          message: "Invalid credit cost",
        })
      }

      if (!options.allowNegativeCost && cost <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid credit amount",
        })
      }

      if (cost > 10000 && !options.maxCostOverride) {
        console.warn("Suspicious high credit cost attempt:", {
          userId,
          cost,
          reason,
        })

        return res.status(400).json({
          success: false,
          message: "Credit cost exceeds allowed threshold",
        })
      }

      /* =====================================================
         3. ATOMIC TRANSACTION
      ===================================================== */

      await prisma.$transaction(async (tx) => {
        /* 3.1 Fetch user with strong consistency */
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            credits: true,
            subscriptionStatus: true,
            stripeSubscriptionId: true,
            plan: true,
          },
        })

        if (!user) {
          throw new Error("USER_NOT_FOUND")
        }

        const tier = normalizePlanTier(user.plan)

        /* 3.2 FREE: credits only — no paid subscription check */
        if (!isFreePlanTier(tier)) {
          if (
            user.subscriptionStatus !== "ACTIVE" &&
            user.subscriptionStatus !== "TRIALING"
          ) {
            throw new Error("SUBSCRIPTION_CANCELED")
          }
        }

        const planCreditCap = getPlanCredits(user.plan)
        if (user.credits > planCreditCap) {
          await tx.user.update({
            where: { id: userId },
            data: { credits: planCreditCap },
          })
        }

        /* 3.3 Atomic decrement */
        const updated = await tx.user.updateMany({
          where: {
            id: userId,
            credits: { gte: cost },
          },
          data: {
            credits: { decrement: cost },
          },
        })

        if (updated.count === 0) {
          throw new Error("INSUFFICIENT_CREDITS")
        }

        /* 3.4 Ledger record */
        if (!options.skipLogging) {
          await tx.creditTransaction.create({
            data: {
              userId,
              amount: cost,
              type: CreditType.CREDIT_USE,
              reason,
            },
          })
        }
      })

      /* =====================================================
         4. PERFORMANCE LOGGING
      ===================================================== */

      const duration = Date.now() - startTime
      if (duration > 1000) {
        console.warn("Slow credit middleware execution:", {
          userId,
          duration,
          reason,
        })
      }

      return next()
    } catch (error) {
      /* =====================================================
         5. STRUCTURED ERROR HANDLING
      ===================================================== */

      if (error instanceof Error) {
        switch (error.message) {
          case "INSUFFICIENT_CREDITS":
            return res.status(403).json({
              success: false,
              message: "Not enough credits",
            })

          case "USER_NOT_FOUND":
            return res.status(404).json({
              success: false,
              message: "User not found",
            })

          case "SUBSCRIPTION_CANCELED":
            return res.status(403).json({
              success: false,
              message: "Subscription inactive",
            })
        }
      }

      console.error("CREDIT_ERROR:", {
        userId: req.user?.id,
        error,
        timestamp: new Date().toISOString(),
      })

      return res.status(500).json({
        success: false,
        message: "Credit processing failed",
      })
    }
  }
}
