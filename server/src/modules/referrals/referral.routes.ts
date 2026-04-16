import { Router } from "express"
import { prisma } from "../../lib/prisma"
import { ok, fail } from "../../lib/http"
import { requireAuth, AuthRequest } from "../auth/auth.middleware"
import {
  affiliateSupportEmail,
  publicAppUrl,
  publicAppUrlIsExplicitlyConfigured,
  publicAppUrlLooksLikeLocalFallback,
} from "../../lib/app-contact"
import {
  ensureUserReferralCode,
  normalizeReferralCode,
} from "./referral.service"
import { ReferralCommissionStatus } from "@prisma/client"

const router = Router()

router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return fail(res, 401, "Unauthorized")
    const userId = req.user.id

    const code = await ensureUserReferralCode(userId)
    const appOrigin = publicAppUrl()
    const link = `${appOrigin}/register?ref=${encodeURIComponent(code)}`

    const [signupCount, commissions] = await Promise.all([
      prisma.user.count({ where: { referredByUserId: userId, deletedAt: null } }),
      prisma.referralCommission.groupBy({
        by: ["status"],
        where: { referrerUserId: userId },
        _sum: { commissionAmountMinor: true },
        _count: { _all: true },
      }),
    ])

    const toNum = (v: unknown): number => {
      if (typeof v === "bigint") return Number(v)
      if (typeof v === "number" && Number.isFinite(v)) return v
      const n = Number(v)
      return Number.isFinite(n) ? n : 0
    }

    const byStatus: Record<string, { count: number; totalMinor: number }> = {}
    for (const row of commissions) {
      byStatus[row.status] = {
        count: row._count._all,
        totalMinor: toNum(row._sum.commissionAmountMinor),
      }
    }

    const pendingMinor =
      (byStatus[ReferralCommissionStatus.PENDING]?.totalMinor ?? 0) +
      (byStatus[ReferralCommissionStatus.APPROVED]?.totalMinor ?? 0)
    const paidMinor = byStatus[ReferralCommissionStatus.PAID]?.totalMinor ?? 0

    const explicitUrl = publicAppUrlIsExplicitlyConfigured()
    const looksLocal = publicAppUrlLooksLikeLocalFallback(appOrigin)
    const shareLinkWarning =
      process.env.NODE_ENV === "production" && (!explicitUrl || looksLocal)
        ? "Share links use a fallback or local URL. Set PUBLIC_APP_URL (or FRONTEND_URL / CLIENT_URL) on the API server to your live app origin."
        : !explicitUrl && looksLocal
          ? "For production, set PUBLIC_APP_URL on the server so referral links point to your real signup page."
          : null

    return ok(res, {
      referralCode: code,
      referralLink: link,
      shareLinkConfigured: explicitUrl && !looksLocal,
      shareLinkWarning,
      signups: signupCount,
      commissions: {
        byStatus,
        pendingMinor,
        paidMinor,
        /** Basis points: 500 = 5% */
        rateBps: Number(process.env.REFERRAL_COMMISSION_RATE_BPS ?? "500") || 500,
        firstPaymentOnly: process.env.REFERRAL_FIRST_PAYMENT_ONLY !== "false",
      },
      supportEmail: affiliateSupportEmail(),
    })
  } catch (err) {
    console.error("REFERRAL_ME_ERROR", err)
    return fail(res, 500, "Could not load referral profile")
  }
})

/** Optional: validate a code before signup (public, rate-limited by global limiter). */
router.get("/lookup", async (req, res) => {
  try {
    const code = normalizeReferralCode(
      typeof req.query.code === "string" ? req.query.code : null
    )
    if (!code) {
      return ok(res, { valid: false })
    }
    const u = await prisma.user.findFirst({
      where: {
        referralCode: code,
        deletedAt: null,
        banned: false,
      },
      select: { id: true },
    })
    return ok(res, { valid: Boolean(u) })
  } catch (err) {
    console.error("REFERRAL_LOOKUP_ERROR", err)
    return fail(res, 500, "Lookup failed")
  }
})

export default router
