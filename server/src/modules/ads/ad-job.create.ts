import type { Prisma } from "@prisma/client"

import { prisma } from "../../lib/prisma"

/** Prisma “column does not exist in the current database”. */
export function isPrismaP2022(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2022"
  )
}

/**
 * Removes optional creator/lineage FK columns from an unchecked create payload.
 * Used when the DB predates those migrations.
 */
export function stripAdJobOptionalLineageFields(
  data: Prisma.AdJobUncheckedCreateInput
): Prisma.AdJobUncheckedCreateInput {
  const {
    workspaceId: _w,
    sourceContentPackId: _sc,
    sourceGenerationId: _sg,
    sourceType: _st,
    ...rest
  } = data as Prisma.AdJobUncheckedCreateInput & {
    workspaceId?: string | null
    sourceContentPackId?: string | null
    sourceGenerationId?: string | null
    sourceType?: string | null
  }
  return rest
}

/**
 * Creates an AdJob row. If the database is missing newer columns (typically unapplied migrations),
 * the first insert may fail with P2022; we retry once **without** optional lineage columns:
 * workspaceId, sourceContentPackId, sourceGenerationId, sourceType.
 * That retry is a **temporary resilience** layer — the supported fix is `npm run migrate:deploy` from `server/`.
 * When the schema is up to date, behavior matches a plain `prisma.adJob.create`.
 *
 * Name retains “Workspace” for historical call sites; retry strips all four lineage fields above.
 */
export async function adJobCreateWithWorkspaceFallback(
  data: Prisma.AdJobUncheckedCreateInput
): Promise<{ id: string; jobId: string }> {
  try {
    return await prisma.adJob.create({
      data,
      select: { id: true, jobId: true },
    })
  } catch (e) {
    if (!isPrismaP2022(e)) throw e
    console.warn(
      "[ads] AdJob insert failed (P2022); retrying once without optional lineage columns " +
        "(workspaceId, sourceContentPackId, sourceGenerationId, sourceType). " +
        "Apply migrations: from server/ run npm run migrate:deploy."
    )
    return prisma.adJob.create({
      data: stripAdJobOptionalLineageFields(data),
      select: { id: true, jobId: true },
    })
  }
}
