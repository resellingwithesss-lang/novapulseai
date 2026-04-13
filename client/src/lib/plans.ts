export type UiPlan = "FREE" | "STARTER" | "PRO" | "ELITE"
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
  trialDays?: number
  monthlyPriceGbp: number
}

// Mirrored from server plan.constants (FREE = try-before-pay, not Stripe).
export const PLAN_CONFIG: Record<UiPlan, PlanDefinition> = {
  FREE: {
    credits: 4,
    tools: ["video-script"],
    monthlyPriceGbp: 0,
  },
  STARTER: {
    credits: 200,
    tools: ["clipper", "prompt"],
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER_MONTHLY ?? "STRIPE_STARTER_ID",
    yearlyPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER_YEARLY,
    monthlyPriceGbp: 14.99,
  },
  PRO: {
    credits: 1000,
    tools: ["clipper", "prompt", "story-maker", "video-script"],
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY ?? "STRIPE_PRO_ID",
    yearlyPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_YEARLY,
    trialDays: 3,
    monthlyPriceGbp: 29.99,
  },
  ELITE: {
    credits: 5000,
    tools: "ALL",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ELITE_MONTHLY ?? "STRIPE_ELITE_ID",
    yearlyPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ELITE_YEARLY,
    monthlyPriceGbp: 49.99,
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

export function getPlanCredits(plan?: string | null): number {
  return PLAN_CONFIG[normalizePlan(plan)].credits
}

export function getPlanMonthlyPriceGbp(plan?: string | null): number {
  return PLAN_CONFIG[normalizePlan(plan)].monthlyPriceGbp
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
  if (!PLAN_CONFIG.PRO.trialDays || PLAN_CONFIG.PRO.trialDays <= 0) {
    throw new Error("Invalid client plan config: PRO trialDays must be positive")
  }
  const freeTools = PLAN_CONFIG.FREE.tools
  if (freeTools.length !== 1 || freeTools[0] !== "video-script") {
    throw new Error("Invalid client plan config: FREE must only include video-script")
  }
}

assertPlanConfigIntegrity()
