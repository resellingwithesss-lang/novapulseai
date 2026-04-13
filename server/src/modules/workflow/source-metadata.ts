import type { PrismaClient } from "@prisma/client"

export type SourceRefValidation = { ok: true } | { ok: false; message: string }

/**
 * Ensures optional lineage IDs belong to the same user (no cross-tenant refs).
 */
export async function validateGenerationSourceRefs(
  prisma: PrismaClient,
  userId: string,
  opts: {
    sourceContentPackId?: string | null
    sourceGenerationId?: string | null
  }
): Promise<SourceRefValidation> {
  if (opts.sourceContentPackId) {
    const p = await prisma.contentPack.findFirst({
      where: { id: opts.sourceContentPackId, userId },
      select: { id: true },
    })
    if (!p) return { ok: false, message: "Invalid content pack reference" }
  }
  if (opts.sourceGenerationId) {
    const g = await prisma.generation.findFirst({
      where: { id: opts.sourceGenerationId, userId },
      select: { id: true },
    })
    if (!g) return { ok: false, message: "Invalid generation reference" }
  }
  return { ok: true }
}

export async function validateAdJobSourceRefs(
  prisma: PrismaClient,
  userId: string,
  opts: {
    sourceContentPackId?: string | null
    sourceGenerationId?: string | null
  }
): Promise<SourceRefValidation> {
  if (opts.sourceContentPackId) {
    const p = await prisma.contentPack.findFirst({
      where: { id: opts.sourceContentPackId, userId },
      select: { id: true },
    })
    if (!p) return { ok: false, message: "Invalid content pack reference" }
  }
  if (opts.sourceGenerationId) {
    const g = await prisma.generation.findFirst({
      where: { id: opts.sourceGenerationId, userId },
      select: { id: true },
    })
    if (!g) return { ok: false, message: "Invalid generation reference" }
  }
  return { ok: true }
}
