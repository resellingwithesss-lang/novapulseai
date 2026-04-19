/**
 * Admin lifecycle-marketing routes (Phase 3: subscriber management).
 *
 * All routes are mounted under the main admin router and therefore already
 * require:
 *   - requireAuth
 *   - requireAdmin
 *   - requireCsrfForCookieAuth
 * (applied once at the top of server/src/modules/admin/admin.routes.ts).
 *
 * This file is READ-ONLY (plus one audit write on CSV export). Mutating
 * endpoints for campaigns land in Phase 4.
 */

import { Router, Response } from "express"
import rateLimit from "express-rate-limit"
import { z } from "zod"
import {
  AuditAction,
  EmailCampaignStatus,
  EmailLogType,
  LifecycleTrigger,
  MarketingConsentStatus,
  Plan,
  Prisma,
  SubscriptionStatus,
} from "@prisma/client"
import { prisma } from "../../../lib/prisma"
import { fail, ok } from "../../../lib/http"
import { AuthRequest } from "../../auth/auth.middleware"
import { recordAdminAudit } from "../../../lib/admin-audit"
import { resolveRequestId } from "../../../lib/tool-response"
import {
  SENDABLE_MARKETING_STATUSES,
} from "../../../lib/marketing-constants"
import {
  buildMarketingAudienceWhere,
  hashMarketingFilter,
  marketingAudienceFilterSchema,
  type MarketingAudienceFilter,
} from "../../../lib/marketing-audience"
import {
  LIFECYCLE_TRIGGERS,
  isEngineEnabled,
  isTriggerEnabled,
} from "../../../lib/lifecycle-triggers"
import { expandAdminBroadcastAsync } from "../../../lib/email-broadcast"
import { EDITORIAL_CAMPAIGN_TEMPLATES } from "../../../lib/editorial-campaign-templates"

const router = Router()

/** Matches dashboard / lifecycle “active” window for marketing breakdowns. */
const AUDIENCE_ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
const PAID_PLANS: Plan[] = [Plan.STARTER, Plan.PRO, Plan.ELITE]

/* ============================================================
   RATE LIMITS (export is expensive; keep it conservative)
============================================================ */

const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.ADMIN_MARKETING_EXPORT_MAX_PER_HOUR ?? "12"),
  standardHeaders: true,
  legacyHeaders: false,
})

const campaignSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.ADMIN_MARKETING_CAMPAIGN_SEND_MAX_PER_HOUR ?? "12"),
  standardHeaders: true,
  legacyHeaders: false,
})

/* ============================================================
   HELPERS
============================================================ */

/**
 * Parse the filter from either a JSON body (POST) or a single `q=…` query
 * param (GET / CSV). Returns 400-ready zod error on failure.
 */
/**
 * Both fields are declared optional on purpose: the server tsconfig has
 * `strict: false`, which disables the narrowing that would otherwise pick
 * the correct arm of a discriminated union. Keeping both fields optional
 * means callers can read `.issues` or `.filter` off the base type directly
 * after checking `.success`, without depending on control-flow narrowing.
 */
type FilterParseResult = {
  success: boolean
  filter?: MarketingAudienceFilter
  issues?: unknown
}

function parseFilterFromRequest(req: AuthRequest): FilterParseResult {
  const raw =
    req.method === "GET"
      ? parseQueryFilter(req.query)
      : (req.body ?? {})

  const parsed = marketingAudienceFilterSchema.safeParse(raw)
  if (!parsed.success) {
    return { success: false, issues: parsed.error.flatten() }
  }
  return { success: true, filter: parsed.data }
}

function parseQueryFilter(q: AuthRequest["query"]): Record<string, unknown> {
  // Prefer a single `q` JSON blob (keeps URLs readable for the common
  // "status=OPTED_IN" case; admin UI sends complex filters this way).
  if (typeof q.q === "string") {
    try {
      return JSON.parse(q.q)
    } catch {
      return {}
    }
  }
  // Fallback: simple shallow fields (admin users page pattern).
  const out: Record<string, unknown> = {}
  if (typeof q.search === "string") out.search = q.search
  if (typeof q.plan === "string" && q.plan !== "ALL") out.plan = [q.plan]
  if (
    typeof q.subscriptionStatus === "string" &&
    q.subscriptionStatus !== "ALL"
  ) {
    out.subscriptionStatus = [q.subscriptionStatus]
  }
  if (typeof q.consentStatus === "string" && q.consentStatus !== "ALL") {
    out.consentStatus = [q.consentStatus]
  }
  if (q.sendableOnly === "true") out.sendableOnly = true
  return out
}

const SUBSCRIBER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  plan: true,
  subscriptionStatus: true,
  role: true,
  banned: true,
  credits: true,
  marketingEmails: true,
  marketingConsentStatus: true,
  marketingConsentSource: true,
  marketingConsentCapturedAt: true,
  marketingConsentUpdatedAt: true,
  marketingDismissedAt: true,
  lastMarketingEmailSentAt: true,
  lastActiveAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect

/* ============================================================
   GET /api/admin/marketing/overview
   KPI grid for the admin marketing landing page.
============================================================ */

router.get("/overview", async (_req, res) => {
  try {
    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const baseWhere: Prisma.UserWhereInput = {
      deletedAt: null,
      banned: false,
    }

    const [
      totalUsers,
      sendable,
      byStatus,
      optedInRecently,
      optedOutRecently,
      recentCampaigns,
    ] = await Promise.all([
      prisma.user.count({ where: baseWhere }),
      prisma.user.count({
        where: {
          ...baseWhere,
          marketingEmails: true,
          marketingConsentStatus: { in: [...SENDABLE_MARKETING_STATUSES] },
        },
      }),
      prisma.user.groupBy({
        by: ["marketingConsentStatus"],
        where: baseWhere,
        _count: { _all: true },
      }),
      prisma.user.count({
        where: {
          ...baseWhere,
          marketingConsentStatus: MarketingConsentStatus.OPTED_IN,
          marketingConsentUpdatedAt: { gte: sevenDaysAgo },
        },
      }),
      prisma.user.count({
        where: {
          ...baseWhere,
          marketingConsentStatus: MarketingConsentStatus.OPTED_OUT,
          marketingConsentUpdatedAt: { gte: sevenDaysAgo },
        },
      }),
      prisma.emailCampaign.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          name: true,
          subject: true,
          status: true,
          queuedCount: true,
          sentCount: true,
          failedCount: true,
          createdAt: true,
          sentAt: true,
          scheduledSendAt: true,
        },
      }),
    ])

    // Shape status counts into a predictable object (fill zeros for missing).
    const counts: Record<string, number> = {
      UNKNOWN: 0,
      OPTED_IN: 0,
      OPTED_OUT: 0,
      DISMISSED: 0,
      LEGACY_OPT_IN: 0,
    }
    for (const row of byStatus) {
      counts[row.marketingConsentStatus] = row._count._all
    }

    return ok(res, {
      totals: {
        users: totalUsers,
        sendable,
        ...counts,
      },
      deltas7d: {
        optedIn: optedInRecently,
        optedOut: optedOutRecently,
      },
      recentCampaigns,
    })
  } catch (err) {
    console.error("ADMIN MARKETING OVERVIEW ERROR:", err)
    return fail(res, 500, "Failed to load overview")
  }
})

/* ============================================================
   GET /api/admin/marketing/subscribers
   Paginated list with audience filter.
============================================================ */

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

router.get("/subscribers", async (req: AuthRequest, res: Response) => {
  try {
    const pageParsed = listQuerySchema.safeParse(req.query)
    if (!pageParsed.success) {
      return fail(res, 400, "Invalid pagination")
    }
    const { page, limit } = pageParsed.data

    const filterParsed = parseFilterFromRequest(req)
    if (!filterParsed.success) {
      return fail(res, 400, "Invalid filter", { issues: filterParsed.issues })
    }

    const where = buildMarketingAudienceWhere(filterParsed.filter)

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: SUBSCRIBER_SELECT,
      }),
      prisma.user.count({ where }),
    ])

    return ok(res, {
      page,
      limit,
      total,
      filter: filterParsed.filter,
      subscribers: rows,
    })
  } catch (err) {
    console.error("ADMIN MARKETING SUBSCRIBERS ERROR:", err)
    return fail(res, 500, "Failed to load subscribers")
  }
})

/* ============================================================
   GET /api/admin/marketing/subscribers/export.csv
   Streaming CSV with the same filter schema. Writes an AuditLog
   row capturing the filter hash + row count.
============================================================ */

router.get(
  "/subscribers/export.csv",
  exportLimiter,
  async (req: AuthRequest, res: Response) => {
    const filterParsed = parseFilterFromRequest(req)
    if (!filterParsed.success) {
      return fail(res, 400, "Invalid filter", { issues: filterParsed.issues })
    }

    const where = buildMarketingAudienceWhere(filterParsed.filter)
    const filterHash = hashMarketingFilter(filterParsed.filter)
    const filename = `novapulseai-subscribers-${new Date()
      .toISOString()
      .slice(0, 10)}-${filterHash}.csv`

    res.setHeader("Content-Type", "text/csv; charset=utf-8")
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    )
    // Small but non-empty hint to stop proxies from buffering forever.
    res.setHeader("X-Content-Type-Options", "nosniff")

    const header = [
      "userId",
      "email",
      "displayName",
      "plan",
      "subscriptionStatus",
      "role",
      "marketingEmails",
      "marketingConsentStatus",
      "marketingConsentSource",
      "marketingConsentCapturedAt",
      "marketingConsentUpdatedAt",
      "lastMarketingEmailSentAt",
      "lastActiveAt",
      "createdAt",
    ]
    res.write(header.join(",") + "\n")

    const chunkSize = 500
    let cursor: string | undefined
    let rowCount = 0

    try {
      for (;;) {
        const rows = await prisma.user.findMany({
          where,
          take: chunkSize,
          orderBy: { id: "asc" },
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          select: SUBSCRIBER_SELECT,
        })
        if (rows.length === 0) break

        for (const r of rows) {
          const line = [
            r.id,
            r.email,
            r.displayName ?? "",
            r.plan,
            r.subscriptionStatus,
            r.role,
            r.marketingEmails ? "true" : "false",
            r.marketingConsentStatus,
            r.marketingConsentSource ?? "",
            iso(r.marketingConsentCapturedAt),
            iso(r.marketingConsentUpdatedAt),
            iso(r.lastMarketingEmailSentAt),
            iso(r.lastActiveAt),
            iso(r.createdAt),
          ]
            .map(csvEscape)
            .join(",")
          res.write(line + "\n")
          rowCount++
        }

        cursor = rows[rows.length - 1]!.id
        if (rows.length < chunkSize) break
      }

      res.end()

      // Fire-and-forget: never block the response on audit.
      void recordAdminAudit({
        adminUserId: req.user!.id,
        action: AuditAction.MARKETING_SUBSCRIBER_EXPORTED,
        metadata: {
          filterHash,
          filter: filterParsed.filter as unknown as Record<string, unknown>,
          rowCount,
          filename,
        },
        requestId: resolveRequestId(req),
      })
    } catch (err) {
      console.error("ADMIN MARKETING EXPORT ERROR:", err)
      // Headers already sent; best we can do is abort the stream.
      if (!res.headersSent) {
        return fail(res, 500, "Failed to export subscribers")
      }
      res.end()
    }
  }
)

/* ============================================================
   GET /api/admin/marketing/subscribers/:userId
   Per-user drawer (profile snapshot + last 20 email log rows).
============================================================ */

router.get(
  "/subscribers/:userId",
  async (req: AuthRequest, res: Response) => {
    const userId = req.params.userId
    if (!userId || typeof userId !== "string") {
      return fail(res, 400, "Invalid user id")
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          ...SUBSCRIBER_SELECT,
          referredByUserId: true,
          stripeCustomerId: true,
          subscriptionStartedAt: true,
          trialExpiresAt: true,
        },
      })
      if (!user) return fail(res, 404, "User not found")

      const [logs, campaignCount] = await Promise.all([
        prisma.emailLog.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            type: true,
            subject: true,
            status: true,
            errorMessage: true,
            createdAt: true,
          },
        }),
        prisma.emailDelivery.count({ where: { userId } }),
      ])

      return ok(res, {
        user,
        recentEmailLogs: logs,
        queuedDeliveries: campaignCount,
      })
    } catch (err) {
      console.error("ADMIN MARKETING SUBSCRIBER DETAIL ERROR:", err)
      return fail(res, 500, "Failed to load subscriber")
    }
  }
)

/* ============================================================
   GET /api/admin/marketing/lifecycle
   Engine status + per-trigger 24h/7d/total counts + last 10 sends.
   Read-only; safe for frequent polling from the admin UI.
============================================================ */

router.get("/lifecycle", async (_req, res) => {
  try {
    const now = new Date()
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const cutoff7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const [counts24h, counts7d, countsTotal, recentSends] = await Promise.all([
      prisma.lifecycleSend.groupBy({
        by: ["trigger"],
        where: { sentAt: { gte: cutoff24h } },
        _count: { _all: true },
      }),
      prisma.lifecycleSend.groupBy({
        by: ["trigger"],
        where: { sentAt: { gte: cutoff7d } },
        _count: { _all: true },
      }),
      prisma.lifecycleSend.groupBy({
        by: ["trigger"],
        _count: { _all: true },
      }),
      prisma.lifecycleSend.findMany({
        orderBy: { sentAt: "desc" },
        take: 10,
        select: {
          id: true,
          trigger: true,
          sentAt: true,
          userId: true,
          user: { select: { email: true, plan: true } },
        },
      }),
    ])

    const toMap = (
      rows: Array<{ trigger: LifecycleTrigger; _count: { _all: number } }>
    ): Record<string, number> => {
      const m: Record<string, number> = {}
      for (const r of rows) m[r.trigger] = r._count._all
      return m
    }

    const map24h = toMap(counts24h)
    const map7d = toMap(counts7d)
    const mapTotal = toMap(countsTotal)

    const triggers = LIFECYCLE_TRIGGERS.map((def) => ({
      trigger: def.trigger,
      displayName: def.displayName,
      templateId: def.templateId,
      priority: def.priority,
      cooldownDays: Math.round(def.cooldownMs / (24 * 60 * 60 * 1000)),
      minIntervalSeconds: def.minIntervalSeconds,
      respectsFrequencyCap: def.respectsFrequencyCap,
      killSwitchEnv: def.killSwitchEnv,
      enabled: isTriggerEnabled(def),
      counts: {
        last24h: map24h[def.trigger] ?? 0,
        last7d: map7d[def.trigger] ?? 0,
        total: mapTotal[def.trigger] ?? 0,
      },
    }))

    return ok(res, {
      engine: {
        enabled: isEngineEnabled(),
        tickMs: Number(process.env.LIFECYCLE_ENGINE_TICK_MS ?? 60_000),
      },
      triggers,
      recentSends: recentSends.map((r) => ({
        id: r.id,
        trigger: r.trigger,
        userId: r.userId,
        email: r.user?.email ?? null,
        plan: r.user?.plan ?? null,
        sentAt: r.sentAt,
      })),
    })
  } catch (err) {
    console.error("ADMIN MARKETING LIFECYCLE ERROR:", err)
    return fail(res, 500, "Failed to load lifecycle status")
  }
})

/* ============================================================
   GET /api/admin/marketing/campaign-templates
   Pre-built editorial HTML + subjects (merge-tag placeholders).
============================================================ */

router.get("/campaign-templates", (_req, res) => {
  return ok(res, {
    templates: EDITORIAL_CAMPAIGN_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      subject: t.subject,
      html: t.html,
    })),
  })
})

/* ============================================================
   POST /api/admin/marketing/audience/estimate
   Count sendable users for the same filter shape as bulk campaigns.
============================================================ */

router.post("/audience/estimate", async (req: AuthRequest, res: Response) => {
  const parsed = marketingAudienceFilterSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return fail(res, 400, "Invalid filter", { issues: parsed.error.flatten() })
  }
  try {
    const filter: MarketingAudienceFilter = { ...parsed.data, sendableOnly: true }
    const where = buildMarketingAudienceWhere(filter)
    const now = new Date()
    const activeSince = new Date(now.getTime() - AUDIENCE_ACTIVE_WINDOW_MS)
    const [count, free, paid, active14d] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.count({
        where: { AND: [where, { plan: Plan.FREE }] },
      }),
      prisma.user.count({
        where: { AND: [where, { plan: { in: PAID_PLANS } }] },
      }),
      prisma.user.count({
        where: { AND: [where, { lastActiveAt: { gte: activeSince } }] },
      }),
    ])
    const inactive14d = Math.max(0, count - active14d)
    return ok(res, {
      count,
      breakdown: {
        free,
        paid,
        active14d,
        inactive14d,
        activeWindowDays: 14,
      },
      filter,
    })
  } catch (err) {
    console.error("ADMIN MARKETING ESTIMATE ERROR:", err)
    return fail(res, 500, "Failed to estimate audience")
  }
})

/* ============================================================
   GET /api/admin/marketing/campaigns
============================================================ */

const campaignsListQuery = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})

router.get("/campaigns", async (req: AuthRequest, res: Response) => {
  const parsed = campaignsListQuery.safeParse(req.query)
  if (!parsed.success) {
    return fail(res, 400, "Invalid pagination")
  }
  const { page, limit } = parsed.data
  try {
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
          scheduledSendAt: true,
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
        ...c,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        sentAt: c.sentAt?.toISOString() ?? null,
        scheduledSendAt: c.scheduledSendAt?.toISOString() ?? null,
      })),
    })
  } catch (err) {
    console.error("ADMIN MARKETING CAMPAIGNS LIST ERROR:", err)
    return fail(res, 500, "Failed to load campaigns")
  }
})

/* ============================================================
   POST /api/admin/marketing/campaigns
   Create DRAFT campaign (does not send).
============================================================ */

const createCampaignSchema = z.object({
  name: z.string().min(1).max(160),
  subject: z.string().min(1).max(200),
  htmlContent: z.string().min(1).max(600_000),
  audienceFilter: marketingAudienceFilterSchema.optional(),
})

router.post("/campaigns", async (req: AuthRequest, res: Response) => {
  const parsed = createCampaignSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return fail(res, 400, "Invalid campaign", { issues: parsed.error.flatten() })
  }
  try {
    const audience = parsed.data.audienceFilter
      ? ({ ...parsed.data.audienceFilter, sendableOnly: true } satisfies MarketingAudienceFilter)
      : ({ sendableOnly: true } satisfies MarketingAudienceFilter)

    const campaign = await prisma.emailCampaign.create({
      data: {
        name: parsed.data.name,
        subject: parsed.data.subject,
        htmlContent: parsed.data.htmlContent,
        status: EmailCampaignStatus.DRAFT,
        filter: audience as object,
        createdByUserId: req.user!.id,
      },
      select: {
        id: true,
        name: true,
        subject: true,
        status: true,
        filter: true,
        createdAt: true,
      },
    })
    return ok(res, {
      campaign: {
        ...campaign,
        createdAt: campaign.createdAt.toISOString(),
      },
    })
  } catch (err) {
    console.error("ADMIN MARKETING CAMPAIGN CREATE ERROR:", err)
    return fail(res, 500, "Failed to create campaign")
  }
})

/* ============================================================
   POST /api/admin/marketing/campaigns/:id/send
   Queue fan-out (async). DRAFT only.
============================================================ */

router.post(
  "/campaigns/:id/send",
  campaignSendLimiter,
  async (req: AuthRequest, res: Response) => {
    const id = req.params.id
    if (!id) return fail(res, 400, "Missing campaign id")

    try {
      const campaign = await prisma.emailCampaign.findUnique({ where: { id } })
      if (!campaign) return fail(res, 404, "Campaign not found")
      if (campaign.status !== EmailCampaignStatus.DRAFT) {
        return fail(res, 400, "Only draft campaigns can be sent immediately", {
          status: campaign.status,
        })
      }

      res.status(202).json({
        success: true,
        requestId: resolveRequestId(req),
        campaignId: id,
        message:
          "Campaign queued. Recipients are expanded in the background; delivery runs via the email worker.",
      })

      void expandAdminBroadcastAsync(id)
    } catch (err) {
      console.error("ADMIN MARKETING CAMPAIGN SEND ERROR:", err)
      if (!res.headersSent) {
        return fail(res, 500, "Failed to queue campaign")
      }
    }
  }
)

const scheduleCampaignSchema = z.object({
  scheduledSendAt: z.coerce.date(),
})

router.post(
  "/campaigns/:id/schedule",
  campaignSendLimiter,
  async (req: AuthRequest, res: Response) => {
    const id = req.params.id
    if (!id) return fail(res, 400, "Missing campaign id")

    const parsed = scheduleCampaignSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return fail(res, 400, "Invalid schedule payload", {
        issues: parsed.error.flatten(),
      })
    }

    const when = parsed.data.scheduledSendAt
    const minLead = 60_000
    if (when.getTime() <= Date.now() + minLead) {
      return fail(res, 400, "scheduledSendAt must be at least ~1 minute in the future")
    }

    try {
      const updated = await prisma.emailCampaign.updateMany({
        where: { id, status: EmailCampaignStatus.DRAFT },
        data: {
          status: EmailCampaignStatus.SCHEDULED,
          scheduledSendAt: when,
        },
      })
      if (updated.count === 0) {
        const exists = await prisma.emailCampaign.findUnique({
          where: { id },
          select: { status: true },
        })
        if (!exists) return fail(res, 404, "Campaign not found")
        return fail(res, 400, "Only draft campaigns can be scheduled", {
          status: exists.status,
        })
      }

      return ok(res, {
        campaignId: id,
        status: EmailCampaignStatus.SCHEDULED,
        scheduledSendAt: when.toISOString(),
      })
    } catch (err) {
      console.error("ADMIN MARKETING CAMPAIGN SCHEDULE ERROR:", err)
      return fail(res, 500, "Failed to schedule campaign")
    }
  }
)

router.post("/campaigns/:id/unschedule", async (req: AuthRequest, res: Response) => {
  const id = req.params.id
  if (!id) return fail(res, 400, "Missing campaign id")

  try {
    const updated = await prisma.emailCampaign.updateMany({
      where: { id, status: EmailCampaignStatus.SCHEDULED },
      data: {
        status: EmailCampaignStatus.DRAFT,
        scheduledSendAt: null,
      },
    })
    if (updated.count === 0) {
      const exists = await prisma.emailCampaign.findUnique({
        where: { id },
        select: { status: true },
      })
      if (!exists) return fail(res, 404, "Campaign not found")
      return fail(res, 400, "Only scheduled campaigns can be unscheduled", {
        status: exists.status,
      })
    }

    return ok(res, { campaignId: id, status: EmailCampaignStatus.DRAFT })
  } catch (err) {
    console.error("ADMIN MARKETING CAMPAIGN UNSCHEDULE ERROR:", err)
    return fail(res, 500, "Failed to unschedule campaign")
  }
})

/* ============================================================
   UTILS
============================================================ */

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value)
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

function iso(d: Date | null | undefined): string {
  return d ? d.toISOString() : ""
}

/* ============================================================
   BACK-REFERENCES (types consumed by Phase 4 — keep imports live
   so the compiler catches if we remove them upstream).
============================================================ */

// These imports are intentional even if the Phase 3 surface does not use
// every one yet; dropping them here means Phase 4 starts with half the
// invariants missing.
void Plan
void SubscriptionStatus
void EmailCampaignStatus
void EmailLogType

export default router
