import crypto from "crypto"
import type Stripe from "stripe"
import {
  AuditAction,
  Plan,
  Prisma,
  ReferralCommissionStatus,
} from "@prisma/client"
import { prisma } from "../../lib/prisma"

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const t = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
  if (t.length < 4 || t.length > 32) return null
  return t
}

export async function generateUniqueReferralCode(): Promise<string> {
  for (let i = 0; i < 60; i++) {
    let out = ""
    const bytes = crypto.randomBytes(12)
    for (let j = 0; j < 8; j++) {
      out += CODE_ALPHABET[bytes[j]! % CODE_ALPHABET.length]!
    }
    const clash = await prisma.user.findFirst({
      where: { referralCode: out },
      select: { id: true },
    })
    if (!clash) return out
  }
  throw new Error("referral_code_generation_exhausted")
}

export async function resolveReferrerId(
  code: string | null
): Promise<string | null> {
  if (!code) return null
  const ref = await prisma.user.findFirst({
    where: {
      referralCode: code,
      deletedAt: null,
      banned: false,
    },
    select: { id: true },
  })
  return ref?.id ?? null
}

/**
 * Record5% (configurable bps) commission on paid Stripe invoices for referred users.
 * Idempotent per `stripeInvoiceId`. Honors REFERRAL_FIRST_PAYMENT_ONLY (default: true).
 */
export async function recordReferralCommissionFromInvoice(opts: {
  tx: Prisma.TransactionClient
  stripeEventId: string
  invoice: Stripe.Invoice
  refereeUserId: string
  plan: Plan
}): Promise<void> {
  const { tx, stripeEventId, invoice, refereeUserId, plan } = opts
  const invId = typeof invoice.id === "string" ? invoice.id : null
  if (!invId) return

  const amountPaid = invoice.amount_paid ?? 0
  if (amountPaid <= 0) return

  const referee = await tx.user.findUnique({
    where: { id: refereeUserId },
    select: { referredByUserId: true },
  })
  const referrerId = referee?.referredByUserId
  if (!referrerId || referrerId === refereeUserId) return

  const rawBps = Number(process.env.REFERRAL_COMMISSION_RATE_BPS ?? "500")
  const rateBps = Math.min(10_000, Math.max(0, Number.isFinite(rawBps) ? rawBps : 500))
  const commissionMinor = Math.floor((amountPaid * rateBps) / 10_000)
  if (commissionMinor <= 0) return

  const firstOnly = process.env.REFERRAL_FIRST_PAYMENT_ONLY !== "false"
  if (firstOnly) {
    const existing = await tx.referralCommission.findFirst({
      where: {
        refereeUserId,
        status: { not: ReferralCommissionStatus.VOID },
      },
      select: { id: true },
    })
    if (existing) return
  }

  try {
    await tx.referralCommission.create({
      data: {
        referrerUserId: referrerId,
        refereeUserId,
        stripeInvoiceId: invId,
        stripeEventId,
        currency: (invoice.currency || "gbp").toLowerCase(),
        invoiceAmountMinor: amountPaid,
        commissionRateBps: rateBps,
        commissionAmountMinor: commissionMinor,
        plan,
        status: ReferralCommissionStatus.PENDING,
      },
    })

    await tx.auditLog.create({
      data: {
        userId: refereeUserId,
        action: AuditAction.REFERRAL_COMMISSION_RECORDED,
        metadata: {
          referrerUserId: referrerId,
          stripeInvoiceId: invId,
          commissionAmountMinor: commissionMinor,
          currency: (invoice.currency || "gbp").toLowerCase(),
        } as Prisma.InputJsonValue,
        requestId: stripeEventId,
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return
    }
    throw e
  }
}

export async function ensureUserReferralCode(userId: string): Promise<string> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  })
  if (row?.referralCode) return row.referralCode
  const code = await generateUniqueReferralCode()
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { referralCode: code },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await prisma.user.findUnique({
        where: { id: userId },
        select: { referralCode: true },
      })
      if (again?.referralCode) return again.referralCode
    }
    throw e
  }
  return code
}
