import type { PrismaClient } from "@prisma/client"
import { Prisma } from "@prisma/client"

const MIGRATE_FIX =
  "From the server folder run: npx prisma migrate deploy — then restart the API."

/**
 * Physical PostgreSQL column names on `public."User"`.
 * Keep in sync with `prisma/schema.prisma` model `User` (additive changes must update this list).
 */
const REQUIRED_USER_COLUMNS = [
  "id",
  "email",
  "password",
  "provider",
  "displayName",
  "preferences",
  "emailVerified",
  "marketingEmails",
  "marketingUnsubscribeToken",
  "lastEmailSentAt",
  "role",
  "plan",
  "subscriptionStatus",
  "credits",
  "monthlyCredits",
  "monthlyResetAt",
  "lifetimeCreditsUsed",
  "bonusCredits",
  "tokenVersion",
  "loginAttempts",
  "lockUntil",
  "banned",
  "bannedReason",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "trialExpiresAt",
  "subscriptionStartedAt",
  "subscriptionEndsAt",
  "cancelAtPeriodEnd",
  "lastLoginAt",
  "lastActiveAt",
  "lastIpAddress",
  "lastUserAgent",
  "deletedAt",
  "totalTokensUsed",
  "totalAiCostUsd",
  "lifetimeValueUsd",
  "totalGenerations",
  "createdAt",
  "updatedAt",
] as const

async function userTableExists(prisma: PrismaClient): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname = 'User'
    ) AS "exists"
  `
  return Boolean(rows[0]?.exists)
}

async function userColumnNames(prisma: PrismaClient): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ attname: string }>>`
    SELECT a.attname AS "attname"
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'User'
      AND a.attnum > 0
      AND NOT a.attisdropped
  `
  return new Set(rows.map((r) => r.attname))
}

/**
 * Ensures PostgreSQL is reachable and core auth tables/columns match the current Prisma schema.
 * Call after `loadServerEnv()` and with `DATABASE_URL` set.
 *
 * Set `PRISMA_SKIP_API_DATABASE_READY=true` only for rare recovery scenarios (not recommended in production).
 */
export async function assertApiDatabaseReady(prisma: PrismaClient): Promise<void> {
  if (process.env.PRISMA_SKIP_API_DATABASE_READY === "true") {
    console.warn(
      "⚠️ PRISMA_SKIP_API_DATABASE_READY=true: skipping API database readiness check (not recommended in production)."
    )
    return
  }

  await prisma.$connect()
  await prisma.$queryRaw`SELECT 1 AS "ok"`

  const exists = await userTableExists(prisma)
  if (!exists) {
    throw new Error(
      `Missing required table: User. Database schema not migrated. ${MIGRATE_FIX}`
    )
  }

  const present = await userColumnNames(prisma)
  const missing = REQUIRED_USER_COLUMNS.filter((c) => !present.has(c))
  if (missing.length > 0) {
    throw new Error(
      `Database schema not migrated: User table missing column(s): ${missing.join(
        ", "
      )}. ${MIGRATE_FIX}`
    )
  }
}

/** Maps Prisma “table/column missing” errors to a stable API response + log line. */
export function describePrismaSchemaDrift(err: unknown): {
  httpMessage: string
  logLine: string
  prismaCode: string
} | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null
  if (err.code !== "P2021" && err.code !== "P2022") return null

  const meta = err.meta as Record<string, unknown> | undefined
  if (err.code === "P2021") {
    const modelName = typeof meta?.modelName === "string" ? meta.modelName : undefined
    const table = typeof meta?.table === "string" ? meta.table : undefined
    const target = modelName ?? table
    const httpMessage = target
      ? `Database schema not migrated: missing required table (${target}). ${MIGRATE_FIX}`
      : `Database schema not migrated: a required table is missing. ${MIGRATE_FIX}`
    return {
      httpMessage,
      logLine: `Prisma P2021 (missing table). meta=${JSON.stringify(meta ?? {})}`,
      prismaCode: err.code,
    }
  }

  const column = typeof meta?.column === "string" ? meta.column : undefined
  const httpMessage = column
    ? `Database schema not migrated: missing column (${column}). ${MIGRATE_FIX}`
    : `Database schema not migrated: a required column is missing. ${MIGRATE_FIX}`
  return {
    httpMessage,
    logLine: `Prisma P2022 (missing column). meta=${JSON.stringify(meta ?? {})}`,
    prismaCode: err.code,
  }
}

export function isPrismaSchemaDriftError(err: unknown): boolean {
  return describePrismaSchemaDrift(err) !== null
}
