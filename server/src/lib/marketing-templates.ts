/**
 * Lifecycle marketing email templates.
 *
 * Each template exposes inner HTML + plain-text fallback. The final message
 * is wrapped by `marketingBroadcastWrapper` so the unsubscribe footer is
 * guaranteed (invariant: no marketing email ships without one).
 *
 * Copy is deliberately creator-focused and benefit-first. Avoid words like
 * "newsletter" / "marketing" / "promo" — the brand voice is "creator growth
 * club", not a bulk-email list.
 *
 * Extending: add a new `MarketingTemplateId`, register it in `TEMPLATES`,
 * implement `render()`, then add a matching `LifecycleTrigger` if this is
 * to be an automated stream.
 */

import { getPublicAppUrl } from "./email-env"
import { escapeHtml, marketingBroadcastWrapper } from "./email-templates"

/* ============================================================
   TYPES
============================================================ */

export type MarketingTemplateId =
  | "credit_exhaustion_upgrade_v1"
  | "low_credits_nudge_v1"
  | "trial_ending_reminder_v1"
  | "inactive_user_reactivation_v1"
  | "elite_feature_promotion_v1"
  | "referral_push_v1"

export type MarketingTemplateCategory =
  | "upgrade"
  | "lifecycle"
  | "winback"
  | "advocacy"
  | "launch"

export interface MarketingRenderVars {
  /** Always available; blank string falls back to "there". */
  displayName: string
  /** Absolute URL including token; added by the engine before render. */
  unsubscribeUrl: string
  /** Trigger-specific variables. Unknown keys ignored by the template. */
  [key: string]: string | number | null | undefined
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export interface MarketingTemplate {
  id: MarketingTemplateId
  name: string
  category: MarketingTemplateCategory
  /** Whether this template is intended for automated lifecycle use. */
  lifecycle: boolean
  /** Static preview text shown in inbox clients. */
  previewText: (v: MarketingRenderVars) => string
  /** Final subject line (may include personalization). */
  subject: (v: MarketingRenderVars) => string
  /** Inner HTML; outer wrapper + unsubscribe footer added by `render()`. */
  innerHtml: (v: MarketingRenderVars) => string
  /** Plain-text fallback; deliverability and accessibility. */
  text: (v: MarketingRenderVars) => string
}

/* ============================================================
   SHARED UI PRIMITIVES
============================================================ */

const BRAND_GRADIENT = "background:linear-gradient(90deg,#7c3aed,#db2777)"
const CTA_STYLE = `display:inline-block;padding:13px 26px;border-radius:999px;${BRAND_GRADIENT};color:#fff;text-decoration:none;font-weight:600;font-size:14px;`
const SECONDARY_CTA = `display:inline-block;padding:13px 26px;border-radius:999px;border:1px solid rgba(167,139,250,0.4);color:#e9d5ff;text-decoration:none;font-weight:600;font-size:14px;margin-left:8px;`
const HEADLINE_STYLE = `margin:0 0 12px;font-size:22px;font-weight:600;color:#fff;line-height:1.3;`
const BODY_STYLE = `margin:0 0 14px;color:#cbd5e1;font-size:15px;`
const MUTED_STYLE = `margin:0 0 0;color:#94a3b8;font-size:13px;`
const EYEBROW_STYLE = `margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.14em;color:#a78bfa;text-transform:uppercase;`

function firstName(displayName: string): string {
  const trimmed = (displayName || "").trim()
  if (!trimmed) return "there"
  return trimmed.split(/\s+/)[0] ?? "there"
}

function app(): string {
  return getPublicAppUrl()
}

/* ============================================================
   TEMPLATE: credit_exhaustion_upgrade_v1
   Context: credits = 0 on a free/starter plan
============================================================ */

/* ============================================================
   TEMPLATE: low_credits_nudge_v1
   Context: credits low but > 0 (does not overlap exhaustion at 0)
============================================================ */

const lowCreditsNudge: MarketingTemplate = {
  id: "low_credits_nudge_v1",
  name: "Low credits — refill before you stall",
  category: "upgrade",
  lifecycle: true,
  previewText: () =>
    "You still have credits — use them wisely, or refill before the well runs dry.",
  subject: (v) =>
    `${firstName(v.displayName)}, you’re running light on credits`,
  innerHtml: (v) => {
    const name = escapeHtml(firstName(v.displayName))
    const credits = typeof v.credits === "number" ? v.credits : 0
    return `
      <p style="${EYEBROW_STYLE}">Creator growth club</p>
      <p style="${HEADLINE_STYLE}">${name}, your credit balance is getting thin.</p>
      <p style="${BODY_STYLE}">
        You’re not at zero yet — this is the window to refill or upgrade before
        a high‑value run stalls mid‑week. Keep momentum on scripts, clips, and
        launches without scrambling at the last minute.
      </p>
      <ul style="margin:0 0 20px 0;padding-left:18px;color:#cbd5e1;font-size:14px;line-height:1.7;">
        <li><strong style="color:#fff;">Predictable monthly pool</strong> — plan runs instead of guessing what’s left.</li>
        <li><strong style="color:#fff;">Full tool stack</strong> — Clipper, Story Maker, and Elite ads when you need them.</li>
      </ul>
      <div>
        <a href="${escapeHtml(app())}/dashboard/billing?utm_source=lifecycle&amp;utm_campaign=low_credits" style="${CTA_STYLE}">Review plans &amp; credits</a>
        <a href="${escapeHtml(app())}/dashboard?utm_source=lifecycle&amp;utm_campaign=low_credits" style="${SECONDARY_CTA}">Open dashboard</a>
      </div>
      <p style="${MUTED_STYLE};margin-top:22px;">Current balance: about <strong style="color:#e2e8f0;">${credits}</strong> credits.</p>
    `
  },
  text: (v) => {
    const credits = typeof v.credits === "number" ? v.credits : 0
    return (
      `${firstName(v.displayName)}, your credit balance is getting thin.\n\n` +
      `You still have credits (${credits}) — refill or upgrade before a key run stalls.\n\n` +
      `Plans & billing: ${app()}/dashboard/billing\n` +
      `Dashboard: ${app()}/dashboard`
    )
  },
}

const creditExhaustion: MarketingTemplate = {
  id: "credit_exhaustion_upgrade_v1",
  name: "Out of credits — upgrade nudge",
  category: "upgrade",
  lifecycle: true,
  previewText: () =>
    "Don't let momentum stop — upgrade for the credits you need this week.",
  subject: (v) =>
    `${firstName(v.displayName)}, you're out of credits — keep the streak going`,
  innerHtml: (v) => {
    const name = escapeHtml(firstName(v.displayName))
    const plan = escapeHtml(String(v.currentPlan ?? "FREE"))
    return `
      <p style="${EYEBROW_STYLE}">Creator growth club</p>
      <p style="${HEADLINE_STYLE}">${name}, you're out of credits.</p>
      <p style="${BODY_STYLE}">
        You're mid-flight — don't break the streak. A paid plan unlocks a
        predictable monthly credit refill, plus the tools that turn a good
        script into a launch-ready clip.
      </p>
      <ul style="margin:0 0 20px 0;padding-left:18px;color:#cbd5e1;font-size:14px;line-height:1.7;">
        <li><strong style="color:#fff;">Monthly credit refill</strong> — never hit zero mid-week again.</li>
        <li><strong style="color:#fff;">Story Maker &amp; Clipper</strong> — full access on STARTER and up.</li>
        <li><strong style="color:#fff;">Ad Studio pipeline</strong> — ELITE-only website-to-ad renders.</li>
      </ul>
      <div>
        <a href="${escapeHtml(app())}/dashboard/billing?utm_source=lifecycle&amp;utm_campaign=credit_exhaustion" style="${CTA_STYLE}">Upgrade now</a>
        <a href="${escapeHtml(app())}/pricing" style="${SECONDARY_CTA}">Compare plans</a>
      </div>
      <p style="${MUTED_STYLE};margin-top:22px;">You're currently on <strong>${plan}</strong>. Upgrade or cancel anytime from Billing.</p>
    `
  },
  text: (v) =>
    `${firstName(v.displayName)}, you're out of credits.\n\n` +
    `Keep the streak going — a paid plan gives you a monthly refill plus Story Maker and the Clipper (and ELITE unlocks Ad Studio).\n\n` +
    `Upgrade: ${app()}/dashboard/billing\n` +
    `Compare plans: ${app()}/pricing\n\n` +
    `Currently on ${v.currentPlan ?? "FREE"}. Upgrade or cancel anytime.`,
}

/* ============================================================
   TEMPLATE: trial_ending_reminder_v1
   Context: TRIALING, trialExpiresAt within 48–72h
============================================================ */

const trialEnding: MarketingTemplate = {
  id: "trial_ending_reminder_v1",
  name: "PRO trial ending soon",
  category: "upgrade",
  lifecycle: true,
  previewText: (v) =>
    `Your PRO trial ends in ${v.daysLeft ?? 2} days — lock in the credit refill.`,
  subject: (v) => `Your PRO trial ends in ${v.daysLeft ?? 2} days`,
  innerHtml: (v) => {
    const name = escapeHtml(firstName(v.displayName))
    const days = escapeHtml(String(v.daysLeft ?? 2))
    return `
      <p style="${EYEBROW_STYLE}">Trial ending</p>
      <p style="${HEADLINE_STYLE}">${name}, your PRO trial ends in ${days} days.</p>
      <p style="${BODY_STYLE}">
        You've seen what the engine can do. Keeping PRO means a predictable
        monthly credit refill, priority generation, and Story Maker with the
        Clipper — the full creator stack that stops you guessing on output.
      </p>
      <p style="${BODY_STYLE}">
        Do nothing and your account drops to FREE when the trial ends. One
        click keeps everything running.
      </p>
      <div>
        <a href="${escapeHtml(app())}/dashboard/billing?utm_source=lifecycle&amp;utm_campaign=trial_ending" style="${CTA_STYLE}">Keep PRO</a>
        <a href="${escapeHtml(app())}/dashboard" style="${SECONDARY_CTA}">Open dashboard</a>
      </div>
      <p style="${MUTED_STYLE};margin-top:22px;">Cancel anytime from Billing — no lock-in.</p>
    `
  },
  text: (v) =>
    `${firstName(v.displayName)}, your PRO trial ends in ${v.daysLeft ?? 2} days.\n\n` +
    `Keeping PRO = monthly credit refill, priority generation, Story Maker + Clipper.\n` +
    `Do nothing and your account drops to FREE when the trial ends.\n\n` +
    `Keep PRO: ${app()}/dashboard/billing\n` +
    `Dashboard: ${app()}/dashboard\n\n` +
    `Cancel anytime — no lock-in.`,
}

/* ============================================================
   TEMPLATE: inactive_user_reactivation_v1
   Context: lastActiveAt > 14 days ago, not canceled/banned
============================================================ */

const reactivation: MarketingTemplate = {
  id: "inactive_user_reactivation_v1",
  name: "Inactive user reactivation",
  category: "winback",
  lifecycle: true,
  previewText: () =>
    "Three new ways to ship faster this week — all waiting in your dashboard.",
  subject: (v) =>
    `${firstName(v.displayName)}, we shipped some things while you were away`,
  innerHtml: (v) => {
    const name = escapeHtml(firstName(v.displayName))
    const daysAway = escapeHtml(String(v.daysInactive ?? 14))
    return `
      <p style="${EYEBROW_STYLE}">We miss you</p>
      <p style="${HEADLINE_STYLE}">${name}, you haven't been back in ${daysAway} days.</p>
      <p style="${BODY_STYLE}">
        Here's what's worth a fresh look this week:
      </p>
      <ul style="margin:0 0 20px 0;padding-left:18px;color:#cbd5e1;font-size:14px;line-height:1.7;">
        <li><strong style="color:#fff;">Story Maker</strong> — TTS-backed short-form stories from one prompt.</li>
        <li><strong style="color:#fff;">Clipper</strong> — drop a long-form URL, get timestamped shorts.</li>
        <li><strong style="color:#fff;">Prompt tools</strong> — refine hooks, captions, and CTAs in one pass.</li>
      </ul>
      <div>
        <a href="${escapeHtml(app())}/dashboard?utm_source=lifecycle&amp;utm_campaign=reactivation" style="${CTA_STYLE}">Jump back in</a>
      </div>
      <p style="${MUTED_STYLE};margin-top:22px;">Your workspace, brand voices, and past outputs are all where you left them.</p>
    `
  },
  text: (v) =>
    `${firstName(v.displayName)}, you haven't been back in ${v.daysInactive ?? 14} days.\n\n` +
    `Worth a fresh look:\n` +
    `- Story Maker — TTS-backed stories from one prompt\n` +
    `- Clipper — long-form URL to timestamped shorts\n` +
    `- Prompt tools — refine hooks/captions/CTAs\n\n` +
    `Jump back in: ${app()}/dashboard\n\n` +
    `Your workspace and past outputs are where you left them.`,
}

/* ============================================================
   TEMPLATE: elite_feature_promotion_v1
   Context: PRO user actively generating — pitch Ad Studio
============================================================ */

const elitePromo: MarketingTemplate = {
  id: "elite_feature_promotion_v1",
  name: "ELITE — Ad Studio upgrade",
  category: "upgrade",
  lifecycle: true,
  previewText: () =>
    "Turn any URL into a ready-to-run ad — ELITE-only Ad Studio pipeline.",
  subject: (v) =>
    `${firstName(v.displayName)}, you're ready for Ad Studio`,
  innerHtml: (v) => {
    const name = escapeHtml(firstName(v.displayName))
    return `
      <p style="${EYEBROW_STYLE}">ELITE · Ad Studio</p>
      <p style="${HEADLINE_STYLE}">${name}, you're one tier away from the paid-ad pipeline.</p>
      <p style="${BODY_STYLE}">
        You've been shipping real work on PRO. ELITE unlocks the piece most
        creators reach for after: the Ad Studio pipeline — turn a website URL
        into a polished, rendered ad variant with capture + TTS + clean
        on-brand composition.
      </p>
      <ul style="margin:0 0 20px 0;padding-left:18px;color:#cbd5e1;font-size:14px;line-height:1.7;">
        <li><strong style="color:#fff;">URL → ad video</strong> — automated capture + render pipeline.</li>
        <li><strong style="color:#fff;">Dual-variant compare</strong> — ship the stronger creative.</li>
        <li><strong style="color:#fff;">Priority rendering queue</strong> — fewer waits on long jobs.</li>
        <li><strong style="color:#fff;">Expanded monthly credits</strong> — match your real output.</li>
      </ul>
      <div>
        <a href="${escapeHtml(app())}/dashboard/billing?utm_source=lifecycle&amp;utm_campaign=elite_promo" style="${CTA_STYLE}">Upgrade to ELITE</a>
        <a href="${escapeHtml(app())}/pricing" style="${SECONDARY_CTA}">See what's inside</a>
      </div>
      <p style="${MUTED_STYLE};margin-top:22px;">Ad Studio is ELITE-only — the rendering pipeline isn't available on PRO.</p>
    `
  },
  text: (v) =>
    `${firstName(v.displayName)}, you're one tier away from the paid-ad pipeline.\n\n` +
    `ELITE unlocks Ad Studio — URL to rendered ad variant with capture + TTS + composition.\n` +
    `- URL → ad video\n- Dual-variant compare\n- Priority rendering\n- Expanded monthly credits\n\n` +
    `Upgrade: ${app()}/dashboard/billing\n` +
    `Pricing: ${app()}/pricing\n\n` +
    `Ad Studio is ELITE-only.`,
}

/* ============================================================
   TEMPLATE: referral_push_v1
   Context: active paying user, account aged 14+ days
============================================================ */

const referralPush: MarketingTemplate = {
  id: "referral_push_v1",
  name: "Referral push — 5% commission",
  category: "advocacy",
  lifecycle: true,
  previewText: () =>
    "Earn 5% commission for every creator you bring — your link is in your dashboard.",
  subject: (v) =>
    `${firstName(v.displayName)}, earn 5% for every NovaPulseAI creator you refer`,
  innerHtml: (v) => {
    const name = escapeHtml(firstName(v.displayName))
    return `
      <p style="${EYEBROW_STYLE}">Partner program</p>
      <p style="${HEADLINE_STYLE}">${name}, your referral link pays you back.</p>
      <p style="${BODY_STYLE}">
        If you know a creator or a lean marketing team running on duct tape
        and caffeine — they should be on NovaPulseAI. You get
        <strong style="color:#fff;">5% commission</strong> on their first payment,
        and they get a workflow that actually ships.
      </p>
      <ul style="margin:0 0 20px 0;padding-left:18px;color:#cbd5e1;font-size:14px;line-height:1.7;">
        <li>Share your personal link from the Referrals tab.</li>
        <li>They sign up, pick a plan, and get to work.</li>
        <li>You get paid on their first payment. No cap, no expiry.</li>
      </ul>
      <div>
        <a href="${escapeHtml(app())}/dashboard/referrals?utm_source=lifecycle&amp;utm_campaign=referral_push" style="${CTA_STYLE}">Get my referral link</a>
      </div>
      <p style="${MUTED_STYLE};margin-top:22px;">Only paid plans generate commission. See terms in the Referrals tab.</p>
    `
  },
  text: (v) =>
    `${firstName(v.displayName)}, your referral link pays you back.\n\n` +
    `5% commission on every referred creator's first payment — no cap, no expiry.\n\n` +
    `How it works:\n` +
    `1. Share your link from the Referrals tab\n` +
    `2. They sign up and pick a plan\n` +
    `3. You get paid on their first payment\n\n` +
    `Grab your link: ${app()}/dashboard/referrals\n\n` +
    `Only paid plans generate commission.`,
}

/* ============================================================
   REGISTRY + RENDER
============================================================ */

export const MARKETING_TEMPLATES: Record<MarketingTemplateId, MarketingTemplate> =
  {
    credit_exhaustion_upgrade_v1: creditExhaustion,
    low_credits_nudge_v1: lowCreditsNudge,
    trial_ending_reminder_v1: trialEnding,
    inactive_user_reactivation_v1: reactivation,
    elite_feature_promotion_v1: elitePromo,
    referral_push_v1: referralPush,
  }

/**
 * Final render: inner HTML + unsubscribe footer via `marketingBroadcastWrapper`.
 * Never call `innerHtml` directly for delivery — the unsubscribe footer is a
 * hard invariant for marketing email (see operating brief).
 */
export function renderMarketingEmail(
  templateId: MarketingTemplateId,
  vars: MarketingRenderVars
): RenderedEmail {
  const template = MARKETING_TEMPLATES[templateId]
  const html = marketingBroadcastWrapper({
    innerHtml: template.innerHtml(vars),
    unsubscribeUrl: vars.unsubscribeUrl,
  })
  const subject = template.subject(vars)
  const previewText = template.previewText(vars)
  // Plain text variant: preview text then full text body.
  const text = `${previewText}\n\n${template.text(vars)}\n\nUnsubscribe: ${vars.unsubscribeUrl}`
  return { subject, html, text }
}
