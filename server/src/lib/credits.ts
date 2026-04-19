/**
 * Credit operations — the single source of truth for credit movements.
 *
 * Why this module exists
 * ----------------------
 * Historically credits were debited and granted directly from four separate
 * modules (credits middleware, generation accounting, story-maker route,
 * content-packs route) plus the Stripe webhook. Each site hand-rolled the
 * `User.credits` update, the `CreditTransaction` row, and (usually) forgot
 * to write `balanceAfter` or increment `lifetimeCreditsUsed`. Two sites
 * stored `amount: +cost` for a debit; two sites stored `amount: -cost`.
 * The admin aggregate had to compensate with `Math.abs`. Auditability was
 * unreliable by construction.
 *
 * This module consolidates the behaviour into three operations:
 *
 *   chargeCredits     — subtract (guarded)
 *   grantCredits      — add (monthly refills, admin top-ups, referrals…)
 *   resetCreditsToPlan — absolute set (monthly reset to plan cap)
 *
 * Each operation:
 *   - writes a `CreditTransaction` with a canonical **signed** `amount`
 *     (debits are negative, grants positive — always),
 *   - writes `balanceAfter` so the ledger is fully reconstructable,
 *   - increments `lifetimeCreditsUsed` on debits,
 *   - runs inside a caller-provided transaction (`tx`) so the debit, the
 *     ledger row, and any downstream persistence (Generation / ContentPack /
 *     User update) commit or roll back together.
 *
 * Callers should import the `CREDIT_REASON` constants rather than typing
 * free-form strings — drift in the reason field was the other source of
 * admin-aggregate confusion.
 *
 * NOTE on backward compatibility:
 *   - The `CreditTransaction` schema (amount, type, reason, balanceAfter,
 *     metadata) is unchanged. No migration is needed.
 *   - Rows written by earlier code (with positive `amount` for debits, or
 *     with `balanceAfter = null`) remain valid — the admin aggregates
 *     continue to use `Math.abs` defensively until all historical rows age
 *     out of the relevant reporting windows.
 */

import type { Prisma } from "@prisma/client"
import { CreditType } from "@prisma/client"

/* =====================================================
   REASON STRINGS
===================================================== */

/**
 * Canonical reason codes for `CreditTransaction.reason`. Kept as a const
 * object (not a Prisma enum) because it evolves faster than schema migrations
 * and because free-form reasons were already in historical rows.
 *
 * When adding a new reason, keep the string short, present-tense, and
 * user-readable — the Settings → Usage page renders these directly.
 */
export const CREDIT_REASON = {
  // Debits
  GENERATION_SCRIPT: "Script generation",
  GENERATION_STORY: "Story generation",
  GENERATION_CONTENT_PACK: "Content pack generation",
  GENERATION_MIDDLEWARE: "Usage",

  // Grants
  MONTHLY_BILLING_RESET: "Monthly billing reset",
  PLAN_CHANGE_RESET: "Plan change credit reset",
  PLAN_UPGRADE_RESET: "Plan upgrade credit reset",
  PLAN_DOWNGRADE_RESET: "Plan downgrade credit reset",
  SUBSCRIPTION_CANCEL_RESET: "Subscription cancellation credit reset",
  ADMIN_GRANT: "Admin grant",
  ADMIN_DEBIT: "Admin debit",
  REFUND: "Refund",
  BONUS: "Bonus credits",
  PROMOTION: "Promotional credits",
} as const

export type CreditReason = (typeof CREDIT_REASON)[keyof typeof CREDIT_REASON]

/* =====================================================
   ERRORS
===================================================== */

export type CreditErrorCode = "INSUFFICIENT_CREDITS" | "USER_NOT_FOUND" | "INVALID_AMOUNT"

export class CreditError extends Error {
  code: CreditErrorCode
  constructor(code: CreditErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = "CreditError"
  }
}

/* =====================================================
   INTERNAL HELPERS
===================================================== */

type TxClient = Prisma.TransactionClient

function assertPositiveAmount(amount: number, label: string): void {
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    throw new CreditError(
      "INVALID_AMOUNT",
      `${label}: amount must be a positive integer (got ${amount})`
    )
  }
}

function assertNonNegativeAmount(amount: number, label: string): void {
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0) {
    throw new CreditError(
      "INVALID_AMOUNT",
      `${label}: amount must be a non-negative integer (got ${amount})`
    )
  }
}

/* =====================================================
   PUBLIC OPERATIONS
===================================================== */

export type ChargeCreditsInput = {
  tx: TxClient
  userId: string
  amount: number
  reason: string
  /** Defaults to CREDIT_USE. Admin debits should pass ADMIN_ADJUSTMENT. */
  type?: CreditType
  requestId?: string
  metadata?: Prisma.InputJsonValue
  ipAddress?: string
}

export type ChargeCreditsResult = {
  balanceBefore: number
  balanceAfter: number
  transactionId: string
}

/**
 * Debit `amount` credits from `userId`. Fails with `INSUFFICIENT_CREDITS` if
 * the user does not have at least `amount` credits. Always writes a ledger
 * row with negative `amount` and `balanceAfter`, and increments
 * `lifetimeCreditsUsed` by `amount`.
 *
 * Caller must run this inside a `$transaction`; the caller's transaction is
 * what ensures that any downstream persistence (e.g. `Generation.create`)
 * and this debit commit or roll back together.
 */
export async function chargeCredits(input: ChargeCreditsInput): Promise<ChargeCreditsResult> {
  const {
    tx,
    userId,
    amount,
    reason,
    type = CreditType.CREDIT_USE,
    requestId,
    metadata,
    ipAddress,
  } = input

  assertPositiveAmount(amount, "chargeCredits")

  const debitResult = await tx.user.updateMany({
    where: { id: userId, credits: { gte: amount } },
    data: {
      credits: { decrement: amount },
      lifetimeCreditsUsed: { increment: amount },
    },
  })

  if (debitResult.count === 0) {
    // Either the user does not exist or they have fewer than `amount`
    // credits. Distinguish for clearer errors.
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) {
      throw new CreditError("USER_NOT_FOUND", `User ${userId} not found`)
    }
    throw new CreditError("INSUFFICIENT_CREDITS", "Not enough credits")
  }
  if (debitResult.count !== 1) {
    throw new Error(
      `chargeCredits invariant violation: guarded debit updated ${debitResult.count} rows`
    )
  }

  // Read balance after the decrement so the ledger row is self-describing.
  const after = await tx.user.findUnique({
    where: { id: userId },
    select: { credits: true },
  })
  const balanceAfter = after?.credits ?? 0
  const balanceBefore = balanceAfter + amount

  const row = await tx.creditTransaction.create({
    data: {
      userId,
      amount: -amount,
      type,
      reason,
      balanceAfter,
      ...(requestId ? { requestId } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
      ...(ipAddress ? { ipAddress } : {}),
    },
    select: { id: true },
  })

  return { balanceBefore, balanceAfter, transactionId: row.id }
}

export type GrantCreditsInput = {
  tx: TxClient
  userId: string
  amount: number
  reason: string
  /** Defaults to CREDIT_ADD. Admin grants should pass ADMIN_ADJUSTMENT. */
  type?: CreditType
  requestId?: string
  metadata?: Prisma.InputJsonValue
  ipAddress?: string
}

export type GrantCreditsResult = {
  balanceBefore: number
  balanceAfter: number
  transactionId: string
}

/**
 * Credit `amount` to `userId` (monthly refill, admin top-up, referral bonus,
 * refund, etc.). Never fails on balance. Always writes a ledger row with
 * positive `amount` and `balanceAfter`.
 */
export async function grantCredits(input: GrantCreditsInput): Promise<GrantCreditsResult> {
  const {
    tx,
    userId,
    amount,
    reason,
    type = CreditType.CREDIT_ADD,
    requestId,
    metadata,
    ipAddress,
  } = input

  assertPositiveAmount(amount, "grantCredits")

  const before = await tx.user.findUnique({
    where: { id: userId },
    select: { credits: true },
  })
  if (!before) {
    throw new CreditError("USER_NOT_FOUND", `User ${userId} not found`)
  }
  const balanceBefore = before.credits

  await tx.user.update({
    where: { id: userId },
    data: { credits: { increment: amount } },
  })

  const balanceAfter = balanceBefore + amount

  const row = await tx.creditTransaction.create({
    data: {
      userId,
      amount,
      type,
      reason,
      balanceAfter,
      ...(requestId ? { requestId } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
      ...(ipAddress ? { ipAddress } : {}),
    },
    select: { id: true },
  })

  return { balanceBefore, balanceAfter, transactionId: row.id }
}

export type ResetCreditsToPlanInput = {
  tx: TxClient
  userId: string
  /** Absolute target balance (e.g. `creditsForPlan(newPlan)`). */
  target: number
  /** Also set `monthlyCredits` to this value (true for true plan/cycle resets). */
  setMonthlyCredits?: boolean
  /** Also set `monthlyResetAt = now` (true for monthly/cycle refills). */
  resetMonthlyResetAt?: boolean
  reason: string
  type?: CreditType
  requestId?: string
  metadata?: Prisma.InputJsonValue
}

export type ResetCreditsToPlanResult = {
  balanceBefore: number
  balanceAfter: number
  delta: number
  transactionId: string | null
}

/**
 * Absolute credit set — primary use is Stripe monthly/plan-change resets.
 * Writes a single ledger row with `amount = target - balanceBefore` so the
 * audit trail stays continuous. If the delta is zero, no ledger row is
 * written (the user state is already correct).
 */
export async function resetCreditsToPlan(
  input: ResetCreditsToPlanInput
): Promise<ResetCreditsToPlanResult> {
  const {
    tx,
    userId,
    target,
    setMonthlyCredits = false,
    resetMonthlyResetAt = false,
    reason,
    type = CreditType.MONTHLY_RESET,
    requestId,
    metadata,
  } = input

  assertNonNegativeAmount(target, "resetCreditsToPlan.target")

  const before = await tx.user.findUnique({
    where: { id: userId },
    select: { credits: true },
  })
  if (!before) {
    throw new CreditError("USER_NOT_FOUND", `User ${userId} not found`)
  }
  const balanceBefore = before.credits
  const delta = target - balanceBefore

  await tx.user.update({
    where: { id: userId },
    data: {
      credits: target,
      ...(setMonthlyCredits ? { monthlyCredits: target } : {}),
      ...(resetMonthlyResetAt ? { monthlyResetAt: new Date() } : {}),
    },
  })

  if (delta === 0) {
    return { balanceBefore, balanceAfter: target, delta, transactionId: null }
  }

  const row = await tx.creditTransaction.create({
    data: {
      userId,
      amount: delta,
      type,
      reason,
      balanceAfter: target,
      ...(requestId ? { requestId } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    },
    select: { id: true },
  })

  return { balanceBefore, balanceAfter: target, delta, transactionId: row.id }
}

/* =====================================================
   RE-EXPORT
===================================================== */

export { CreditType }
