import { isStaffRole } from "./roles"

export type UiPlan = "FREE" | "STARTER" | "PRO" | "ELITE"

/** Stripe checkout / plan-change interval (shared across billing UI). */
export type BillingInterval = "monthly" | "yearly"
export type PlanToolId =
  | "clipper"
  | "prompt"
  | "story-maker"
  | "video-script"
  | "story-video-maker"

type PlanDefinition = {
  credits: number
  tools: PlanToolId[] | "ALL"
  priceId?: string
  yearlyPriceId?: string
  yearlyPriceGbp?: number
  trialDays?: number
  monthlyPriceGbp: number
  scriptVariantCount: number
  adVariantCount: number
  clipVariantCount: number
  improveActionsLimit: number
}

/** Display-only; server uses STRIPE_PRO_TRIAL_DAYS. 0 = no trial messaging. */
function resolveClientProTrialDays(): number {
  const raw = process.env.NEXT_PUBLIC_STRIPE_PRO_TRIAL_DAYS?.trim()
  if (raw === undefined || raw === "") return 14
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return 14
  if (n > 90) return 90
  return n
}

// Mirrored from server plan.constants (FREE = try-before-pay, not Stripe).
export const PLAN_CONFIG: Record<UiPlan, PlanDefinition> = {
  FREE: {
    credits: 4,
    tools: ["video-script"],
    monthlyPriceGbp: 0,
    scriptVariantCount: 2,
    adVariantCount: 0,
    clipVariantCount: 0,
    improveActionsLimit: 1,
  },
  STARTER: {
    credits: 200,
    tools: ["clipper", "prompt"],
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER_MONTHLY ?? "STRIPE_STARTER_ID",
    yearlyPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER_YEARLY,
    yearlyPriceGbp: 144,
    monthlyPriceGbp: 14.99,
    scriptVariantCount: 3,
    adVariantCount: 0,
    clipVariantCount: 6,
    improveActionsLimit: 2,
  },
  PRO: {
    credits: 1000,
    tools: ["clipper", "prompt", "story-maker", "video-script"],
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY ?? "STRIPE_PRO_ID",
    yearlyPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_YEARLY,
    yearlyPriceGbp: 288,
    trialDays: resolveClientProTrialDays(),
    monthlyPriceGbp: 29.99,
    scriptVariantCount: 5,
    adVariantCount: 0,
    clipVariantCount: 10,
    improveActionsLimit: 4,
  },
  ELITE: {
    credits: 5000,
    tools: "ALL",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ELITE_MONTHLY ?? "STRIPE_ELITE_ID",
    yearlyPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ELITE_YEARLY,
    yearlyPriceGbp: 480,
    monthlyPriceGbp: 49.99,
    scriptVariantCount: 7,
    adVariantCount: 2,
    clipVariantCount: 14,
    improveActionsLimit: 6,
  },
}

export const PLAN_ORDER: UiPlan[] = ["FREE", "STARTER", "PRO", "ELITE"]

/** Human-facing plan name — use everywhere instead of raw enum strings. */
export function planDisplayName(plan?: string | null): string {
  const labels: Record<UiPlan, string> = {
    FREE: "Free",
    STARTER: "Starter",
    PRO: "Pro",
    ELITE: "Elite",
  }
  return labels[normalizePlan(plan)]
}

/** Human-facing subscription status (matches billing chip semantics). */
export function subscriptionStatusDisplay(status?: string | null): string {
  if (!status) return "—"
  const map: Record<string, string> = {
    TRIALING: "Trialing",
    ACTIVE: "Active",
    PAST_DUE: "Past due",
    CANCELED: "Canceled",
    EXPIRED: "Expired",
    PAUSED: "Paused",
  }
  return map[status] ?? status
}

/** One-line plan + included monthly credits (marketing defaults from PLAN_CONFIG). */
export function planIncludedCreditsLine(plan?: string | null): string {
  const p = normalizePlan(plan)
  const n = PLAN_CONFIG[p].credits
  const formatted = n >= 1000 ? n.toLocaleString() : String(n)
  return `${planDisplayName(p)} · ${formatted} credits / month included`
}

/** Mirrored from server plan.constants WORKFLOW_LIMITS — keep in sync for pricing UI. */
export const WORKFLOW_LIMITS: Record<
  UiPlan,
  { workspaces: number; brandVoices: number; contentPacks: number }
> = {
  FREE: { workspaces: 2, brandVoices: 4, contentPacks: 12 },
  STARTER: { workspaces: 8, brandVoices: 20, contentPacks: 80 },
  PRO: { workspaces: 25, brandVoices: 60, contentPacks: 400 },
  ELITE: { workspaces: 100, brandVoices: 250, contentPacks: 2500 },
}

export function getWorkflowLimitsForPlan(plan?: string | null) {
  return WORKFLOW_LIMITS[normalizePlan(plan)]
}

export function normalizePlan(plan?: string | null): UiPlan {
  const upper = String(plan || "").toUpperCase()
  if (upper === "FREE") return "FREE"
  if (upper === "STARTER") return "STARTER"
  if (upper === "PRO") return "PRO"
  if (upper === "ELITE") return "ELITE"
  return "FREE"
}

/**
 * Mirrors server `staffFloorPlan`: ADMIN / OWNER / SUPER_ADMIN see at least
 * ELITE in the UI when the DB row lags behind Stripe webhooks, or when a
 * staff seat has no paid Stripe tier at all.
 */
export function displayPlanForUser(
  plan: string | null | undefined,
  role?: string | null
): UiPlan {
  if (!isStaffRole(role)) return normalizePlan(plan)
  const p = normalizePlan(plan)
  return planTierIndex(p) >= planTierIndex("ELITE") ? p : "ELITE"
}

export function getPlanCredits(plan?: string | null): number {
  return PLAN_CONFIG[normalizePlan(plan)].credits
}

export function getPlanOutputLimits(plan?: string | null) {
  const row = PLAN_CONFIG[normalizePlan(plan)]
  return {
    scriptVariantCount: row.scriptVariantCount,
    adVariantCount: row.adVariantCount,
    clipVariantCount: row.clipVariantCount,
    improveActionsLimit: row.improveActionsLimit,
  }
}

export function getPlanMonthlyPriceGbp(plan?: string | null): number {
  return PLAN_CONFIG[normalizePlan(plan)].monthlyPriceGbp
}

export function getPlanPriceGbp(
  plan: Exclude<UiPlan, "FREE"> | string | null | undefined,
  billing: BillingInterval
): number {
  const config = PLAN_CONFIG[normalizePlan(plan)]
  if (billing === "yearly" && typeof config.yearlyPriceGbp === "number") {
    return config.yearlyPriceGbp
  }
  return config.monthlyPriceGbp
}

export function planAllowsTool(plan: string | null | undefined, toolId: PlanToolId): boolean {
  const tools = PLAN_CONFIG[normalizePlan(plan)].tools
  if (tools === "ALL") return true
  return tools.includes(toolId)
}

export function isPaidPlan(plan?: string | null): boolean {
  const normalized = normalizePlan(plan)
  return normalized === "STARTER" || normalized === "PRO" || normalized === "ELITE"
}

export function isFreePlan(plan?: string | null): boolean {
  return normalizePlan(plan) === "FREE"
}

/** Lower index = lower tier (FREE = 0). */
export function planTierIndex(plan?: string | null): number {
  const p = normalizePlan(plan)
  const i = PLAN_ORDER.indexOf(p)
  return i >= 0 ? i : 0
}

/** True if moving from current plan to target paid tier is an upgrade (not lateral or downgrade). */
export function isUpgradeToPlan(
  currentPlan: string | null | undefined,
  target: Exclude<UiPlan, "FREE">
): boolean {
  return planTierIndex(target) > planTierIndex(currentPlan)
}

function assertPlanConfigIntegrity() {
  const starterTools = PLAN_CONFIG.STARTER.tools
  const proTools = PLAN_CONFIG.PRO.tools
  if (starterTools === "ALL" || proTools === "ALL") {
    throw new Error("Invalid client plan config: STARTER/PRO cannot be ALL-tools plans")
  }
  for (const tool of starterTools) {
    if (!proTools.includes(tool)) {
      throw new Error(`Invalid client plan config: PRO must include STARTER tool "${tool}"`)
    }
  }
  const td = PLAN_CONFIG.PRO.trialDays ?? 0
  if (td < 0 || td > 90) {
    throw new Error("Invalid client plan config: PRO trialDays must be 0–90")
  }
  const freeTools = PLAN_CONFIG.FREE.tools
  if (freeTools.length !== 1 || freeTools[0] !== "video-script") {
    throw new Error("Invalid client plan config: FREE must only include video-script")
  }
}

assertPlanConfigIntegrity()
