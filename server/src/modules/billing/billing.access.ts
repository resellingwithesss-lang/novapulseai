import type { Plan, SubscriptionStatus } from "@prisma/client"
import { isStaffBillingExemptRole, staffEffectivePlanString } from "../../lib/staff-plan"
import { isAdminOrAboveRole } from "../../lib/roles"
import {
  type PlanTier,
  type ToolId,
  normalizePlanTier,
  planIncludesTool,
  hasPlanAtLeast,
  isFreePlanTier,
  minimumUpgradePlanForTool,
  getWorkflowLimits,
} from "../plans/plan.constants"

type SubscriptionState = "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED" | "EXPIRED" | "PAUSED"

export type BillingUserSnapshot = {
  plan: string
  subscriptionStatus: string
  trialExpiresAt: Date | null
  stripeSubscriptionId?: string | null
  banned: boolean
  credits?: number
  role?: string
}

type AccessResult =
  | { allowed: true; normalizedPlan: Plan }
  | { allowed: false; status: number; message: string }

export type EntitlementBlockedReason =
  | "ACCOUNT_SUSPENDED"
  | "SUBSCRIPTION_INACTIVE"
  | "TRIAL_EXPIRED"
  | "INSUFFICIENT_CREDITS"
  | "PLAN_UPGRADE_REQUIRED"
  | "ADMIN_REQUIRED"

export type FeatureAccessDecision = {
  allowed: boolean
  blockedReason: EntitlementBlockedReason | null
  minimumPlan: Plan | null
  upgradeRequired: boolean
}

export type EntitlementSnapshot = {
  plan: string
  normalizedPlan: Plan
  subscriptionStatus: SubscriptionStatus | string
  isTrialActive: boolean
  trialExpiresAt: Date | null
  isPaid: boolean
  isUnlimited: boolean
  creditsRemaining: number
  blockedReason: EntitlementBlockedReason | null
  upgradeRequired: boolean
  minimumPlan: Plan | null
  /** Saved workspaces / brand voices / content packs caps (enforce on create server-side). */
  workflowLimits: {
    maxWorkspaces: number
    maxBrandVoices: number
    maxContentPacks: number
  }
  featureAccess: {
    generation: FeatureAccessDecision
    prompt: FeatureAccessDecision
    storyMaker: FeatureAccessDecision
    clip: FeatureAccessDecision
    ads: FeatureAccessDecision
    admin: FeatureAccessDecision
  }
}

function normalizeSubscriptionStatus(status: string): SubscriptionState {
  const upper = status.toUpperCase()
  if (
    upper === "ACTIVE" ||
    upper === "TRIALING" ||
    upper === "PAST_DUE" ||
    upper === "CANCELED" ||
    upper === "EXPIRED" ||
    upper === "PAUSED"
  ) {
    return upper
  }
  return "CANCELED"
}

function baseBlockReason(
  user: BillingUserSnapshot,
  now: Date
): EntitlementBlockedReason | null {
  if (user.banned) {
    return "ACCOUNT_SUSPENDED"
  }

  if (isStaffBillingExemptRole(user.role)) {
    return null
  }

  const normalizedPlan = normalizePlanTier(staffEffectivePlanString(user.plan, user.role))

  /* FREE: no paid subscription required — tool + credit gates apply per feature */
  if (isFreePlanTier(normalizedPlan)) {
    return null
  }

  const status = normalizeSubscriptionStatus(user.subscriptionStatus)
  if (status !== "ACTIVE" && status !== "TRIALING") {
    return "SUBSCRIPTION_INACTIVE"
  }

  if (status === "TRIALING" && user.trialExpiresAt && now > user.trialExpiresAt) {
    return "TRIAL_EXPIRED"
  }

  return null
}

function blocked(
  reason: EntitlementBlockedReason,
  minimumPlan: Plan | null = null
): FeatureAccessDecision {
  return {
    allowed: false,
    blockedReason: reason,
    minimumPlan,
    upgradeRequired: reason === "PLAN_UPGRADE_REQUIRED",
  }
}

function allowed(): FeatureAccessDecision {
  return {
    allowed: true,
    blockedReason: null,
    minimumPlan: null,
    upgradeRequired: false,
  }
}

function evaluateFeatureAccess(
  normalizedPlan: PlanTier,
  baseReason: EntitlementBlockedReason | null,
  feature: "generation" | "storyMaker" | "clip" | "ads" | "admin",
  options: {
    creditsRemaining: number
    isUnlimited: boolean
    role?: string
    generationCost: number
    storyCost: number
  }
): FeatureAccessDecision {
  if (feature === "admin") {
    if (isAdminOrAboveRole(options.role)) {
      return allowed()
    }
    return blocked("ADMIN_REQUIRED")
  }

  if (baseReason) {
    return blocked(baseReason)
  }

  const featureToolMap: Record<"generation" | "storyMaker" | "clip" | "ads", ToolId> = {
    generation: "video-script",
    storyMaker: "story-maker",
    clip: "clipper",
    ads: "story-video-maker",
  }
  const toolId = featureToolMap[feature]
  if (toolId && !planIncludesTool(normalizedPlan, toolId)) {
    return blocked(
      "PLAN_UPGRADE_REQUIRED",
      minimumUpgradePlanForTool(normalizedPlan, toolId) as Plan
    )
  }
  if (
    (feature === "generation" && !options.isUnlimited && options.creditsRemaining < options.generationCost) ||
    (feature === "storyMaker" && !options.isUnlimited && options.creditsRemaining < options.storyCost)
  ) {
    return blocked("INSUFFICIENT_CREDITS")
  }

  return allowed()
}

export function buildEntitlementSnapshot(
  user: BillingUserSnapshot,
  options?: {
    now?: Date
    generationCost?: number
    storyCost?: number
  }
): EntitlementSnapshot {
  const now = options?.now ?? new Date()
  const planForEntitlements = staffEffectivePlanString(user.plan, user.role)
  const normalizedPlan = normalizePlanTier(planForEntitlements)
  const status = normalizeSubscriptionStatus(user.subscriptionStatus)
  const creditsRemaining = Math.max(0, user.credits ?? 0)
  const isUnlimited = false
  const isPaid =
    isStaffBillingExemptRole(user.role) ||
    (!isFreePlanTier(normalizedPlan) &&
      (status === "ACTIVE" || status === "TRIALING"))
  const isTrialActive =
    status === "TRIALING" && (!!user.trialExpiresAt ? user.trialExpiresAt > now : true)
  const baseReason = baseBlockReason(user, now)

  const generation = evaluateFeatureAccess(normalizedPlan, baseReason, "generation", {
    creditsRemaining,
    isUnlimited,
    role: user.role,
    generationCost: options?.generationCost ?? 1,
    storyCost: options?.storyCost ?? 1,
  })
  const storyMaker = evaluateFeatureAccess(normalizedPlan, baseReason, "storyMaker", {
    creditsRemaining,
    isUnlimited,
    role: user.role,
    generationCost: options?.generationCost ?? 1,
    storyCost: options?.storyCost ?? 1,
  })
  const clip = evaluateFeatureAccess(normalizedPlan, baseReason, "clip", {
    creditsRemaining,
    isUnlimited,
    role: user.role,
    generationCost: options?.generationCost ?? 1,
    storyCost: options?.storyCost ?? 1,
  })
  const ads = evaluateFeatureAccess(normalizedPlan, baseReason, "ads", {
    creditsRemaining,
    isUnlimited,
    role: user.role,
    generationCost: options?.generationCost ?? 1,
    storyCost: options?.storyCost ?? 1,
  })
  const admin = evaluateFeatureAccess(normalizedPlan, baseReason, "admin", {
    creditsRemaining,
    isUnlimited,
    role: user.role,
    generationCost: options?.generationCost ?? 1,
    storyCost: options?.storyCost ?? 1,
  })

  const wf = getWorkflowLimits(planForEntitlements)

  const prompt: FeatureAccessDecision =
    baseReason
      ? blocked(baseReason)
      : planIncludesTool(normalizedPlan, "prompt")
        ? allowed()
        : blocked(
            "PLAN_UPGRADE_REQUIRED",
            minimumUpgradePlanForTool(normalizedPlan, "prompt") as Plan
          )

  return {
    plan: planForEntitlements,
    normalizedPlan: normalizedPlan as Plan,
    subscriptionStatus: status,
    isTrialActive,
    trialExpiresAt: user.trialExpiresAt,
    isPaid,
    isUnlimited,
    creditsRemaining,
    blockedReason: baseReason,
    upgradeRequired: false,
    minimumPlan: null,
    workflowLimits: {
      maxWorkspaces: wf.workspaces,
      maxBrandVoices: wf.brandVoices,
      maxContentPacks: wf.contentPacks,
    },
    featureAccess: {
      generation,
      prompt,
      storyMaker,
      clip,
      ads,
      admin,
    },
  }
}

export function evaluateBillingAccess(
  user: BillingUserSnapshot,
  options?: { minPlan?: Plan; now?: Date }
): AccessResult {
  const snapshot = buildEntitlementSnapshot(user, {
    now: options?.now,
  })

  if (snapshot.blockedReason === "ACCOUNT_SUSPENDED") {
    return { allowed: false, status: 403, message: "Account suspended" }
  }
  if (snapshot.blockedReason === "SUBSCRIPTION_INACTIVE") {
    return { allowed: false, status: 403, message: "Active subscription required" }
  }
  if (snapshot.blockedReason === "TRIAL_EXPIRED") {
    return { allowed: false, status: 403, message: "Trial expired" }
  }

  const minPlan = options?.minPlan
  if (minPlan && !hasPlanAtLeast(snapshot.normalizedPlan, minPlan as PlanTier)) {
    return { allowed: false, status: 403, message: `${minPlan} plan required` }
  }

  return { allowed: true, normalizedPlan: snapshot.normalizedPlan }
}
