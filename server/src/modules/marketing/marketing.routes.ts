import { Router, Response } from "express"
import { z } from "zod"
import { AuditAction, MarketingConsentStatus, Prisma } from "@prisma/client"
import { prisma } from "../../lib/prisma"
import { fail, ok } from "../../lib/http"
import { requireAuth, AuthRequest } from "../auth/auth.middleware"
import { requireCsrfForCookieAuth } from "../../middlewares/csrf-protect"
import { log } from "../../lib/logger"
import { MARKETING_DISMISS_COOLDOWN_DAYS } from "../../lib/marketing-constants"

const router = Router()

/* =====================================================
   SCHEMA
===================================================== */

// Only the surfaces that the USER-facing app captures explicit answers from.
// (Admin-written consent, unsubscribe-link taps, and signup defaults are
// produced by other code paths and recorded with their own source tag.)
const USER_CAPTURE_SOURCES = [
  "onboarding",
  "dashboard_banner",
  "billing_card",
  "settings",
] as const

const patchSchema = z
  .object({
    action: z.enum(["opt_in", "opt_out", "dismiss"]),
    source: z.enum(USER_CAPTURE_SOURCES),
  })
  .strict()

/* =====================================================
   HELPERS
===================================================== */

function shouldResurface(params: {
  status: MarketingConsentStatus
  dismissedAt: Date | null
  now: Date
}): boolean {
  if (params.status === MarketingConsentStatus.OPTED_IN) return false
  if (params.status === MarketingConsentStatus.OPTED_OUT) return false

  if (
    params.status === MarketingConsentStatus.DISMISSED &&
    params.dismissedAt
  ) {
    const elapsedMs = params.now.getTime() - params.dismissedAt.getTime()
    const cooldownMs = MARKETING_DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
    return elapsedMs >= cooldownMs
  }

  // UNKNOWN and LEGACY_OPT_IN: both should get prompted.
  return true
}

function serializeConsent(u: {
  marketingEmails: boolean
  marketingConsentStatus: MarketingConsentStatus
  marketingConsentSource: string | null
  marketingConsentCapturedAt: Date | null
  marketingConsentUpdatedAt: Date | null
  marketingDismissedAt: Date | null
}) {
  return {
    marketingEmails: u.marketingEmails,
    status: u.marketingConsentStatus,
    source: u.marketingConsentSource,
    capturedAt: u.marketingConsentCapturedAt,
    updatedAt: u.marketingConsentUpdatedAt,
    dismissedAt: u.marketingDismissedAt,
  }
}

/* =====================================================
   GET /api/marketing/consent
===================================================== */

router.get("/consent", requireAuth, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      marketingEmails: true,
      marketingConsentStatus: true,
      marketingConsentSource: true,
      marketingConsentCapturedAt: true,
      marketingConsentUpdatedAt: true,
      marketingDismissedAt: true,
    },
  })

  if (!user) {
    return fail(res, 404, "User not found")
  }

  const now = new Date()
  return ok(res, {
    consent: serializeConsent(user),
    shouldResurface: shouldResurface({
      status: user.marketingConsentStatus,
      dismissedAt: user.marketingDismissedAt,
      now,
    }),
    cooldownDays: MARKETING_DISMISS_COOLDOWN_DAYS,
  })
})

/* =====================================================
   PATCH /api/marketing/consent
   { action: 'opt_in' | 'opt_out' | 'dismiss', source: <surface id> }
===================================================== */

router.patch(
  "/consent",
  requireAuth,
  requireCsrfForCookieAuth,
  async (req: AuthRequest, res: Response) => {
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) {
      return fail(res, 400, "Invalid consent payload", {
        issues: parsed.error.flatten(),
      })
    }

    const { action, source } = parsed.data
    const userId = req.user!.id
    const now = new Date()

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: {
            marketingEmails: true,
            marketingConsentStatus: true,
            marketingConsentSource: true,
            marketingConsentCapturedAt: true,
            marketingConsentUpdatedAt: true,
            marketingDismissedAt: true,
          },
        })
        if (!current) {
          throw Object.assign(new Error("USER_NOT_FOUND"), { http: 404 })
        }

        const data: Prisma.UserUpdateInput = {
          marketingConsentSource: source,
          marketingConsentUpdatedAt: now,
        }

        if (action === "opt_in") {
          data.marketingEmails = true
          data.marketingConsentStatus = MarketingConsentStatus.OPTED_IN
          if (!current.marketingConsentCapturedAt) {
            data.marketingConsentCapturedAt = now
          }
          // Clear any prior "not right now" state so it won't resurface.
          data.marketingDismissedAt = null
        } else if (action === "opt_out") {
          data.marketingEmails = false
          data.marketingConsentStatus = MarketingConsentStatus.OPTED_OUT
          if (!current.marketingConsentCapturedAt) {
            data.marketingConsentCapturedAt = now
          }
          data.marketingDismissedAt = null
        } else {
          // 'dismiss' — temporary; does NOT record an explicit answer.
          // Preserve prior marketingEmails / capturedAt (may be null for UNKNOWN).
          data.marketingConsentStatus = MarketingConsentStatus.DISMISSED
          data.marketingDismissedAt = now
          // Do not flip marketingEmails on dismiss; LEGACY_OPT_IN users stay
          // sendable until they answer explicitly.
          data.marketingEmails = current.marketingEmails
        }

        const next = await tx.user.update({
          where: { id: userId },
          data,
          select: {
            marketingEmails: true,
            marketingConsentStatus: true,
            marketingConsentSource: true,
            marketingConsentCapturedAt: true,
            marketingConsentUpdatedAt: true,
            marketingDismissedAt: true,
          },
        })

        await tx.auditLog.create({
          data: {
            userId,
            action: AuditAction.MARKETING_CONSENT_CHANGED,
            metadata: {
              action,
              source,
              previousStatus: current.marketingConsentStatus,
              previousMarketingEmails: current.marketingEmails,
              nextStatus: next.marketingConsentStatus,
              nextMarketingEmails: next.marketingEmails,
            } as Prisma.InputJsonValue,
            requestId:
              typeof req.requestId === "string" ? req.requestId : undefined,
          },
        })

        return next
      })

      log.info("marketing_consent_changed", {
        userId,
        action,
        source,
        status: updated.marketingConsentStatus,
      })

      const now2 = new Date()
      return ok(res, {
        consent: serializeConsent(updated),
        shouldResurface: shouldResurface({
          status: updated.marketingConsentStatus,
          dismissedAt: updated.marketingDismissedAt,
          now: now2,
        }),
        cooldownDays: MARKETING_DISMISS_COOLDOWN_DAYS,
      })
    } catch (err) {
      const anyErr = err as { http?: number; message?: string }
      if (anyErr?.message === "USER_NOT_FOUND") {
        return fail(res, 404, "User not found")
      }
      log.error("marketing_consent_failed", {
        userId,
        action,
        source,
        message: anyErr?.message,
      })
      return fail(res, 500, "Could not update consent")
    }
  }
)

export default router
