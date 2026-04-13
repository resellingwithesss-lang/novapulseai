import { prisma } from "./prisma"

/**
 * Columns added in creator-workflow + generation-lineage migrations.
 * If any are missing, the live DB is behind `schema.prisma` — almost always **unapplied
 * migrations** — until `npm run migrate:deploy` (from `server/`) is run against that database.
 */
export const REQUIRED_AD_JOB_OPTIONAL_COLUMNS = [
  "workspaceId",
  "sourceContentPackId",
  "sourceGenerationId",
  "sourceType",
] as const

/** PostgreSQL catalog: physical column names on `public."AdJob"`. */
export async function getAdJobPgColumnNames(): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ attname: string }>>`
    SELECT a.attname AS "attname"
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'AdJob'
      AND a.attnum > 0
      AND NOT a.attisdropped
  `
  return new Set(rows.map(r => r.attname))
}

/**
 * Lightweight startup check: compares live PostgreSQL `AdJob` attributes to the expected set.
 * Logs a clear warning if the database is behind migrations — does not exit the process.
 */
export async function warnIfAdJobSchemaDrift(): Promise<void> {
  try {
    const present = await getAdJobPgColumnNames()
    const missing = REQUIRED_AD_JOB_OPTIONAL_COLUMNS.filter(c => !present.has(c))
    if (missing.length > 0) {
      console.warn(
        `⚠️ [AdJob schema] Missing column(s): ${missing.join(", ")}. ` +
          `Usually unapplied migrations — from server/: npm run migrate:deploy. ` +
          `Until then, AdJob creates may use a degraded insert path (fallback).`
      )
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(
      `⚠️ [AdJob schema] Could not inspect AdJob columns (${msg}). ` +
        `Ensure DATABASE_URL is correct and migrations have been applied.`
    )
  }
}
