import { Router, Response } from "express"
import rateLimit from "express-rate-limit"
import { z } from "zod"
import { prisma } from "../../lib/prisma"
import { findRootJobRow, readJobMetadata } from "../ads/ad-job-lineage"
import { fail, ok } from "../../lib/http"
import { resolveRequestId } from "../../lib/tool-response"
import { requireAuth, AuthRequest } from "../auth/auth.middleware"
import { requireAdmin } from "../auth/admin.middleware"
import { requireCsrfForCookieAuth } from "../../middlewares/csrf-protect"
import {
  Plan,
  Role,
  CreditType,
  SubscriptionStatus,
  EmailCampaignStatus,
  EmailLogType,
} from "@prisma/client"
import { expandAdminBroadcastAsync } from "../../lib/email-broadcast"
import { normalizePlanTier, PLAN_MONTHLY_GBP } from "../plans/plan.constants"

const router = Router()

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
   DASHBOARD STATS
================================ */

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
          role: { in: [Role.ADMIN, Role.SUPER_ADMIN] },
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

    const rows = await prisma.adJob.findMany({
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

    return ok(res, { limit, jobs })
  } catch (err) {
    console.error("ADMIN AD JOBS LIST ERROR:", err)
    return fail(res, 500, "Failed to fetch ad jobs")
  }
})

router.get("/users", async (req, res) => {
  try {
    const page = Number(req.query.page) || 1
    const limit = Math.min(Number(req.query.limit) || 25, 100)

    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        email: true,
        role: true,
        plan: true,
        subscriptionStatus: true,
        credits: true,
        banned: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    })

    const total = await prisma.user.count({
      where: { deletedAt: null },
    })

    return ok(res, { page, total, users })
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

router.patch("/users/:id/plan", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params
    const { plan } = req.body

    if (!Object.values(Plan).includes(plan)) {
      return fail(res, 400, "Invalid plan provided")
    }

    if (plan === Plan.ELITE && req.user?.role !== Role.SUPER_ADMIN) {
      return fail(res, 403, "Only SUPER_ADMIN can assign ELITE plan manually")
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        plan,
      },
    })

    return ok(res, {
      message: "User plan updated",
      user: updated,
    })
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
    const { amount } = req.body

    if (typeof amount !== "number") {
      return fail(res, 400, "Amount must be a number")
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          credits: { increment: amount },
        },
      })

      await tx.creditTransaction.create({
        data: {
          userId: id,
          amount,
          type: amount >= 0 ? CreditType.CREDIT_ADD : CreditType.CREDIT_USE,
          reason: "ADMIN_ADJUSTMENT",
        },
      })

      return user
    })

    return ok(res, {
      message: "Credits adjusted",
      user: updatedUser,
    })
  } catch (err) {
    console.error("ADMIN CREDIT ERROR:", err)
    return fail(res, 500, "Failed to adjust credits")
  }
})

/* ===============================
   BAN / UNBAN
================================ */

router.patch("/users/:id/ban", async (req, res) => {
  try {
    const { id } = req.params
    const { banned } = req.body

    if (typeof banned !== "boolean") {
      return fail(res, 400, "Banned must be boolean")
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        banned,
        tokenVersion: { increment: 1 },
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
    if (!req.user) {
      return fail(res, 401, "Unauthorized")
    }

    const { id } = req.params

    // Prevent self-delete
    if (req.user.id === id) {
      return fail(
        res,
        400,
        "You cannot delete your own admin account"
      )
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { role: true },
    })

    if (!targetUser) {
      return fail(res, 404, "User not found")
    }

    // Prevent deleting super admins
    if (targetUser.role === Role.SUPER_ADMIN) {
      return fail(res, 403, "Cannot delete SUPER_ADMIN account")
    }

    await prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        tokenVersion: { increment: 1 },
      },
    })

    return ok(res, {
      message: "User deleted successfully",
    })
  } catch (err) {
    console.error("ADMIN DELETE ERROR:", err)
    return fail(res, 500, "Failed to delete user")
  }
})

/* ===============================
   EMAIL BROADCAST (MARKETING)
================================ */

router.post("/email/broadcast", emailBroadcastLimiter, async (req: AuthRequest, res) => {
  try {
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

export default router