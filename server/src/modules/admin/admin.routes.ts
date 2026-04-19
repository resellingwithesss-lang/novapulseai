import { Router, Response } from "express"
import rateLimit from "express-rate-limit"
import { z } from "zod"
import { prisma } from "../../lib/prisma"
import { findRootJobRow, readJobMetadata } from "../ads/ad-job-lineage"
import { fail, ok } from "../../lib/http"
import { resolveRequestId } from "../../lib/tool-response"
import { requireAuth, AuthRequest } from "../auth/auth.middleware"
import { requireAdmin, requireOwner } from "../auth/admin.middleware"
import { isOwnerRole } from "../../lib/roles"
import { setAuthTokenCookie, setImpRestoreCookie } from "../auth/http-cookies"
import { signImpersonationJwt } from "../auth/jwt-signing"
import { requireCsrfForCookieAuth } from "../../middlewares/csrf-protect"
import {
  AuditAction,
  Plan,
  Prisma,
  Role,
  CreditType,
  SubscriptionStatus,
  EmailCampaignStatus,
  EmailLogType,
  ReferralCommissionStatus,
} from "@prisma/client"
import { expandAdminBroadcastAsync } from "../../lib/email-broadcast"
import { normalizePlanTier, PLAN_MONTHLY_GBP } from "../plans/plan.constants"
import { getYoutubeIngestHealthSnapshot } from "../../utils/youtube-ingest-prerequisites"
import {
  chargeCredits,
  grantCredits,
  CREDIT_REASON,
  CreditError,
} from "../../lib/credits"
import { recordAdminAudit } from "../../lib/admin-audit"
import adminMarketingRouter from "./marketing/marketing.admin.routes"

const router = Router()
const adminSafeUserSelect = {
  id: true,
  email: true,
  role: true,
  plan: true,
  subscriptionStatus: true,
  credits: true,
  banned: true,
  createdAt: true,
} as const

const emailBroadcastLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.ADMIN_EMAIL_BROADCAST_MAX_PER_HOUR ?? "8"),
  standardHeaders: true,
  legacyHeaders: false,
})

/* ===============================
   GLOBAL PROTECTION
================================ */

router.use(requireAuth)
router.use(requireAdmin)
router.use(requireCsrfForCookieAuth)

/* ===============================
   SUB-ROUTERS
   (mounted AFTER global middleware so each sub-router inherits
   requireAuth + requireAdmin + requireCsrfForCookieAuth automatically).
================================ */

router.use("/marketing", adminMarketingRouter)

/* ===============================
   DASHBOARD STATS
================================ */

/**
 * Operator-only: yt-dlp / ffmpeg / JS runtime / cookies file presence (no secrets, no cookie contents).
 */
router.get("/youtube-ingest-health", async (_req, res) => {
  try {
    return ok(res, { youtubeIngest: getYoutubeIngestHealthSnapshot() })
  } catch (err) {
    console.error("ADMIN youtube-ingest-health ERROR:", err)
    return fail(res, 500, "Failed to read YouTube ingest prerequisites")
  }
})

router.get("/dashboard", async (_req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      trialUsers,
      totalAdmins,
      totalCreditsRemaining,
      totalCreditsAdded,
      creditUses,
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({
        where: { subscriptionStatus: SubscriptionStatus.ACTIVE, deletedAt: null },
      }),
      prisma.user.count({
        where: { subscriptionStatus: SubscriptionStatus.TRIALING, deletedAt: null },
      }),
      prisma.user.count({
        where: {
          role: { in: [Role.ADMIN, Role.OWNER, Role.SUPER_ADMIN] },
          deletedAt: null,
        },
      }),
      prisma.user.aggregate({
        _sum: { credits: true },
        where: { deletedAt: null },
      }),
      prisma.creditTransaction.aggregate({
        _sum: { amount: true },
        where: {
          type: CreditType.CREDIT_ADD,
          amount: { gt: 0 },
        },
      }),
      prisma.creditTransaction.aggregate({
        _sum: { amount: true },
        where: { type: CreditType.CREDIT_USE },
      }),
    ])

    return ok(res, {
      stats: {
        totalUsers,
        activeUsers,
        trialUsers,
        totalAdmins,
        // Backward compatibility alias: issued now maps to cumulative credits added.
        totalCreditsIssued: totalCreditsAdded._sum.amount || 0,
        totalCreditsRemaining: totalCreditsRemaining._sum.credits || 0,
        totalCreditsAdded: totalCreditsAdded._sum.amount || 0,
        totalCreditsUsed: Math.abs(creditUses._sum.amount || 0),
        metricsScope: "global",
      },
    })
  } catch (err) {
    console.error("ADMIN DASHBOARD ERROR:", err)
    return fail(res, 500, "Failed to fetch admin stats")
  }
})

/**
 * Single aggregated snapshot for the admin overview dashboard (one round-trip).
 */
router.get("/overview", async (_req, res) => {
  try {
    const now = Date.now()
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(now - 7 * 86400000)
    const thirtyDaysAgo = new Date(now - 30 * 86400000)
    const staleCutoff = new Date(now - 30 * 60 * 1000)

    const [
      totalUsers,
      activeSubscriptions,
      trialingSubscriptions,
      pastDueCount,
      pausedCount,
      bannedCount,
      signups7d,
      signups30d,
      payingByPlan,
      creditsRemainingAgg,
      creditUsesAgg,
      generationAgg,
      adJobAgg,
      staleAdJobsCount,
      partialCompletionsCount,
      failedAds24h,
      recentUsers,
      recentAdJobs,
      recentFailedAds,
      staleJobSample,
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({
        where: { deletedAt: null, subscriptionStatus: SubscriptionStatus.ACTIVE },
      }),
      prisma.user.count({
        where: { deletedAt: null, subscriptionStatus: SubscriptionStatus.TRIALING },
      }),
      prisma.user.count({
        where: { deletedAt: null, subscriptionStatus: SubscriptionStatus.PAST_DUE },
      }),
      prisma.user.count({
        where: { deletedAt: null, subscriptionStatus: SubscriptionStatus.PAUSED },
      }),
      prisma.user.count({ where: { deletedAt: null, banned: true } }),
      prisma.user.count({
        where: { deletedAt: null, createdAt: { gte: sevenDaysAgo } },
      }),
      prisma.user.count({
        where: { deletedAt: null, createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.user.groupBy({
        by: ["plan"],
        where: {
          deletedAt: null,
          subscriptionStatus: {
            in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING],
          },
        },
        _count: { _all: true },
      }),
      prisma.user.aggregate({
        _sum: { credits: true },
        where: { deletedAt: null },
      }),
      prisma.creditTransaction.aggregate({
        _sum: { amount: true },
        where: { type: CreditType.CREDIT_USE },
      }),
      prisma.generation.groupBy({
        by: ["type"],
        _count: { _all: true },
        _avg: { durationMs: true },
      }),
      prisma.adJob.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.adJob.count({
        where: {
          status: { in: ["processing", "queued"] },
          updatedAt: { lte: staleCutoff },
        },
      }),
      prisma.adJob.count({
        where: {
          status: "completed",
          outputUrl: null,
        },
      }),
      prisma.adJob.count({
        where: { status: "failed", createdAt: { gte: dayAgo } },
      }),
      prisma.user.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          email: true,
          plan: true,
          subscriptionStatus: true,
          createdAt: true,
        },
      }),
      prisma.adJob.findMany({
        orderBy: { updatedAt: "desc" },
        take: 12,
        select: {
          jobId: true,
          userId: true,
          status: true,
          updatedAt: true,
          createdAt: true,
        },
      }),
      prisma.adJob.findMany({
        where: { status: "failed" },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          jobId: true,
          userId: true,
          failedReason: true,
          createdAt: true,
        },
      }),
      prisma.adJob.findMany({
        where: {
          status: { in: ["processing", "queued"] },
          updatedAt: { lte: staleCutoff },
        },
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: {
          jobId: true,
          userId: true,
          status: true,
          progress: true,
          updatedAt: true,
        },
      }),
    ])

    let estimatedMrrGbp = 0
    for (const row of payingByPlan) {
      const tier = normalizePlanTier(row.plan)
      estimatedMrrGbp += PLAN_MONTHLY_GBP[tier] * row._count._all
    }

    const adByStatus = Object.fromEntries(
      adJobAgg.map((r) => [r.status, r._count._all])
    ) as Record<string, number>

    const adJobsActive = (adByStatus.processing ?? 0) + (adByStatus.queued ?? 0)

    const generationRunsLifetime = generationAgg.reduce((s, r) => s + r._count._all, 0)

    const activity: Array<{
      id: string
      kind: "user" | "ad_job"
      at: string
      title: string
      subtitle: string
      href: string
    }> = []

    for (const u of recentUsers) {
      activity.push({
        id: `user-${u.id}`,
        kind: "user",
        at: u.createdAt.toISOString(),
        title: u.email,
        subtitle: `${normalizePlanTier(u.plan)} · ${u.subscriptionStatus}`,
        href: "/admin/subscriptions",
      })
    }
    for (const j of recentAdJobs) {
      activity.push({
        id: `job-${j.jobId}`,
        kind: "ad_job",
        at: j.updatedAt.toISOString(),
        title: j.jobId,
        subtitle: `${j.status} · user ${j.userId.slice(0, 8)}…`,
        href: "/admin/ads",
      })
    }

    activity.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    const activityTop = activity.slice(0, 18)

    const alerts: Array<{
      id: string
      severity: "critical" | "warning" | "info"
      title: string
      detail: string
      href: string
    }> = []

    if (pastDueCount > 0) {
      alerts.push({
        id: "past-due",
        severity: "critical",
        title: `${pastDueCount} past-due account${pastDueCount === 1 ? "" : "s"}`,
        detail: "Stripe could not collect payment on these subscriptions.",
        href: "/admin/subscriptions",
      })
    }
    if (staleAdJobsCount > 0) {
      alerts.push({
        id: "stale-jobs",
        severity: "warning",
        title: `${staleAdJobsCount} ad job${staleAdJobsCount === 1 ? "" : "s"} stuck >30m`,
        detail: "Queued or processing without updates — check workers and provider health.",
        href: "/admin/ads",
      })
    }
    if (partialCompletionsCount > 0) {
      alerts.push({
        id: "partial-out",
        severity: "warning",
        title: `${partialCompletionsCount} completed job${partialCompletionsCount === 1 ? "" : "s"} missing output`,
        detail: "Investigate pipeline completion vs. storage upload.",
        href: "/admin/ads",
      })
    }
    if (failedAds24h >= 5) {
      alerts.push({
        id: "fail-spike",
        severity: "warning",
        title: `${failedAds24h} ad failures in 24h`,
        detail: "Elevated failure rate — review recent errors in Ad Generator.",
        href: "/admin/ads",
      })
    }
    if (bannedCount > 0) {
      alerts.push({
        id: "banned",
        severity: "info",
        title: `${bannedCount} banned account${bannedCount === 1 ? "" : "s"}`,
        detail: "Policy or abuse holds — subscriptions may still need manual review.",
        href: "/admin/subscriptions",
      })
    }

    return ok(res, {
      refreshedAt: new Date().toISOString(),
      kpis: {
        totalUsers,
        activeSubscriptions,
        trialingSubscriptions,
        estimatedMrrGbp: Math.round(estimatedMrrGbp * 100) / 100,
        creditsRemaining: creditsRemainingAgg._sum.credits ?? 0,
        creditsUsedLifetime: Math.abs(creditUsesAgg._sum.amount ?? 0),
        generationRunsLifetime,
        adJobsActive,
        adJobsFailed24h: failedAds24h,
        adJobsFailedTotal: adByStatus.failed ?? 0,
      },
      billing: {
        pastDue: pastDueCount,
        paused: pausedCount,
      },
      health: {
        staleAdJobsCount,
        partialCompletionsCount,
        adJobsByStatus: adJobAgg.map((r) => ({
          status: r.status,
          count: r._count._all,
        })),
        generationsByType: generationAgg.map((r) => ({
          type: r.type,
          runs: r._count._all,
          avgDurationMs: Math.round(r._avg.durationMs ?? 0),
        })),
        staleJobsSample: staleJobSample.map((j) => ({
          jobId: j.jobId,
          userId: j.userId,
          status: j.status,
          progress: j.progress,
          updatedAt: j.updatedAt.toISOString(),
        })),
        recentFailedAds: recentFailedAds.map((j) => ({
          jobId: j.jobId,
          userId: j.userId,
          failedReason: j.failedReason,
          createdAt: j.createdAt.toISOString(),
        })),
      },
      growth: {
        signups7d,
        signups30d,
        payingByPlan: payingByPlan.map((r) => ({
          plan: normalizePlanTier(r.plan),
          count: r._count._all,
        })),
      },
      alerts,
      activity: activityTop,
    })
  } catch (err) {
    console.error("ADMIN OVERVIEW ERROR:", err)
    return fail(res, 500, "Failed to fetch admin overview")
  }
})

/* ===============================
   LIST USERS
================================ */

/**
 * Recent ad jobs for admin triage: review flags, lineage hints, status, output.
 * GET /api/admin/ad-jobs?limit=40
 */
router.get("/ad-jobs", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100)
    const status =
      typeof req.query.status === "string" &&
      req.query.status.trim() &&
      req.query.status !== "all"
        ? req.query.status.trim()
        : null
    const kind =
      req.query.kind === "original" || req.query.kind === "rerender"
        ? req.query.kind
        : null
    const hasOutput =
      req.query.hasOutput === "true"
        ? true
        : req.query.hasOutput === "false"
          ? false
          : null
    const query = typeof req.query.query === "string" ? req.query.query.trim() : ""

    // `cancelled` is a recent status value. Legacy rows stored
    // status="failed" with "Cancelled by user" in failedReason; include
    // both shapes when admins filter for cancelled so historical jobs
    // stay discoverable.
    const statusWhere: Prisma.AdJobWhereInput = (() => {
      if (!status) return {}
      if (status === "cancelled") {
        return {
          OR: [
            { status: "cancelled" },
            {
              AND: [
                { status: "failed" },
                { failedReason: { contains: "ancel" } },
              ],
            },
          ],
        }
      }
      if (status === "failed") {
        // Exclude legacy-cancelled rows from the "failed" bucket so the
        // admin doesn't double-count cancellations as failures.
        return {
          status: "failed",
          NOT: { failedReason: { contains: "ancel" } },
        }
      }
      return { status }
    })()

    const rows = await prisma.adJob.findMany({
      where: {
        ...statusWhere,
        ...(hasOutput === true
          ? { outputUrl: { not: null } }
          : hasOutput === false
            ? { outputUrl: null }
            : {}),
        ...(query
          ? {
              OR: [
                { jobId: { contains: query } },
                { userId: { contains: query } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        jobId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        outputUrl: true,
        metadata: true,
      },
    })

    const rootMemo = new Map<
      string,
      { rootJobId: string; preferredJobId: string | null }
    >()

    async function getRootInfo(jobId: string) {
      const hit = rootMemo.get(jobId)
      if (hit) return hit
      const root = await findRootJobRow(jobId)
      const rm = readJobMetadata({ metadata: root.metadata })
      const preferredJobId =
        typeof rm.operatorPreferredJobId === "string"
          ? rm.operatorPreferredJobId
          : null
      const info = { rootJobId: root.jobId, preferredJobId }
      rootMemo.set(jobId, info)
      return info
    }

    const jobs = await Promise.all(
      rows.map(async (row) => {
        const m = readJobMetadata({ metadata: row.metadata })
        const rerenderOf =
          typeof m.rerenderOfJobId === "string" ? m.rerenderOfJobId : null
        const kind = rerenderOf ? ("rerender" as const) : ("original" as const)
        let rootJobId = row.jobId
        let preferredJobId: string | null = null
        let isPreferred = false
        try {
          const rootInfo = await getRootInfo(row.jobId)
          rootJobId = rootInfo.rootJobId
          preferredJobId = rootInfo.preferredJobId
          isPreferred =
            preferredJobId !== null && preferredJobId === row.jobId
        } catch {
          /* keep defaults */
        }

        return {
          jobId: row.jobId,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          hasOutput: Boolean(row.outputUrl),
          kind,
          rerenderOfJobId: rerenderOf,
          rootJobId,
          preferredJobId,
          isPreferred,
          operatorApproved: m.operatorApproved === true,
          operatorFavorite: m.operatorFavorite === true,
          fastPreview: m.fastPreview === true,
        }
      })
    )
    const filteredJobs =
      kind == null
        ? jobs
        : jobs.filter((job) => (kind === "original" ? job.kind === "original" : job.kind === "rerender"))

    return ok(res, { limit, jobs: filteredJobs })
  } catch (err) {
    console.error("ADMIN AD JOBS LIST ERROR:", err)
    return fail(res, 500, "Failed to fetch ad jobs")
  }
})

router.get("/users", async (req, res) => {
  try {
    const page = Number(req.query.page) || 1
    const limit = Math.min(Number(req.query.limit) || 25, 100)
    const search = typeof req.query.search === "string" ? req.query.search.trim() : ""
    const plan = Object.values(Plan).includes(req.query.plan as Plan)
      ? (req.query.plan as Plan)
      : undefined
    const subscriptionStatus = Object.values(SubscriptionStatus).includes(
      req.query.subscriptionStatus as SubscriptionStatus
    )
      ? (req.query.subscriptionStatus as SubscriptionStatus)
      : undefined

    const where = {
      deletedAt: null,
      ...(search
        ? {
            email: {
              contains: search,
              mode: "insensitive" as const,
            },
          }
        : {}),
      ...(plan ? { plan } : {}),
      ...(subscriptionStatus ? { subscriptionStatus } : {}),
    }
    const users = await prisma.user.findMany({
      where,
      select: adminSafeUserSelect,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    })

    const total = await prisma.user.count({ where })

    return ok(res, { page, total, users, limit })
  } catch (err) {
    console.error("ADMIN USERS ERROR:", err)
    return fail(res, 500, "Failed to fetch users")
  }
})

/* ===============================
  TOOL OBSERVABILITY
================================ */

router.get("/tool-observability", async (_req, res) => {
  try {
    const [generationAgg, adJobAgg, blockedUsers, staleAdJobs, partialCompletions] = await Promise.all([
      prisma.generation.groupBy({
        by: ["type"],
        _count: { _all: true },
        _avg: { durationMs: true, creditsUsed: true },
      }),
      prisma.adJob.groupBy({
        by: ["status"],
        _count: { _all: true },
        _avg: { renderDurationMs: true },
      }),
      prisma.user.groupBy({
        by: ["subscriptionStatus", "banned"],
        _count: { _all: true },
      }),
      prisma.adJob.count({
        where: {
          status: { in: ["processing", "queued"] },
          updatedAt: {
            lte: new Date(Date.now() - 1000 * 60 * 30),
          },
        },
      }),
      prisma.adJob.count({
        where: {
          status: "completed",
          outputUrl: null,
        },
      }),
    ])

    return ok(res, {
      requestId: resolveRequestId(_req),
      observability: {
        generation: generationAgg.map((row) => ({
          tool: row.type,
          totalRuns: row._count._all,
          avgDurationMs: Math.round(row._avg.durationMs ?? 0),
          avgCreditsUsed: Number((row._avg.creditsUsed ?? 0).toFixed(2)),
        })),
        ads: adJobAgg.map((row) => ({
          status: row.status,
          totalJobs: row._count._all,
          avgRenderDurationMs: Math.round(row._avg.renderDurationMs ?? 0),
        })),
        entitlementSignals: blockedUsers.map((row) => ({
          subscriptionStatus: row.subscriptionStatus,
          banned: row.banned,
          count: row._count._all,
        })),
        reliabilitySignals: {
          staleAdJobs,
          partialCompletions,
        },
      },
    })
  } catch (err) {
    console.error("ADMIN TOOL OBSERVABILITY ERROR:", err)
    return fail(res, 500, "Failed to fetch tool observability")
  }
})

/* ===============================
  TOOL FAILURE FEED
================================ */

router.get("/tool-failures", async (_req, res) => {
  try {
    const [failedAdJobs, slowGenerations, staleAdJobs] = await Promise.all([
      prisma.adJob.findMany({
        where: { status: "failed" },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          userId: true,
          requestId: true,
          jobId: true,
          failedReason: true,
          createdAt: true,
        },
      }),
      prisma.generation.findMany({
        where: { durationMs: { gte: 60000 } },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          userId: true,
          type: true,
          requestId: true,
          durationMs: true,
          createdAt: true,
        },
      }),
      prisma.adJob.findMany({
        where: {
          status: { in: ["processing", "queued"] },
          updatedAt: {
            lte: new Date(Date.now() - 1000 * 60 * 30),
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 25,
        select: {
          id: true,
          userId: true,
          requestId: true,
          jobId: true,
          progress: true,
          updatedAt: true,
        },
      }),
    ])

    return ok(res, {
      requestId: resolveRequestId(_req),
      failures: {
        ads: failedAdJobs,
        slowGenerations,
        staleAdJobs,
      },
    })
  } catch (err) {
    console.error("ADMIN TOOL FAILURES ERROR:", err)
    return fail(res, 500, "Failed to fetch tool failures")
  }
})

/* ===============================
   UPDATE PLAN
================================ */

/**
 * Zod schemas for the user mutation endpoints. Keeps validation close to the
 * handler, and reuses Prisma enums so any schema migration forces a compile
 * break here rather than a silent drift.
 */
const planUpdateSchema = z.object({
  plan: z.nativeEnum(Plan),
  reason: z.string().trim().min(3).max(280).optional(),
})

const ADMIN_CREDIT_ADJUSTMENT_MAX = 100_000
const creditAdjustSchema = z.object({
  amount: z
    .number()
    .int("Amount must be an integer")
    .refine((n) => n !== 0, { message: "Amount cannot be zero" })
    .refine((n) => Math.abs(n) <= ADMIN_CREDIT_ADJUSTMENT_MAX, {
      message: `Absolute amount must be <= ${ADMIN_CREDIT_ADJUSTMENT_MAX}`,
    }),
  reason: z.string().trim().min(3).max(280),
})

const banUpdateSchema = z.object({
  banned: z.boolean(),
  reason: z.string().trim().min(3).max(280).optional(),
})

const deleteSchema = z.object({
  reason: z.string().trim().min(3).max(280).optional(),
})

router.patch("/users/:id/plan", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    if (!req.user) return fail(res, 401, "Unauthorized")

    const parsed = planUpdateSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return fail(res, 400, parsed.error.issues[0]?.message ?? "Invalid plan")
    }
    const { plan, reason } = parsed.data

    if (plan === Plan.ELITE && !isOwnerRole(req.user.role)) {
      return fail(res, 403, "Only Owners can assign the ELITE plan manually")
    }

    const before = await prisma.user.findUnique({
      where: { id },
      select: { id: true, plan: true },
    })
    if (!before) return fail(res, 404, "User not found")

    const updated = await prisma.user.update({
      where: { id },
      data: { plan },
      select: adminSafeUserSelect,
    })

    await recordAdminAudit({
      adminUserId: req.user.id,
      targetUserId: id,
      action: AuditAction.PLAN_CHANGED,
      requestId: resolveRequestId(req),
      metadata: {
        previousPlan: before.plan,
        plan,
        ...(reason ? { reason } : {}),
      },
    })

    return ok(res, { message: "User plan updated", user: updated })
  } catch (err) {
    console.error("ADMIN UPDATE PLAN ERROR:", err)
    return fail(res, 500, "Failed to update plan")
  }
})

/* ===============================
   CREDIT ADJUSTMENT
================================ */

router.patch("/users/:id/credits", async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    if (!req.user) return fail(res, 401, "Unauthorized")

    const parsed = creditAdjustSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return fail(res, 400, parsed.error.issues[0]?.message ?? "Invalid request")
    }
    const { amount, reason } = parsed.data

    const requestId = resolveRequestId(req)

    let result: { balanceBefore: number; balanceAfter: number }
    try {
      result = await prisma.$transaction(async (tx) => {
        if (amount > 0) {
          return grantCredits({
            tx,
            userId: id,
            amount,
            reason: reason || CREDIT_REASON.ADMIN_GRANT,
            type: CreditType.ADMIN_ADJUSTMENT,
            requestId,
            metadata: { adminUserId: req.user!.id, reason },
          })
        }
        return chargeCredits({
          tx,
          userId: id,
          amount: Math.abs(amount),
          reason: reason || CREDIT_REASON.ADMIN_DEBIT,
          type: CreditType.ADMIN_ADJUSTMENT,
          requestId,
          metadata: { adminUserId: req.user!.id, reason },
        })
      })
    } catch (err) {
      if (err instanceof CreditError) {
        if (err.code === "USER_NOT_FOUND") return fail(res, 404, "User not found")
        if (err.code === "INSUFFICIENT_CREDITS") {
          return fail(res, 400, "Cannot debit more credits than the user has")
        }
        if (err.code === "INVALID_AMOUNT") return fail(res, 400, err.message)
      }
      throw err
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: adminSafeUserSelect,
    })

    await recordAdminAudit({
      adminUserId: req.user.id,
      targetUserId: id,
      action: amount > 0 ? AuditAction.CREDITS_ADDED : AuditAction.CREDITS_USED,
      requestId,
      metadata: {
        amount,
        reason,
        balanceBefore: result.balanceBefore,
        balanceAfter: result.balanceAfter,
      },
    })

    return ok(res, {
      message: amount > 0 ? "Credits granted" : "Credits debited",
      user,
      balanceBefore: result.balanceBefore,
      balanceAfter: result.balanceAfter,
    })
  } catch (err) {
    console.error("ADMIN CREDIT ERROR:", err)
    return fail(res, 500, "Failed to adjust credits")
  }
})

/* ===============================
   BAN / UNBAN
================================ */

router.patch("/users/:id/ban", async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    if (!req.user) return fail(res, 401, "Unauthorized")

    const parsed = banUpdateSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return fail(res, 400, parsed.error.issues[0]?.message ?? "Invalid request")
    }
    const { banned, reason } = parsed.data

    if (req.user.id === id) {
      return fail(res, 400, "You cannot ban your own admin account")
    }

    const before = await prisma.user.findUnique({
      where: { id },
      select: { role: true, banned: true },
    })
    if (!before) return fail(res, 404, "User not found")
    if (isOwnerRole(before.role) && banned) {
      return fail(res, 403, "Cannot ban Owner account")
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        banned,
        tokenVersion: { increment: 1 },
      },
      select: adminSafeUserSelect,
    })

    await recordAdminAudit({
      adminUserId: req.user.id,
      targetUserId: id,
      action: AuditAction.USER_BANNED,
      requestId: resolveRequestId(req),
      metadata: {
        banned,
        previousBanned: before.banned,
        ...(reason ? { reason } : {}),
      },
    })

    return ok(res, {
      message: banned ? "User banned" : "User unbanned",
      user: updated,
    })
  } catch (err) {
    console.error("ADMIN BAN ERROR:", err)
    return fail(res, 500, "Failed to update ban status")
  }
})

/* ===============================
   SOFT DELETE
================================ */

router.delete("/users/:id", async (req: AuthRequest, res) => {
  try {
    if (!req.user) return fail(res, 401, "Unauthorized")
    const { id } = req.params

    const parsed = deleteSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return fail(res, 400, parsed.error.issues[0]?.message ?? "Invalid request")
    }
    const { reason } = parsed.data

    if (req.user.id === id) {
      return fail(res, 400, "You cannot delete your own admin account")
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { role: true, email: true },
    })

    if (!targetUser) {
      return fail(res, 404, "User not found")
    }

    if (isOwnerRole(targetUser.role)) {
      return fail(res, 403, "Cannot delete Owner account")
    }

    await prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        tokenVersion: { increment: 1 },
      },
    })

    await recordAdminAudit({
      adminUserId: req.user.id,
      targetUserId: id,
      action: AuditAction.USER_DELETED,
      requestId: resolveRequestId(req),
      metadata: {
        email: targetUser.email,
        ...(reason ? { reason } : {}),
      },
    })

    return ok(res, { message: "User deleted successfully" })
  } catch (err) {
    console.error("ADMIN DELETE ERROR:", err)
    return fail(res, 500, "Failed to delete user")
  }
})

/* ===============================
   USER DETAIL + CREDIT HISTORY
================================ */

/**
 * GET /admin/users/:id — full detail view for the admin user page.
 * Returns the safe user shape plus some at-a-glance aggregates for the UI
 * (transaction count, lifetime credits used, recent generation count).
 * The admin overview already has global aggregates; this endpoint is the
 * per-user drill-down.
 */
router.get("/users/:id", async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        plan: true,
        subscriptionStatus: true,
        subscriptionStartedAt: true,
        subscriptionEndsAt: true,
        cancelAtPeriodEnd: true,
        trialExpiresAt: true,
        credits: true,
        monthlyCredits: true,
        bonusCredits: true,
        lifetimeCreditsUsed: true,
        monthlyResetAt: true,
        banned: true,
        deletedAt: true,
        createdAt: true,
        provider: true,
      },
    })
    if (!user) return fail(res, 404, "User not found")

    const [transactionCount, generationCount, adJobCount] = await Promise.all([
      prisma.creditTransaction.count({ where: { userId: id } }),
      prisma.generation.count({ where: { userId: id } }),
      prisma.adJob.count({ where: { userId: id } }),
    ])

    return ok(res, {
      user,
      aggregates: { transactionCount, generationCount, adJobCount },
    })
  } catch (err) {
    console.error("ADMIN USER DETAIL ERROR:", err)
    return fail(res, 500, "Failed to load user")
  }
})

/**
 * GET /admin/users/:id/credit-transactions?page=&limit=
 * Per-user ledger view for the admin detail page. Mirrors the settings
 * page's ledger API (same row shape) but unrestricted to the requested
 * user rather than the caller.
 */
router.get("/users/:id/credit-transactions", async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const limit = Math.min(Math.max(Number(req.query.limit ?? 25), 1), 100)
    const page = Math.max(Number(req.query.page ?? 1), 1)
    const skip = (page - 1) * limit

    const [total, rows] = await Promise.all([
      prisma.creditTransaction.count({ where: { userId: id } }),
      prisma.creditTransaction.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          amount: true,
          type: true,
          reason: true,
          balanceAfter: true,
          requestId: true,
          metadata: true,
          createdAt: true,
        },
      }),
    ])

    return ok(res, { page, limit, total, transactions: rows })
  } catch (err) {
    console.error("ADMIN USER CREDIT HISTORY ERROR:", err)
    return fail(res, 500, "Failed to load credit history")
  }
})

/* ===============================
   EMAIL BROADCAST (MARKETING)
================================ */

router.post("/email/broadcast", emailBroadcastLimiter, async (req: AuthRequest, res) => {
  try {
    // DEPRECATED: one-shot create+send is superseded by the two-step
    // /api/admin/marketing/campaigns (DRAFT) + /send flow shipped in Phase 2.
    // Kept working for back-compat with existing scripts / cron. The new flow
    // adds template registry, segmentation, preview, test-send, and typed
    // confirmation on large sends. This endpoint will be removed once callers
    // are migrated.
    console.warn(
      "[deprecated] POST /api/admin/email/broadcast — migrate to /api/admin/marketing/campaigns",
      {
        requestId: req.requestId,
        actorId: req.user?.id,
      }
    )
    res.setHeader(
      "Deprecation",
      'true; note="use /api/admin/marketing/campaigns (Phase 2)"'
    )

    const schema = z.object({
      name: z.string().min(1).max(160),
      subject: z.string().min(1).max(200),
      html: z.string().min(1).max(600000),
      filter: z
        .object({
          plan: z.nativeEnum(Plan).optional(),
          subscriptionStatus: z.nativeEnum(SubscriptionStatus).optional(),
        })
        .strict()
        .optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return fail(res, 400, "Invalid broadcast payload", {
        issues: parsed.error.flatten(),
      })
    }

    const campaign = await prisma.emailCampaign.create({
      data: {
        name: parsed.data.name,
        subject: parsed.data.subject,
        htmlContent: parsed.data.html,
        status: EmailCampaignStatus.QUEUED,
        filter: (parsed.data.filter ?? undefined) as object | undefined,
        createdByUserId: req.user!.id,
      },
    })

    res.status(202).json({
      success: true,
      requestId: resolveRequestId(req),
      campaignId: campaign.id,
      message:
        "Broadcast queued. Recipients are built in the background; sends run via the email worker.",
    })

    void expandAdminBroadcastAsync(campaign.id)
  } catch (err) {
    console.error("ADMIN EMAIL BROADCAST ERROR:", err)
    return fail(res, 500, "Failed to queue broadcast")
  }
})

/**
 * Recent send outcomes (transactional + marketing) for support and compliance review.
 * GET /api/admin/email/logs?page=1&limit=50&type=MARKETING
 */
router.get("/email/logs", async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1)
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
    const typeParam = req.query.type
    const where: { type?: EmailLogType } = {}
    if (typeParam === EmailLogType.TRANSACTIONAL || typeParam === EmailLogType.MARKETING) {
      where.type = typeParam
    }

    const [rows, total] = await Promise.all([
      prisma.emailLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          userId: true,
          type: true,
          subject: true,
          status: true,
          errorMessage: true,
          createdAt: true,
          user: { select: { email: true } },
        },
      }),
      prisma.emailLog.count({ where }),
    ])

    return ok(res, {
      page,
      limit,
      total,
      logs: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userEmail: r.user?.email ?? null,
        type: r.type,
        subject: r.subject,
        status: r.status,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    console.error("ADMIN EMAIL LOGS ERROR:", err)
    return fail(res, 500, "Failed to fetch email logs")
  }
})

/**
 * Broadcast campaign history (queued fan-out + aggregate counts).
 * GET /api/admin/email/campaigns?page=1&limit=20
 */
router.get("/email/campaigns", async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1)
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)

    const [rows, total] = await Promise.all([
      prisma.emailCampaign.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          subject: true,
          status: true,
          filter: true,
          queuedCount: true,
          sentCount: true,
          failedCount: true,
          sentAt: true,
          createdAt: true,
          updatedAt: true,
          createdBy: { select: { id: true, email: true } },
        },
      }),
      prisma.emailCampaign.count(),
    ])

    return ok(res, {
      page,
      limit,
      total,
      campaigns: rows.map((c) => ({
        id: c.id,
        name: c.name,
        subject: c.subject,
        status: c.status,
        filter: c.filter,
        queuedCount: c.queuedCount,
        sentCount: c.sentCount,
        failedCount: c.failedCount,
        sentAt: c.sentAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        createdBy: c.createdBy,
      })),
    })
  } catch (err) {
    console.error("ADMIN EMAIL CAMPAIGNS ERROR:", err)
    return fail(res, 500, "Failed to fetch email campaigns")
  }
})

/* ===============================
   REFERRALS / AFFILIATE OPS
================================ */

router.get("/referrals/summary", async (_req, res) => {
  try {
    const [totalRows, byStatus, signupsWithReferrer] = await Promise.all([
      prisma.referralCommission.count(),
      prisma.referralCommission.groupBy({
        by: ["status"],
        _count: { _all: true },
        _sum: { commissionAmountMinor: true },
      }),
      prisma.user.count({
        where: { deletedAt: null, referredByUserId: { not: null } },
      }),
    ])

    const minor = (v: unknown): number => {
      if (typeof v === "bigint") return Number(v)
      if (typeof v === "number" && Number.isFinite(v)) return v
      const n = Number(v)
      return Number.isFinite(n) ? n : 0
    }

    const statusBreakdown = byStatus.map((r) => ({
      status: r.status,
      count: r._count._all,
      totalCommissionMinor: minor(r._sum.commissionAmountMinor),
    }))

    return ok(res, {
      totalCommissions: totalRows,
      attributedSignups: signupsWithReferrer,
      byStatus: statusBreakdown,
      rateBps: Number(process.env.REFERRAL_COMMISSION_RATE_BPS ?? "500") || 500,
      firstPaymentOnly: process.env.REFERRAL_FIRST_PAYMENT_ONLY !== "false",
    })
  } catch (err) {
    console.error("ADMIN REFERRALS SUMMARY ERROR:", err)
    return fail(res, 500, "Failed to fetch referral summary")
  }
})

router.get("/referrals/commissions", async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1)
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100)
    const statusRaw = typeof req.query.status === "string" ? req.query.status.trim() : ""
    const status = Object.values(ReferralCommissionStatus).includes(
      statusRaw as ReferralCommissionStatus
    )
      ? (statusRaw as ReferralCommissionStatus)
      : undefined
    const search = typeof req.query.search === "string" ? req.query.search.trim() : ""

    const where = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { stripeInvoiceId: { contains: search, mode: "insensitive" as const } },
              {
                referrer: {
                  email: { contains: search, mode: "insensitive" as const },
                },
              },
              {
                referee: {
                  email: { contains: search, mode: "insensitive" as const },
                },
              },
            ],
          }
        : {}),
    }

    const [rows, total] = await Promise.all([
      prisma.referralCommission.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          status: true,
          currency: true,
          invoiceAmountMinor: true,
          commissionRateBps: true,
          commissionAmountMinor: true,
          plan: true,
          stripeInvoiceId: true,
          stripeEventId: true,
          createdAt: true,
          referrer: { select: { id: true, email: true, referralCode: true } },
          referee: { select: { id: true, email: true } },
        },
      }),
      prisma.referralCommission.count({ where }),
    ])

    return ok(res, {
      page,
      limit,
      total,
      commissions: rows.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    console.error("ADMIN REFERRALS COMMISSIONS ERROR:", err)
    return fail(res, 500, "Failed to fetch referral commissions")
  }
})

router.patch("/referrals/commissions/:id", async (req, res) => {
  try {
    const { id } = req.params
    const parsed = z
      .object({
        status: z.nativeEnum(ReferralCommissionStatus),
      })
      .safeParse(req.body ?? {})
    if (!parsed.success) {
      return fail(res, 400, "Invalid status", { errors: parsed.error.flatten() })
    }

    const updated = await prisma.referralCommission.update({
      where: { id },
      data: { status: parsed.data.status },
      select: {
        id: true,
        status: true,
        commissionAmountMinor: true,
        currency: true,
        stripeInvoiceId: true,
        referrer: { select: { id: true, email: true } },
        referee: { select: { id: true, email: true } },
      },
    })

    return ok(res, { commission: updated })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return fail(res, 404, "Commission not found")
    }
    console.error("ADMIN REFERRAL COMMISSION PATCH ERROR:", err)
    return fail(res, 500, "Failed to update commission")
  }
})

const impersonationStartSchema = z.object({
  userId: z.string().uuid(),
})

router.post(
  "/impersonation/start",
  requireOwner,
  async (req: AuthRequest, res: Response) => {
    const parsed = impersonationStartSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return fail(res, 400, "Invalid request", { issues: parsed.error.flatten() })
    }

    const backup =
      typeof req.cookies?.token === "string" ? req.cookies.token.trim() : ""
    if (!backup) {
      return fail(
        res,
        400,
        "Cookie session required for preview — open the app in this browser (not API-only / Bearer-only clients)."
      )
    }

    const target = await prisma.user.findUnique({
      where: { id: parsed.data.userId },
    })
    if (!target || target.deletedAt) {
      return fail(res, 404, "User not found")
    }
    if (target.banned) {
      return fail(res, 403, "Cannot preview banned accounts")
    }
    if (isOwnerRole(target.role)) {
      return fail(res, 403, "Cannot preview Owner accounts")
    }
    if (target.id === req.user!.id) {
      return fail(res, 400, "Already signed in as this account")
    }

    const impersonatorId = req.user!.id
    const token = signImpersonationJwt({
      userId: target.id,
      role: target.role,
      tokenVersion: target.tokenVersion,
      impersonatorId,
    })

    setImpRestoreCookie(res, backup)
    setAuthTokenCookie(res, token)

    const requestId = resolveRequestId(req)

    try {
      await prisma.auditLog.create({
        data: {
          userId: impersonatorId,
          action: AuditAction.ADMIN_IMPERSONATION_START,
          metadata: {
            targetUserId: target.id,
            targetEmail: target.email,
            impersonatorId,
          },
          requestId,
        },
      })
    } catch (err) {
      console.error("ADMIN_IMPERSONATION_START audit:", err)
    }

    return ok(res, {
      previewUserId: target.id,
      previewEmail: target.email,
    })
  }
)

export default router