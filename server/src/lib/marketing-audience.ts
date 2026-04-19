/**
 * Shared audience filter for lifecycle marketing.
 *
 * This file is the single place that translates a marketing audience filter
 * (JSON from admin UI) into a Prisma `where` clause. It is consumed by:
 *
 *   - /api/admin/marketing/subscribers           (list + facets)
 *   - /api/admin/marketing/subscribers/export.csv
 *   - /api/admin/marketing/audience/estimate     (Phase 4)
 *   - server/src/lib/email-broadcast.ts          (Phase 4 fan-out)
 *
 * A single helper guarantees "count shown in UI" === "rows streamed by CSV"
 * === "recipients actually fan-out picks". Drift between those is a P0 bug.
 */

import {
  MarketingConsentStatus,
  Plan,
  Prisma,
  Role,
  SubscriptionStatus,
  UsageTool,
} from "@prisma/client"
import { z } from "zod"
import crypto from "crypto"
import { SENDABLE_MARKETING_STATUSES } from "./marketing-constants"

/* ============================================================
   FILTER SCHEMA (validated at the admin API boundary)
============================================================ */

export const marketingAudienceFilterSchema = z
  .object({
    search: z.string().trim().max(120).optional(),
    plan: z.array(z.nativeEnum(Plan)).max(4).optional(),
    subscriptionStatus: z
      .array(z.nativeEnum(SubscriptionStatus))
      .max(6)
      .optional(),
    // Cap matches the current Role enum size (USER, CREATOR, ADMIN, OWNER,
    // SUPER_ADMIN). Previously `.max(3)` — which silently rejected any admin
    // filter selecting more than three roles once Phase A expanded the enum.
    role: z.array(z.nativeEnum(Role)).max(5).optional(),
    consentStatus: z
      .array(z.nativeEnum(MarketingConsentStatus))
      .max(5)
      .optional(),
    // True  => only marketingEmails=true
    // False => only marketingEmails=false
    // Unset => no filter
    marketingEmails: z.boolean().optional(),
    createdAfter: z.string().datetime().optional(),
    createdBefore: z.string().datetime().optional(),
    lastActiveAfter: z.string().datetime().optional(),
    lastActiveBefore: z.string().datetime().optional(),
    inactiveDays: z.number().int().min(1).max(3650).optional(),
    maxCreditsRemaining: z.number().int().min(0).max(100_000).optional(),
    minLifetimeCreditsUsed: z.number().int().min(0).max(10_000_000).optional(),
    neverUpgraded: z.boolean().optional(),
    referredByUserId: z.string().uuid().optional(),
    usedToolWithin: z
      .object({
        tool: z.nativeEnum(UsageTool),
        days: z.number().int().min(1).max(365),
      })
      .optional(),
    /** When true the returned `where` restricts to currently-sendable users. */
    sendableOnly: z.boolean().optional(),
  })
  .strict()

export type MarketingAudienceFilter = z.infer<
  typeof marketingAudienceFilterSchema
>

/* ============================================================
   WHERE BUILDER
============================================================ */

/**
 * Build a Prisma `where` clause for the given audience filter.
 *
 * Invariants:
 *   - deletedAt=null and banned=false are ALWAYS applied (never email a
 *     soft-deleted or banned user, even for "all users" views).
 *   - `sendableOnly=true` additionally applies the marketing sendability
 *     predicate used by fan-out (consent + marketingEmails).
 *   - Unknown keys are impossible (schema is strict).
 */
export function buildMarketingAudienceWhere(
  filter: MarketingAudienceFilter
): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    banned: false,
  }

  // Sendability (used by fan-out and by "campaign audience estimate").
  if (filter.sendableOnly) {
    where.marketingEmails = true
    where.marketingConsentStatus = { in: [...SENDABLE_MARKETING_STATUSES] }
  }

  if (filter.search) {
    // Case-insensitive email substring OR displayName substring.
    where.OR = [
      { email: { contains: filter.search, mode: "insensitive" } },
      { displayName: { contains: filter.search, mode: "insensitive" } },
    ]
  }

  if (filter.plan && filter.plan.length > 0) {
    where.plan = { in: filter.plan }
  }

  if (filter.subscriptionStatus && filter.subscriptionStatus.length > 0) {
    where.subscriptionStatus = { in: filter.subscriptionStatus }
  }

  if (filter.role && filter.role.length > 0) {
    where.role = { in: filter.role }
  }

  if (filter.consentStatus && filter.consentStatus.length > 0) {
    // If sendableOnly already set this, we narrow further; Prisma will AND.
    where.marketingConsentStatus = where.marketingConsentStatus
      ? { in: filter.consentStatus }
      : { in: filter.consentStatus }
  }

  if (typeof filter.marketingEmails === "boolean") {
    where.marketingEmails = filter.marketingEmails
  }

  // Signup window
  if (filter.createdAfter || filter.createdBefore) {
    where.createdAt = {
      ...(filter.createdAfter ? { gte: new Date(filter.createdAfter) } : {}),
      ...(filter.createdBefore ? { lte: new Date(filter.createdBefore) } : {}),
    }
  }

  // Activity window (explicit)
  if (filter.lastActiveAfter || filter.lastActiveBefore) {
    where.lastActiveAt = {
      ...(filter.lastActiveAfter
        ? { gte: new Date(filter.lastActiveAfter) }
        : {}),
      ...(filter.lastActiveBefore
        ? { lte: new Date(filter.lastActiveBefore) }
        : {}),
    }
  }

  // "Inactive for N days" = lastActiveAt <= (now - N) OR lastActiveAt IS NULL.
  // Phrased as "lastActiveAt <= cutoff OR never active" so winback segments
  // include users who signed up and never came back.
  if (typeof filter.inactiveDays === "number") {
    const cutoff = new Date(Date.now() - filter.inactiveDays * 24 * 60 * 60 * 1000)
    const inactiveClause: Prisma.UserWhereInput = {
      OR: [{ lastActiveAt: { lte: cutoff } }, { lastActiveAt: null }],
    }
    where.AND = where.AND
      ? [...(Array.isArray(where.AND) ? where.AND : [where.AND]), inactiveClause]
      : [inactiveClause]
  }

  if (typeof filter.maxCreditsRemaining === "number") {
    where.credits = { lte: filter.maxCreditsRemaining }
  }

  if (typeof filter.minLifetimeCreditsUsed === "number") {
    where.lifetimeCreditsUsed = { gte: filter.minLifetimeCreditsUsed }
  }

  if (filter.neverUpgraded === true) {
    where.subscriptionStartedAt = null
    where.plan = { in: [Plan.FREE] }
  }

  if (filter.referredByUserId) {
    where.referredByUserId = filter.referredByUserId
  }

  if (filter.usedToolWithin) {
    const since = new Date(
      Date.now() - filter.usedToolWithin.days * 24 * 60 * 60 * 1000
    )
    where.usages = {
      some: {
        tool: filter.usedToolWithin.tool,
        createdAt: { gte: since },
      },
    }
  }

  return where
}

/* ============================================================
   FILTER HASH (for audit trails on bulk exports)
============================================================ */

/** Canonical-serialized, hashed filter for audit diffs. */
export function hashMarketingFilter(filter: MarketingAudienceFilter): string {
  const canonical = JSON.stringify(filter, Object.keys(filter).sort())
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16)
}
