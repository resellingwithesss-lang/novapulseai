/**
 * Lifecycle engine.
 *
 * Periodically (default 60s) walks the trigger registry and, for each enabled
 * trigger:
 *   1. Queries candidate users from Postgres via the trigger's `buildWhere`.
 *   2. Applies the global 48h frequency cap unless the trigger overrides it
 *      (trial-ending reminders are deadline-driven and must not be skipped).
 *   3. For each candidate, inside a serializable transaction:
 *        a. Re-checks the cooldown via `LifecycleSend` (defensive).
 *        b. Inserts a `LifecycleSend` row and an `EmailDelivery` row together.
 *      The existing queue worker (`processEmailQueueTick`) drains the delivery.
 *
 * Invariants enforced here (mirrored by worker `SENDABLE_MARKETING_STATUS_SET`):
 *   - never sends to OPTED_OUT / DISMISSED / UNKNOWN users
 *   - never sends to soft-deleted / banned users
 *   - never bypasses the queue worker
 *   - never double-fires the same (user, trigger) inside a cooldown window,
 *     even under concurrent ticks (transaction + cooldown re-check)
 *
 * Operational controls:
 *   LIFECYCLE_ENGINE_ENABLED=false           master kill-switch
 *   LIFECYCLE_ENGINE_TICK_MS=<ms>            tick interval override
 *   LIFECYCLE_<STREAM>_ENABLED=false         per-trigger kill-switch (see registry)
 *
 * Observability:
 *   log.info("lifecycle_trigger_fired", { trigger, userId, deliveryId })
 *   `LifecycleSend` rows carry metadata for post-hoc analysis.
 *   Admin endpoint exposes per-trigger counts (24h / 7d / all).
 */

import {
  EmailLogType,
  LifecycleTrigger,
  Prisma,
} from "@prisma/client"
import { prisma } from "./prisma"
import { getPublicAppUrl, isEmailSystemConfigured } from "./email-env"
import { log, serializeErr } from "./logger"
import {
  renderMarketingEmail,
  type MarketingRenderVars,
} from "./marketing-templates"
import {
  LIFECYCLE_TRIGGERS,
  isEngineEnabled,
  isTriggerEnabled,
  type LifecycleCandidate,
  type LifecycleTriggerDefinition,
} from "./lifecycle-triggers"

/* ============================================================
   CONFIG
============================================================ */

const DEFAULT_TICK_MS = 60_000
const GLOBAL_FREQUENCY_CAP_MS = 48 * 60 * 60 * 1000

/**
 * Candidate select — kept small and stable. Everything a trigger's
 * `buildVariables` may read must be listed here.
 */
const CANDIDATE_SELECT = {
  id: true,
  email: true,
  displayName: true,
  plan: true,
  subscriptionStatus: true,
  credits: true,
  trialExpiresAt: true,
  lastActiveAt: true,
  lastMarketingEmailSentAt: true,
  marketingUnsubscribeToken: true,
  createdAt: true,
} satisfies Prisma.UserSelect

/* ============================================================
   ENGINE STATE
============================================================ */

let started = false
let timer: NodeJS.Timeout | null = null
/** per-trigger next-eligible-run timestamp (ms since epoch). */
const triggerNextRunAt = new Map<LifecycleTrigger, number>()
/** guard: only one tick in-flight at a time. */
let ticking = false

/* ============================================================
   PUBLIC API
============================================================ */

export function startLifecycleEngine(): void {
  if (started) return
  started = true

  if (!isEngineEnabled()) {
    log.info("lifecycle_engine_disabled", {
      reason: "LIFECYCLE_ENGINE_ENABLED=false",
    })
    return
  }

  const tickMs = Number(process.env.LIFECYCLE_ENGINE_TICK_MS ?? DEFAULT_TICK_MS)
  log.info("lifecycle_engine_starting", {
    tickMs,
    triggers: LIFECYCLE_TRIGGERS.map((t) => ({
      trigger: t.trigger,
      enabled: isTriggerEnabled(t),
      minIntervalSeconds: t.minIntervalSeconds,
    })),
  })

  // First tick is delayed half an interval so boot isn't a stampede.
  timer = setInterval(() => {
    void processLifecycleTick().catch((err) => {
      log.error("lifecycle_tick_failed", serializeErr(err))
    })
  }, tickMs)
  // Let Node exit cleanly on shutdown signals.
  timer.unref?.()
}

export function stopLifecycleEngine(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  started = false
  triggerNextRunAt.clear()
}

/**
 * Single tick exposed for tests and admin-triggered manual runs.
 * Returns per-trigger summary counts.
 */
export async function processLifecycleTick(): Promise<
  Array<{ trigger: LifecycleTrigger; considered: number; fired: number; skipped: number }>
> {
  if (ticking) return []
  ticking = true
  const summary: Array<{
    trigger: LifecycleTrigger
    considered: number
    fired: number
    skipped: number
  }> = []

  try {
    if (!isEngineEnabled()) return summary
    if (!isEmailSystemConfigured()) {
      log.debug("lifecycle_tick_skipped", { reason: "email_system_not_configured" })
      return summary
    }

    const now = new Date()

    for (const def of LIFECYCLE_TRIGGERS) {
      if (!isTriggerEnabled(def)) continue

      const nextAt = triggerNextRunAt.get(def.trigger) ?? 0
      if (now.getTime() < nextAt) continue

      // Schedule the next minimum-run-at BEFORE processing so a slow trigger
      // doesn't block future ticks from trying again.
      triggerNextRunAt.set(
        def.trigger,
        now.getTime() + def.minIntervalSeconds * 1000
      )

      const result = await runTrigger(def, now).catch((err) => {
        log.error("lifecycle_trigger_failed", {
          trigger: def.trigger,
          ...serializeErr(err),
        })
        return { considered: 0, fired: 0, skipped: 0 }
      })

      summary.push({ trigger: def.trigger, ...result })
    }
  } finally {
    ticking = false
  }

  return summary
}

/* ============================================================
   PER-TRIGGER TICK
============================================================ */

async function runTrigger(
  def: LifecycleTriggerDefinition,
  now: Date
): Promise<{ considered: number; fired: number; skipped: number }> {
  const candidates = (await prisma.user.findMany({
    where: def.buildWhere(now),
    take: def.perTickLimit,
    orderBy: { createdAt: "asc" }, // stable ordering; old cohorts drained first
    select: CANDIDATE_SELECT,
  })) as LifecycleCandidate[]

  let fired = 0
  let skipped = 0

  for (const candidate of candidates) {
    if (def.postFilter && !def.postFilter(candidate, now)) {
      skipped++
      continue
    }

    if (def.respectsFrequencyCap) {
      const last = candidate.lastMarketingEmailSentAt?.getTime() ?? 0
      if (last > 0 && now.getTime() - last < GLOBAL_FREQUENCY_CAP_MS) {
        skipped++
        continue
      }
    }

    const ok = await tryFireTrigger(def, candidate, now).catch((err) => {
      log.error("lifecycle_send_failed", {
        trigger: def.trigger,
        userId: candidate.id,
        ...serializeErr(err),
      })
      return false
    })
    if (ok) fired++
    else skipped++
  }

  log.info("lifecycle_trigger_tick", {
    trigger: def.trigger,
    considered: candidates.length,
    fired,
    skipped,
  })

  return { considered: candidates.length, fired, skipped }
}

/* ============================================================
   ATOMIC SEND (the safety-critical path)

   The transaction:
     1. Defensive re-check: `LifecycleSend { userId, trigger, sentAt >= cutoff }`
     2. Create `LifecycleSend`
     3. Create `EmailDelivery`
     4. Link them with `LifecycleSend.emailDeliveryId`

   If two engine ticks race on the same user, exactly one transaction wins;
   the other sees the LifecycleSend already written and aborts.
============================================================ */

async function tryFireTrigger(
  def: LifecycleTriggerDefinition,
  candidate: LifecycleCandidate,
  now: Date
): Promise<boolean> {
  const cooldownCutoff = new Date(now.getTime() - def.cooldownMs)
  const vars = def.buildVariables(candidate, now)
  const unsubscribeUrl = buildUnsubscribeUrl(candidate.marketingUnsubscribeToken)

  const renderVars: MarketingRenderVars = {
    displayName: candidate.displayName ?? "",
    unsubscribeUrl,
    ...vars,
  }

  const rendered = renderMarketingEmail(def.templateId, renderVars)

  // Short transaction — Prisma default isolation (Read Committed) is fine
  // because the LifecycleSend row is the conflict arbiter.
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.lifecycleSend.findFirst({
        where: {
          userId: candidate.id,
          trigger: def.trigger,
          sentAt: { gte: cooldownCutoff },
        },
        select: { id: true },
      })
      if (existing) return false

      const send = await tx.lifecycleSend.create({
        data: {
          userId: candidate.id,
          trigger: def.trigger,
          metadata: {
            templateId: def.templateId,
            priority: def.priority,
            cooldownMs: def.cooldownMs,
            vars: vars as Prisma.InputJsonValue,
          } as Prisma.InputJsonValue,
        },
        select: { id: true },
      })

      const delivery = await tx.emailDelivery.create({
        data: {
          userId: candidate.id,
          toEmail: candidate.email,
          subject: rendered.subject,
          html: rendered.html,
          kind: EmailLogType.MARKETING,
        },
        select: { id: true },
      })

      await tx.lifecycleSend.update({
        where: { id: send.id },
        data: { emailDeliveryId: delivery.id },
      })

      log.info("lifecycle_trigger_fired", {
        trigger: def.trigger,
        userId: candidate.id,
        deliveryId: delivery.id,
        lifecycleSendId: send.id,
      })

      return true
    })
  } catch (err) {
    log.error("lifecycle_transaction_failed", {
      trigger: def.trigger,
      userId: candidate.id,
      ...serializeErr(err),
    })
    return false
  }
}

/* ============================================================
   HELPERS
============================================================ */

function buildUnsubscribeUrl(token: string): string {
  const base = getPublicAppUrl().replace(/\/$/, "")
  return `${base}/api/email/unsubscribe?token=${encodeURIComponent(token)}`
}
