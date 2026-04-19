export type PlanTier = "FREE" | "STARTER" | "PRO" | "ELITE"
export type ToolId =
  | "clipper"
  | "prompt"
  | "story-maker"
  | "video-script"
  | "story-video-maker"

type PlanDefinition = {
  credits: number
  tools: ToolId[] | "ALL"
  /** Stripe price id — FREE has none */
  priceId?: string
  yearlyPriceId?: string
  /**
   * Output / UX limits (server + client). Do not replace credit debiting — these
   * only cap how many artifacts we return or how many “improve” actions we expose.
   */
  scriptVariantCount: number
  /** Elite ads: maps to renderTopVariants (max 2 in pipeline). */
  adVariantCount: number
  /** Clip jobs: max requested clips per run (clamped server-side). */
  clipVariantCount: number
  improveActionsLimit: number
}

/**
 * PRO monthly checkout trial length (days). Server-only; Stripe Dashboard trial settings are not used.
 * `STRIPE_PRO_TRIAL_DAYS`: unset defaults to **14**; `0` disables checkout trials; max **90**.
 */
export function getProCheckoutTrialDays(): number {
  const raw = process.env.STRIPE_PRO_TRIAL_DAYS?.trim()
  if (raw === undefined || raw === "") return 14
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return 14
  if (n <= 0) return 0
  if (n > 90) return 90
  return n
}

export const PLAN_CONFIG: Record<PlanTier, PlanDefinition> = {
  FREE: {
    credits: 4,
    tools: ["video-script"],
    scriptVariantCount: 2,
    adVariantCount: 0,
    clipVariantCount: 0,
    improveActionsLimit: 1,
  },
  STARTER: {
    credits: 200,
    tools: ["clipper", "prompt"],
    priceId: process.env.STRIPE_PRICE_STARTER_MONTHLY ?? "STRIPE_STARTER_ID",
    yearlyPriceId: process.env.STRIPE_PRICE_STARTER_YEARLY,
    scriptVariantCount: 3,
    adVariantCount: 0,
    clipVariantCount: 6,
    improveActionsLimit: 2,
  },
  PRO: {
    credits: 1000,
    tools: ["clipper", "prompt", "story-maker", "video-script"],
    priceId: process.env.STRIPE_PRICE_PRO_MONTHLY ?? "STRIPE_PRO_ID",
    yearlyPriceId: process.env.STRIPE_PRICE_PRO_YEARLY,
    scriptVariantCount: 5,
    adVariantCount: 0,
    clipVariantCount: 10,
    improveActionsLimit: 4,
  },
  ELITE: {
    credits: 5000,
    tools: "ALL",
    priceId: process.env.STRIPE_PRICE_ELITE_MONTHLY ?? "STRIPE_ELITE_ID",
    yearlyPriceId: process.env.STRIPE_PRICE_ELITE_YEARLY,
    scriptVariantCount: 7,
    adVariantCount: 2,
    clipVariantCount: 14,
    improveActionsLimit: 6,
  },
}

/** Full ladder (FREE lowest). */
export const PLAN_LADDER: PlanTier[] = ["FREE", "STARTER", "PRO", "ELITE"]

/** Max saved workspaces / brand voices / content packs per plan (server-enforced). */
export const WORKFLOW_LIMITS: Record<
  PlanTier,
  { workspaces: number; brandVoices: number; contentPacks: number }
> = {
  FREE: { workspaces: 2, brandVoices: 4, contentPacks: 12 },
  STARTER: { workspaces: 8, brandVoices: 20, contentPacks: 80 },
  PRO: { workspaces: 25, brandVoices: 60, contentPacks: 400 },
  ELITE: { workspaces: 100, brandVoices: 250, contentPacks: 2500 },
}

export function getWorkflowLimits(plan?: string | null) {
  return WORKFLOW_LIMITS[normalizePlanTier(plan)]
}

/** True when creating another row would exceed the plan cap (currentCount is existing rows). */
export function isAtWorkflowLimit(
  plan: string | null | undefined,
  resource: keyof (typeof WORKFLOW_LIMITS)["FREE"],
  currentCount: number
): boolean {
  const cap = getWorkflowLimits(plan)[resource]
  return currentCount >= cap
}

/** Tiers that map to Stripe products (checkout / webhooks). */
export const PAID_PLAN_TIERS: PlanTier[] = ["STARTER", "PRO", "ELITE"]

/** Monthly list price in GBP (mirrors client `lib/plans` for admin estimates). */
export const PLAN_MONTHLY_GBP: Record<PlanTier, number> = {
  FREE: 0,
  STARTER: 14.99,
  PRO: 29.99,
  ELITE: 49.99,
}

export function normalizePlanTier(plan?: string | null): PlanTier {
  const upper = String(plan || "").toUpperCase()
  if (upper === "FREE") return "FREE"
  if (upper === "STARTER") return "STARTER"
  if (upper === "PRO") return "PRO"
  if (upper === "ELITE") return "ELITE"
  return "FREE"
}

export function isFreePlanTier(plan?: string | null): boolean {
  return normalizePlanTier(plan) === "FREE"
}

export function getPlanCredits(plan?: string | null): number {
  return PLAN_CONFIG[normalizePlanTier(plan)].credits
}

/** Numeric output limits for tools + improve actions (plan ladder). */
export function getPlanOutputLimits(plan?: string | null): {
  scriptVariantCount: number
  adVariantCount: number
  clipVariantCount: number
  improveActionsLimit: number
} {
  const tier = normalizePlanTier(plan)
  const row = PLAN_CONFIG[tier]
  return {
    scriptVariantCount: row.scriptVariantCount,
    adVariantCount: row.adVariantCount,
    clipVariantCount: row.clipVariantCount,
    improveActionsLimit: row.improveActionsLimit,
  }
}

export function planRank(plan?: string | null): number {
  return PLAN_LADDER.indexOf(normalizePlanTier(plan))
}

export function hasPlanAtLeast(plan: string | null | undefined, minimum: PlanTier): boolean {
  return planRank(plan) >= planRank(minimum)
}

export function planIncludesTool(plan: string | null | undefined, toolId: ToolId): boolean {
  const tools = PLAN_CONFIG[normalizePlanTier(plan)].tools
  if (tools === "ALL") return true
  return tools.includes(toolId)
}

/**
 * Smallest tier strictly above `from` that unlocks the tool (for upgrade CTAs).
 */
export function minimumUpgradePlanForTool(from: PlanTier, toolId: ToolId): PlanTier {
  for (const tier of PLAN_LADDER) {
    if (planRank(tier) > planRank(from) && planIncludesTool(tier, toolId)) {
      return tier
    }
  }
  return "ELITE"
}

export function resolvePlanFromStripePriceId(priceId?: string | null): PlanTier | null {
  if (!priceId) return null
  for (const plan of PAID_PLAN_TIERS) {
    const config = PLAN_CONFIG[plan]
    if (config.priceId === priceId || config.yearlyPriceId === priceId) {
      return plan
    }
  }
  return null
}

function assertPlanConfigIntegrity() {
  const starterTools = PLAN_CONFIG.STARTER.tools
  const proTools = PLAN_CONFIG.PRO.tools
  if (starterTools === "ALL" || proTools === "ALL") {
    throw new Error("Invalid plan config: STARTER/PRO cannot be ALL-tools plans")
  }
  for (const tool of starterTools) {
    if (!proTools.includes(tool)) {
      throw new Error(`Invalid plan config: PRO must include STARTER tool "${tool}"`)
    }
  }
  const trialDays = getProCheckoutTrialDays()
  if (trialDays < 0 || trialDays > 90) {
    throw new Error("Invalid plan config: getProCheckoutTrialDays() out of range")
  }
  const freeTools = PLAN_CONFIG.FREE.tools
  if (freeTools.length !== 1 || freeTools[0] !== "video-script") {
    throw new Error("Invalid plan config: FREE must only include video-script")
  }
}

assertPlanConfigIntegrity()
