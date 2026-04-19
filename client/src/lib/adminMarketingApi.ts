/**
 * Client helpers for /api/admin/marketing/*.
 *
 * Mirrors the server-side `marketingAudienceFilterSchema` so the admin UI and
 * backend share one audience shape. When new filter fields land on the server,
 * add them here so the admin UI can compose them.
 */

import { api } from "@/lib/api"
import type { MarketingConsentStatus } from "@/context/AuthContext"

/* ============================================================
   TYPES
============================================================ */

export type AdminPlan = "FREE" | "STARTER" | "PRO" | "ELITE"
export type AdminSubscriptionStatus =
  | "ACTIVE"
  | "TRIALING"
  | "PAST_DUE"
  | "CANCELED"
  | "EXPIRED"
  | "PAUSED"
export type AdminRole =
  | "USER"
  | "CREATOR"
  | "ADMIN"
  | "OWNER"
  /** @deprecated Phase B migrates SUPER_ADMIN rows to OWNER. Kept in the union
   * during the transition so API responses referencing the legacy value keep
   * type-checking. */
  | "SUPER_ADMIN"

export type MarketingAudienceFilter = {
  search?: string
  plan?: AdminPlan[]
  subscriptionStatus?: AdminSubscriptionStatus[]
  role?: AdminRole[]
  consentStatus?: MarketingConsentStatus[]
  marketingEmails?: boolean
  createdAfter?: string
  createdBefore?: string
  lastActiveAfter?: string
  lastActiveBefore?: string
  inactiveDays?: number
  maxCreditsRemaining?: number
  minLifetimeCreditsUsed?: number
  neverUpgraded?: boolean
  referredByUserId?: string
  sendableOnly?: boolean
}

export type MarketingSubscriber = {
  id: string
  email: string
  displayName: string | null
  plan: AdminPlan
  subscriptionStatus: AdminSubscriptionStatus
  role: AdminRole
  banned: boolean
  credits: number
  marketingEmails: boolean
  marketingConsentStatus: MarketingConsentStatus
  marketingConsentSource: string | null
  marketingConsentCapturedAt: string | null
  marketingConsentUpdatedAt: string | null
  marketingDismissedAt: string | null
  lastMarketingEmailSentAt: string | null
  lastActiveAt: string | null
  createdAt: string
}

export type MarketingOverview = {
  totals: {
    users: number
    sendable: number
    UNKNOWN: number
    OPTED_IN: number
    OPTED_OUT: number
    DISMISSED: number
    LEGACY_OPT_IN: number
  }
  deltas7d: {
    optedIn: number
    optedOut: number
  }
  recentCampaigns: Array<{
    id: string
    name: string
    subject: string
    status: string
    queuedCount: number
    sentCount: number
    failedCount: number
    createdAt: string
    sentAt: string | null
  }>
}

export type MarketingSubscriberList = {
  page: number
  limit: number
  total: number
  filter: MarketingAudienceFilter
  subscribers: MarketingSubscriber[]
}

export type MarketingSubscriberDetail = {
  user: MarketingSubscriber & {
    referredByUserId: string | null
    stripeCustomerId: string | null
    subscriptionStartedAt: string | null
    trialExpiresAt: string | null
  }
  recentEmailLogs: Array<{
    id: string
    type: "TRANSACTIONAL" | "MARKETING"
    subject: string
    status: "SENT" | "FAILED"
    errorMessage: string | null
    createdAt: string
  }>
  queuedDeliveries: number
}

/* ============================================================
   CALLS
============================================================ */

export async function fetchMarketingOverview(): Promise<MarketingOverview> {
  return await api.get<MarketingOverview>("/admin/marketing/overview")
}

/* ============================================================
   LIFECYCLE ENGINE
============================================================ */

export type LifecycleTriggerId =
  | "CREDIT_EXHAUSTION_UPGRADE"
  | "TRIAL_ENDING_REMINDER"
  | "INACTIVE_USER_REACTIVATION"
  | "ELITE_FEATURE_PROMOTION"
  | "REFERRAL_PUSH"

export type LifecycleStatus = {
  engine: {
    enabled: boolean
    tickMs: number
  }
  triggers: Array<{
    trigger: LifecycleTriggerId
    displayName: string
    templateId: string
    priority: number
    cooldownDays: number
    minIntervalSeconds: number
    respectsFrequencyCap: boolean
    killSwitchEnv: string
    enabled: boolean
    counts: { last24h: number; last7d: number; total: number }
  }>
  recentSends: Array<{
    id: string
    trigger: LifecycleTriggerId
    userId: string
    email: string | null
    plan: string | null
    sentAt: string
  }>
}

export async function fetchLifecycleStatus(): Promise<LifecycleStatus> {
  return await api.get<LifecycleStatus>("/admin/marketing/lifecycle")
}

function encodeFilter(filter: MarketingAudienceFilter): string {
  return encodeURIComponent(JSON.stringify(filter))
}

export async function fetchMarketingSubscribers(params: {
  filter: MarketingAudienceFilter
  page?: number
  limit?: number
}): Promise<MarketingSubscriberList> {
  const q = new URLSearchParams()
  q.set("q", JSON.stringify(params.filter))
  if (params.page) q.set("page", String(params.page))
  if (params.limit) q.set("limit", String(params.limit))
  return await api.get<MarketingSubscriberList>(
    `/admin/marketing/subscribers?${q.toString()}`
  )
}

export async function fetchMarketingSubscriberDetail(
  userId: string
): Promise<MarketingSubscriberDetail> {
  return await api.get<MarketingSubscriberDetail>(
    `/admin/marketing/subscribers/${encodeURIComponent(userId)}`
  )
}

/**
 * Returns the URL the admin UI should navigate/open to trigger a CSV download.
 * Kept as a URL string (not a fetch) so the browser's native download UX
 * handles large files instead of buffering in memory.
 */
export function marketingSubscribersCsvUrl(
  filter: MarketingAudienceFilter
): string {
  return `/api/admin/marketing/subscribers/export.csv?q=${encodeFilter(filter)}`
}
