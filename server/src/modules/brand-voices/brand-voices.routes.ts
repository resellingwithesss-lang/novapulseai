import { Router, Response } from "express"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "../../lib/prisma"
import { requireAuth, AuthRequest } from "../auth/auth.middleware"
import {
  getWorkflowLimits,
  isAtWorkflowLimit,
} from "../plans/plan.constants"
import { resolveRequestId, toolFail, toolOk } from "../../lib/tool-response"

const router = Router()

const bannedSchema = z.union([
  z.array(z.string().max(200)).max(40),
  z.string().max(4000),
])

function normalizeBannedPhrases(raw: z.infer<typeof bannedSchema>): unknown {
  if (Array.isArray(raw)) return raw.map((s) => s.trim()).filter(Boolean)
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40)
}

const createSchema = z.object({
  workspaceId: z.string().min(5).max(64).optional(),
  name: z.string().min(1).max(120),
  tone: z.string().max(200).optional().default(""),
  pacing: z.string().max(200).optional().default(""),
  slangLevel: z.string().max(120).optional().default(""),
  ctaStyle: z.string().max(200).optional().default(""),
  bannedPhrases: bannedSchema.optional(),
  audienceSophistication: z.string().max(200).optional().default(""),
  notes: z.string().max(4000).optional().default(""),
})

const patchSchema = createSchema.partial().extend({
  name: z.string().min(1).max(120).optional(),
})

function serializeBrandVoice(b: {
  id: string
  userId: string
  workspaceId: string | null
  name: string
  tone: string
  pacing: string
  slangLevel: string
  ctaStyle: string
  bannedPhrases: unknown
  audienceSophistication: string
  notes: string
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: b.id,
    workspaceId: b.workspaceId,
    name: b.name,
    tone: b.tone,
    pacing: b.pacing,
    slangLevel: b.slangLevel,
    ctaStyle: b.ctaStyle,
    bannedPhrases: b.bannedPhrases,
    audienceSophistication: b.audienceSophistication,
    notes: b.notes,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }
}

router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const requestId = resolveRequestId(req)
  const userId = req.user?.id
  if (!userId) {
    return toolFail(res, 401, "Unauthorized", {
      requestId,
      code: "UNAUTHORIZED",
    })
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    })
    const plan = user?.plan ?? "FREE"
    const limits = getWorkflowLimits(plan)
    const items = await prisma.brandVoice.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    })
    return toolOk(res, {
      requestId,
      stage: "finalize",
      brandVoices: items.map(serializeBrandVoice),
      limits: {
        maxWorkspaces: limits.workspaces,
        maxBrandVoices: limits.brandVoices,
        maxContentPacks: limits.contentPacks,
      },
    })
  } catch (err) {
    console.error("BRAND_VOICES_LIST_ERROR", err)
    return toolFail(res, 500, "Failed to list brand voices", {
      requestId,
      code: "INTERNAL_ERROR",
    })
  }
})

router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const requestId = resolveRequestId(req)
  const userId = req.user?.id
  if (!userId) {
    return toolFail(res, 401, "Unauthorized", {
      requestId,
      code: "UNAUTHORIZED",
    })
  }
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    return toolFail(res, 400, "Invalid input", {
      requestId,
      code: "INVALID_INPUT",
      errors: parsed.error.flatten(),
    })
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    })
    const plan = user?.plan ?? "FREE"
    const count = await prisma.brandVoice.count({ where: { userId } })
    if (isAtWorkflowLimit(plan, "brandVoices", count)) {
      const cap = getWorkflowLimits(plan).brandVoices
      return toolFail(res, 403, `Brand voice limit reached (${cap} on your plan).`, {
        requestId,
        code: "FORBIDDEN",
        limit: cap,
      })
    }

    if (parsed.data.workspaceId) {
      const ws = await prisma.workspace.findFirst({
        where: { id: parsed.data.workspaceId, userId },
      })
      if (!ws) {
        return toolFail(res, 400, "Invalid workspace", {
          requestId,
          code: "INVALID_INPUT",
        })
      }
    }

    const banned = normalizeBannedPhrases(parsed.data.bannedPhrases ?? [])

    const b = await prisma.brandVoice.create({
      data: {
        userId,
        workspaceId: parsed.data.workspaceId ?? null,
        name: parsed.data.name.trim(),
        tone: parsed.data.tone.trim(),
        pacing: parsed.data.pacing.trim(),
        slangLevel: parsed.data.slangLevel.trim(),
        ctaStyle: parsed.data.ctaStyle.trim(),
        bannedPhrases: banned as Prisma.InputJsonValue,
        audienceSophistication: parsed.data.audienceSophistication.trim(),
        notes: parsed.data.notes.trim(),
      },
    })
    return toolOk(res, {
      requestId,
      stage: "finalize",
      brandVoice: serializeBrandVoice(b),
    })
  } catch (err) {
    console.error("BRAND_VOICE_CREATE_ERROR", err)
    return toolFail(res, 500, "Failed to create brand voice", {
      requestId,
      code: "INTERNAL_ERROR",
    })
  }
})

router.patch("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const requestId = resolveRequestId(req)
  const userId = req.user?.id
  const id = req.params.id
  if (!userId) {
    return toolFail(res, 401, "Unauthorized", {
      requestId,
      code: "UNAUTHORIZED",
    })
  }
  const parsed = patchSchema.safeParse(req.body)
  if (!parsed.success) {
    return toolFail(res, 400, "Invalid input", {
      requestId,
      code: "INVALID_INPUT",
      errors: parsed.error.flatten(),
    })
  }
  try {
    const existing = await prisma.brandVoice.findFirst({
      where: { id, userId },
    })
    if (!existing) {
      return toolFail(res, 404, "Brand voice not found", {
        requestId,
        code: "NOT_FOUND",
      })
    }

    const data = parsed.data
    if (data.workspaceId !== undefined && data.workspaceId !== null) {
      const ws = await prisma.workspace.findFirst({
        where: { id: data.workspaceId, userId },
      })
      if (!ws) {
        return toolFail(res, 400, "Invalid workspace", {
          requestId,
          code: "INVALID_INPUT",
        })
      }
    }

    const updateData: Record<string, unknown> = {}
    if (data.name !== undefined) updateData.name = data.name.trim()
    if (data.tone !== undefined) updateData.tone = data.tone.trim()
    if (data.pacing !== undefined) updateData.pacing = data.pacing.trim()
    if (data.slangLevel !== undefined) updateData.slangLevel = data.slangLevel.trim()
    if (data.ctaStyle !== undefined) updateData.ctaStyle = data.ctaStyle.trim()
    if (data.audienceSophistication !== undefined) {
      updateData.audienceSophistication = data.audienceSophistication.trim()
    }
    if (data.notes !== undefined) updateData.notes = data.notes.trim()
    if (data.workspaceId !== undefined) {
      updateData.workspaceId = data.workspaceId ?? null
    }
    if (data.bannedPhrases !== undefined) {
      updateData.bannedPhrases = normalizeBannedPhrases(data.bannedPhrases)
    }

    const b = await prisma.brandVoice.update({
      where: { id },
      data: updateData as Prisma.BrandVoiceUpdateInput,
    })
    return toolOk(res, {
      requestId,
      stage: "finalize",
      brandVoice: serializeBrandVoice(b),
    })
  } catch (err) {
    console.error("BRAND_VOICE_PATCH_ERROR", err)
    return toolFail(res, 500, "Failed to update brand voice", {
      requestId,
      code: "INTERNAL_ERROR",
    })
  }
})

router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const requestId = resolveRequestId(req)
  const userId = req.user?.id
  const id = req.params.id
  if (!userId) {
    return toolFail(res, 401, "Unauthorized", {
      requestId,
      code: "UNAUTHORIZED",
    })
  }
  try {
    const del = await prisma.brandVoice.deleteMany({ where: { id, userId } })
    if (del.count === 0) {
      return toolFail(res, 404, "Brand voice not found", {
        requestId,
        code: "NOT_FOUND",
      })
    }
    return toolOk(res, {
      requestId,
      stage: "finalize",
      deleted: true,
    })
  } catch (err) {
    console.error("BRAND_VOICE_DELETE_ERROR", err)
    return toolFail(res, 500, "Failed to delete brand voice", {
      requestId,
      code: "INTERNAL_ERROR",
    })
  }
})

export default router
