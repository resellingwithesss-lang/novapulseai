/**
 * Declarative registry of automated lifecycle triggers.
 *
 * Each trigger describes:
 *   - eligibility: a Prisma `where` fragment for candidate users
 *   - per-candidate post-filter (optional — for conditions the DB can't express)
 *   - cooldown: how long until the same user may receive this trigger again
 *   - respectsFrequencyCap: whether the 48h global marketing cap applies
 *   - template: which MarketingTemplateId to render
 *   - variables: per-user render variables (ties to existing user/billing state)
 *
 * The engine (`lifecycle-engine.ts`) consumes these definitions. Adding a new
 * trigger = add a registry entry + a `LifecycleTrigger` enum value + migration
 * + a `MARKETING_TEMPLATES` entry.
 */

import {
  LifecycleTrigger,
  MarketingConsentStatus,
  Plan,
  Prisma,
  SubscriptionStatus,
  UsageTool,
} from "@prisma/client"
import type { MarketingTemplateId, MarketingRenderVars } from "./marketing-templates"
import { SENDABLE_MARKETING_STATUSES } from "./marketing-constants"
import { getPlanCredits } from "../modules/plans/plan.constants"

export interface LifecycleCandidate {
  id: string
  email: string
  displayName: string | null
  plan: Plan
  subscriptionStatus: SubscriptionStatus
  credits: number
  trialExpiresAt: Date | null
  lastActiveAt: Date | null
  lastMarketingEmailSentAt: Date | null
  marketingUnsubscribeToken: string
  createdAt: Date
  // For triggers that need usage signals, we prefetch a tiny count.
  _recentUsageCount?: number
}

export interface LifecycleTriggerDefinition {
  trigger: LifecycleTrigger
  templateId: MarketingTemplateId
  /** Operator-facing name for logs and admin UI. */
  displayName: string
  /** Tick-to-tick throttle — skip if last tick was within this many seconds. */
  minIntervalSeconds: number
  /** Per-user cooldown; skip if same (user, trigger) fired in this window. */
  cooldownMs: number
  /** Whether the 48h global cap across all lifecycle emails applies. */
  respectsFrequencyCap: boolean
  /** Env var that disables this specific trigger when set to "false". */
  killSwitchEnv: string
  /** Priority for "once per tick" stacking — lower runs first. */
  priority: number
  /** Max candidates to consider per tick (protects DB on catch-up after a pause). */
  perTickLimit: number
  /** Build the Prisma `where` clause for candidate discovery. */
  buildWhere: (now: Date) => Prisma.UserWhereInput
  /** Optional post-filter for conditions not expressible in Prisma. */
  postFilter?: (candidate: LifecycleCandidate, now: Date) => boolean
  /** Compute per-user render variables. */
  buildVariables: (candidate: LifecycleCandidate, now: Date) => Record<
    string,
    string | number | null | undefined
  >
}

/* ============================================================
   SHARED CONSENT GATE
   Every trigger's `where` AND-s with this — a single place to
   reason about "who is sendable right now".
============================================================ */

function consentGate(): Prisma.UserWhereInput {
  return {
    deletedAt: null,
    banned: false,
    marketingEmails: true,
    marketingConsentStatus: { in: [...SENDABLE_MARKETING_STATUSES] },
  }
}

/** Common helper: "no LifecycleSend of this trigger after cutoff" — cooldown check. */
function noRecentSend(
  trigger: LifecycleTrigger,
  cutoff: Date
): Prisma.UserWhereInput {
  return {
    lifecycleSends: {
      none: {
        trigger,
        sentAt: { gte: cutoff },
      },
    },
  }
}

/* ============================================================
   1) CREDIT EXHAUSTION UPGRADE
============================================================ */

const creditExhaustion: LifecycleTriggerDefinition = {
  trigger: LifecycleTrigger.CREDIT_EXHAUSTION_UPGRADE,
  templateId: "credit_exhaustion_upgrade_v1",
  displayName: "Credit exhaustion → upgrade",
  minIntervalSeconds: 10 * 60, // check every 10 min
  cooldownMs: 14 * 24 * 60 * 60 * 1000, // 14 days
  respectsFrequencyCap: true,
  killSwitchEnv: "LIFECYCLE_CREDIT_EXHAUSTION_ENABLED",
  priority: 20,
  perTickLimit: 50,
  buildWhere: (now) => ({
    ...consentGate(),
    credits: { lte: 0 },
    // Only users on non-premium plans — ELITE users already have the top tier.
    plan: { in: [Plan.FREE, Plan.STARTER, Plan.PRO] },
    // Active-ish accounts — don't nag long-churned users through this path
    // (inactive reactivation trigger owns that segment).
    subscriptionStatus: {
      in: [
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.TRIALING,
        SubscriptionStatus.PAST_DUE,
      ],
    },
    // Signal: recently engaged (otherwise credit exhaustion isn't timely).
    lastActiveAt: {
      gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
    },
    ...noRecentSend(
      LifecycleTrigger.CREDIT_EXHAUSTION_UPGRADE,
      new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    ),
  }),
  buildVariables: (c) => ({
    displayName: c.displayName ?? "",
    currentPlan: c.plan,
    credits: c.credits,
  }),
}

/* ============================================================
   1b) LOW CREDITS NUDGE (not zero — distinct from exhaustion)
============================================================ */

const lowCreditsNudge: LifecycleTriggerDefinition = {
  trigger: LifecycleTrigger.LOW_CREDITS_NUDGE,
  templateId: "low_credits_nudge_v1",
  displayName: "Low credits urgency (non-zero)",
  minIntervalSeconds: 15 * 60,
  cooldownMs: 7 * 24 * 60 * 60 * 1000,
  respectsFrequencyCap: true,
  killSwitchEnv: "LIFECYCLE_LOW_CREDITS_ENABLED",
  priority: 15,
  perTickLimit: 80,
  buildWhere: (now) => ({
    ...consentGate(),
    credits: { gt: 0, lte: 80 },
    plan: { in: [Plan.FREE, Plan.STARTER, Plan.PRO] },
    subscriptionStatus: {
      in: [
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.TRIALING,
        SubscriptionStatus.PAST_DUE,
      ],
    },
    lastActiveAt: {
      gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    },
    ...noRecentSend(
      LifecycleTrigger.LOW_CREDITS_NUDGE,
      new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    ),
  }),
  postFilter: (c) => {
    const monthly = getPlanCredits(c.plan)
    const threshold = Math.max(2, Math.min(80, Math.floor(monthly * 0.08)))
    return c.credits > 0 && c.credits <= threshold
  },
  buildVariables: (c) => ({
    displayName: c.displayName ?? "",
    credits: c.credits,
    currentPlan: c.plan,
  }),
}

/* ============================================================
   2) TRIAL ENDING REMINDER
   Deadline-driven: fires once per trial, ignores the global cap.
============================================================ */

const trialEnding: LifecycleTriggerDefinition = {
  trigger: LifecycleTrigger.TRIAL_ENDING_REMINDER,
  templateId: "trial_ending_reminder_v1",
  displayName: "PRO trial ending (48–72h window)",
  minIntervalSeconds: 30 * 60, // every 30 min — catches rolling windows
  cooldownMs: 365 * 24 * 60 * 60 * 1000, // effectively once per trial (1y)
  respectsFrequencyCap: false, // deadline beats frequency-cap courtesy
  killSwitchEnv: "LIFECYCLE_TRIAL_ENDING_ENABLED",
  priority: 10, // highest — must not be starved by other triggers
  perTickLimit: 100,
  buildWhere: (now) => {
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000)
    const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000)
    return {
      ...consentGate(),
      subscriptionStatus: SubscriptionStatus.TRIALING,
      trialExpiresAt: { gte: in48h, lte: in72h },
      ...noRecentSend(
        LifecycleTrigger.TRIAL_ENDING_REMINDER,
        // Historical cutoff — anyone who got this before gets filtered.
        new Date(0)
      ),
    }
  },
  buildVariables: (c, now) => {
    const ms = c.trialExpiresAt
      ? c.trialExpiresAt.getTime() - now.getTime()
      : 0
    const daysLeft = Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)))
    return {
      displayName: c.displayName ?? "",
      daysLeft,
    }
  },
}

/* ============================================================
   3) INACTIVE USER REACTIVATION
============================================================ */

const INACTIVE_DAYS = 14

const inactiveReactivation: LifecycleTriggerDefinition = {
  trigger: LifecycleTrigger.INACTIVE_USER_REACTIVATION,
  templateId: "inactive_user_reactivation_v1",
  displayName: "Inactive user reactivation (14d)",
  minIntervalSeconds: 6 * 60 * 60, // every 6h
  cooldownMs: 60 * 24 * 60 * 60 * 1000, // 60 days between reactivation attempts
  respectsFrequencyCap: true,
  killSwitchEnv: "LIFECYCLE_REACTIVATION_ENABLED",
  priority: 40,
  perTickLimit: 100,
  buildWhere: (now) => {
    const inactiveCutoff = new Date(
      now.getTime() - INACTIVE_DAYS * 24 * 60 * 60 * 1000
    )
    return {
      ...consentGate(),
      // Someone who chose to cancel has made a decision — don't nag them
      // through reactivation (separate winback campaign can target them).
      subscriptionStatus: {
        notIn: [SubscriptionStatus.CANCELED, SubscriptionStatus.EXPIRED],
      },
      // Account must be > 14 days old so fresh signups don't trip this.
      createdAt: { lte: inactiveCutoff },
      OR: [
        { lastActiveAt: { lte: inactiveCutoff } },
        { lastActiveAt: null },
      ],
      ...noRecentSend(
        LifecycleTrigger.INACTIVE_USER_REACTIVATION,
        new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
      ),
    }
  },
  buildVariables: (c, now) => {
    const daysInactive = c.lastActiveAt
      ? Math.max(
          INACTIVE_DAYS,
          Math.floor(
            (now.getTime() - c.lastActiveAt.getTime()) /
              (24 * 60 * 60 * 1000)
          )
        )
      : INACTIVE_DAYS
    return {
      displayName: c.displayName ?? "",
      daysInactive,
    }
  },
}

/* ============================================================
   4) ELITE FEATURE PROMOTION
   Target: PRO users actively generating — strong upgrade signal.
============================================================ */

const eliteFeaturePromotion: LifecycleTriggerDefinition = {
  trigger: LifecycleTrigger.ELITE_FEATURE_PROMOTION,
  templateId: "elite_feature_promotion_v1",
  displayName: "PRO → ELITE upgrade promo",
  minIntervalSeconds: 6 * 60 * 60, // every 6h
  cooldownMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  respectsFrequencyCap: true,
  killSwitchEnv: "LIFECYCLE_ELITE_PROMO_ENABLED",
  priority: 30,
  perTickLimit: 50,
  buildWhere: (now) => {
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    return {
      ...consentGate(),
      plan: Plan.PRO,
      // Actively paying — don't pitch ELITE to past-due or trialing PRO users
      // (trialing gets the trial-ending nudge first).
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      // Engagement signal: has used generation tools recently (cheap, non-exact
      // DB filter; per-candidate post-filter can tighten if needed).
      usages: {
        some: {
          tool: { in: [UsageTool.VIDEO, UsageTool.STORY] },
          createdAt: { gte: twoWeeksAgo },
        },
      },
      ...noRecentSend(
        LifecycleTrigger.ELITE_FEATURE_PROMOTION,
        new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      ),
    }
  },
  buildVariables: (c) => ({
    displayName: c.displayName ?? "",
  }),
}

/* ============================================================
   5) REFERRAL PUSH
============================================================ */

const referralPush: LifecycleTriggerDefinition = {
  trigger: LifecycleTrigger.REFERRAL_PUSH,
  templateId: "referral_push_v1",
  displayName: "Referral push (paid + aged 14d)",
  minIntervalSeconds: 12 * 60 * 60, // every 12h
  cooldownMs: 45 * 24 * 60 * 60 * 1000, // 45 days
  respectsFrequencyCap: true,
  killSwitchEnv: "LIFECYCLE_REFERRAL_PUSH_ENABLED",
  priority: 50, // lowest — never blocks upgrade or trial nudges
  perTickLimit: 75,
  buildWhere: (now) => {
    const aged = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    return {
      ...consentGate(),
      // Advocates pay; only pitch the program to active paying members.
      plan: { in: [Plan.STARTER, Plan.PRO, Plan.ELITE] },
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      createdAt: { lte: aged },
      ...noRecentSend(
        LifecycleTrigger.REFERRAL_PUSH,
        new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000)
      ),
    }
  },
  buildVariables: (c) => ({
    displayName: c.displayName ?? "",
  }),
}

/* ============================================================
   REGISTRY
   Ordered by priority so the engine's tick work is deterministic.
============================================================ */

export const LIFECYCLE_TRIGGERS: ReadonlyArray<LifecycleTriggerDefinition> = [
  trialEnding, // priority 10
  lowCreditsNudge, // priority 15
  creditExhaustion, // priority 20
  eliteFeaturePromotion, // priority 30
  inactiveReactivation, // priority 40
  referralPush, // priority 50
]

/** Guard — never let the registry drift out of priority order. */
if (
  LIFECYCLE_TRIGGERS.some(
    (t, i, arr) => i > 0 && arr[i - 1]!.priority > t.priority
  )
) {
  throw new Error(
    "LIFECYCLE_TRIGGERS registry is not sorted by priority ascending"
  )
}

/** Optional named lookup for admin routes / tests. */
export function findTriggerDefinition(
  trigger: LifecycleTrigger
): LifecycleTriggerDefinition | undefined {
  return LIFECYCLE_TRIGGERS.find((t) => t.trigger === trigger)
}

/** Small helper to resolve `isEnabled` from env consistently. */
export function isTriggerEnabled(
  def: LifecycleTriggerDefinition
): boolean {
  return process.env[def.killSwitchEnv] !== "false"
}

export function isEngineEnabled(): boolean {
  return process.env.LIFECYCLE_ENGINE_ENABLED !== "false"
}
