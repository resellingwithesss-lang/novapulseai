import { MarketingConsentStatus } from "@prisma/client"

/**
 * Single source of truth for "which consent statuses may receive marketing email".
 *
 * Kept in lockstep with:
 *   - server/src/lib/email-broadcast.ts (fan-out filter)
 *   - server/src/lib/email-outbound.ts  (worker defensive drop)
 *   - server/src/modules/marketing/marketing.routes.ts (public consent API)
 *
 * LEGACY_OPT_IN is included so pre-Phase-1 users whose `marketingEmails=true`
 * are still reachable until they answer explicitly; all new signups start
 * UNKNOWN (with marketingEmails=false) and only become OPTED_IN via a surface.
 *
 * If you find yourself hard-coding this list anywhere else: stop and import.
 */
export const SENDABLE_MARKETING_STATUSES: readonly MarketingConsentStatus[] = [
  MarketingConsentStatus.OPTED_IN,
  MarketingConsentStatus.LEGACY_OPT_IN,
] as const

/** Faster membership check for hot paths (queue worker tick). */
export const SENDABLE_MARKETING_STATUS_SET: ReadonlySet<MarketingConsentStatus> =
  new Set(SENDABLE_MARKETING_STATUSES)

/**
 * Surfaces that may capture a consent answer. Server validates source against
 * this list; any new surface must be added here AND on the client (`marketingApi.ts`).
 */
export const CONSENT_SOURCES = [
  "onboarding",
  "dashboard_banner",
  "billing_card",
  "settings",
  "signup",
  "unsubscribe",
  "email_link",
  "admin",
] as const

export type ConsentSource = (typeof CONSENT_SOURCES)[number]

/** How long to suppress the consent prompt after an explicit "not right now". */
export const MARKETING_DISMISS_COOLDOWN_DAYS = 14
