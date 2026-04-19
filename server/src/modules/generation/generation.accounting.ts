import type { Prisma, PrismaClient } from "@prisma/client"
import type { GenerationType } from "./generation.contract"
import type { GenerationAccountingErrorCode } from "./generation.contract"
import { buildEntitlementSnapshot } from "../billing/billing.access"
import { chargeCredits, CreditError, CREDIT_REASON } from "../../lib/credits"

export type GenerationUserSnapshot = {
  id: string
  credits: number
  plan: string
  banned: boolean
  subscriptionStatus: string
  trialExpiresAt: Date | null
  stripeSubscriptionId: string | null
  role: string
}

export class GenerationAccountingError extends Error {
  code: GenerationAccountingErrorCode
  status: number
  retryAfterMs?: number

  constructor(
    code: GenerationAccountingErrorCode,
    message: string,
    status: number,
    retryAfterMs?: number
  ) {
    super(message)
    this.code = code
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

export function isGenerationAccountingError(
  error: unknown
): error is GenerationAccountingError {
  return error instanceof GenerationAccountingError
}

export function isCooldownActiveAccountingError(
  error: unknown
): error is GenerationAccountingError & {
  code: "COOLDOWN_ACTIVE"
  retryAfterMs: number
} {
  return (
    error instanceof GenerationAccountingError &&
    error.code === "COOLDOWN_ACTIVE" &&
    typeof error.retryAfterMs === "number"
  )
}

export async function loadGenerationUserSnapshot(
  prisma: PrismaClient,
  userId: string
): Promise<GenerationUserSnapshot | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      credits: true,
      plan: true,
      banned: true,
      subscriptionStatus: true,
      trialExpiresAt: true,
      stripeSubscriptionId: true,
      role: true,
    },
  })

  if (!user) return null

  return {
    id: user.id,
    credits: user.credits,
    plan: user.plan,
    banned: user.banned,
    subscriptionStatus: user.subscriptionStatus,
    trialExpiresAt: user.trialExpiresAt,
    stripeSubscriptionId: user.stripeSubscriptionId,
    role: user.role,
  }
}

export function evaluateGenerationEligibility(
  user: GenerationUserSnapshot,
  now: Date,
  generationCost: number
):
  | { allowed: true; isUnlimited: boolean; scriptVariantCount: number }
  | { allowed: false; status: number; message: string } {
  const entitlement = buildEntitlementSnapshot(
    {
      plan: user.plan,
      subscriptionStatus: user.subscriptionStatus,
      trialExpiresAt: user.trialExpiresAt,
      stripeSubscriptionId: user.stripeSubscriptionId,
      banned: user.banned,
      credits: user.credits,
      role: user.role,
    },
    {
      now,
      generationCost,
    }
  )

  const decision = entitlement.featureAccess.generation
  if (!decision.allowed) {
    if (decision.blockedReason === "ACCOUNT_SUSPENDED") {
      return { allowed: false, status: 403, message: "Account suspended" }
    }
    if (decision.blockedReason === "SUBSCRIPTION_INACTIVE") {
      return {
        allowed: false,
        status: 403,
        message: "Active subscription required",
      }
    }
    if (decision.blockedReason === "TRIAL_EXPIRED") {
      return { allowed: false, status: 403, message: "Trial expired" }
    }
    if (decision.blockedReason === "INSUFFICIENT_CREDITS") {
      return { allowed: false, status: 403, message: "No credits remaining" }
    }
    if (decision.blockedReason === "PLAN_UPGRADE_REQUIRED" && decision.minimumPlan) {
      return {
        allowed: false,
        status: 403,
        message: `${decision.minimumPlan} plan required for script generation`,
      }
    }
    return {
      allowed: false,
      status: 403,
      message: "Script generation unavailable on your current plan",
    }
  }

  return {
    allowed: true,
    isUnlimited: entitlement.isUnlimited,
    scriptVariantCount: entitlement.scriptVariantCount,
  }
}

export async function loadLastGenerationTimestamp(
  prisma: PrismaClient,
  userId: string
): Promise<Date | null> {
  const lastGen = await prisma.generation.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  })

  return lastGen?.createdAt ?? null
}

export function evaluateCooldown(
  lastCreatedAt: Date | null,
  nowMs: number,
  cooldownMs: number
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  if (!lastCreatedAt) return { allowed: true }

  const diff = nowMs - lastCreatedAt.getTime()
  if (diff < cooldownMs) {
    return {
      allowed: false,
      retryAfterMs: cooldownMs - diff,
    }
  }

  return { allowed: true }
}

export async function persistGenerationAndAccounting(
  tx: Prisma.TransactionClient,
  params: {
    userId: string
    type: GenerationType
    input: string
    outputJson: string
    requestId: string
    durationMs: number
    modelUsed: string
    isUnlimited: boolean
    generationCost: number
    cooldownMs: number
    workspaceId?: string | null
    brandVoiceId?: string | null
    sourceContentPackId?: string | null
    sourceGenerationId?: string | null
    sourceType?: string | null
  }
): Promise<void> {
  const {
    userId,
    type,
    input,
    outputJson,
    requestId,
    durationMs,
    modelUsed,
    isUnlimited,
    generationCost,
    cooldownMs,
    workspaceId,
    brandVoiceId,
    sourceContentPackId,
    sourceGenerationId,
    sourceType,
  } = params

  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`

  const lastGeneration = await tx.generation.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  })

  const cooldown = evaluateCooldown(
    lastGeneration?.createdAt ?? null,
    Date.now(),
    cooldownMs
  )

  if (cooldown.allowed === false) {
    throw new GenerationAccountingError(
      "COOLDOWN_ACTIVE",
      "Please wait before generating again.",
      429,
      cooldown.retryAfterMs
    )
  }

  if (!isUnlimited) {
    try {
      await chargeCredits({
        tx,
        userId,
        amount: generationCost,
        reason: CREDIT_REASON.GENERATION_SCRIPT,
        requestId,
      })
    } catch (err) {
      if (err instanceof CreditError && err.code === "INSUFFICIENT_CREDITS") {
        throw new GenerationAccountingError(
          "INSUFFICIENT_CREDITS",
          "No credits remaining",
          403
        )
      }
      throw err
    }
  }

  await tx.generation.create({
    data: {
      userId,
      type,
      input,
      output: outputJson,
      creditsUsed: isUnlimited ? 0 : generationCost,
      requestId,
      durationMs,
      modelUsed,
      ...(workspaceId ? { workspaceId } : {}),
      ...(brandVoiceId ? { brandVoiceId } : {}),
      ...(sourceContentPackId ? { sourceContentPackId } : {}),
      ...(sourceGenerationId ? { sourceGenerationId } : {}),
      ...(sourceType ? { sourceType } : {}),
    },
  })
}
