import { Router, Response } from "express"
import { z } from "zod"
import { prisma } from "../../lib/prisma"
import { requireAuth, AuthRequest } from "../auth/auth.middleware"
import {
  getWorkflowLimits,
  isAtWorkflowLimit,
} from "../plans/plan.constants"
import { resolveRequestId, toolFail, toolOk } from "../../lib/tool-response"

const router = Router()

const createSchema = z.object({
  name: z.string().min(1).max(120),
  niche: z.string().max(500).optional().default(""),
  targetAudience: z.string().max(500).optional().default(""),
  primaryPlatforms: z.array(z.string().max(48)).max(12).optional().default([]),
  contentGoals: z.array(z.string().max(80)).max(12).optional().default([]),
  defaultCtaStyle: z.string().max(200).optional().default(""),
})

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  niche: z.string().max(500).optional(),
  targetAudience: z.string().max(500).optional(),
  primaryPlatforms: z.array(z.string().max(48)).max(12).optional(),
  contentGoals: z.array(z.string().max(80)).max(12).optional(),
  defaultCtaStyle: z.string().max(200).optional(),
})

type WorkspaceUsageStats = {
  voiceCount: number
  contentPackCount: number
  generationCount: number
  adJobCount: number
  linkedTotal: number
  lastArtifactAt: Date | null
}

function maxDate(...dates: (Date | null | undefined)[]): Date | null {
  let best: Date | null = null
  for (const d of dates) {
    if (!d) continue
    if (!best || d > best) best = d
  }
  return best
}

function emptyUsage(): WorkspaceUsageStats {
  return {
    voiceCount: 0,
    contentPackCount: 0,
    generationCount: 0,
    adJobCount: 0,
    linkedTotal: 0,
    lastArtifactAt: null,
  }
}

async function loadWorkspaceUsageStats(
  userId: string,
  workspaceIds: string[]
): Promise<Map<string, WorkspaceUsageStats>> {
  const map = new Map<string, WorkspaceUsageStats>()
  for (const id of workspaceIds) map.set(id, emptyUsage())

  if (workspaceIds.length === 0) return map

  const scoped = { userId, workspaceId: { in: workspaceIds } }

  const [voiceRows, packRows, genRows, jobRows] = await Promise.all([
    prisma.brandVoice.groupBy({
      by: ["workspaceId"],
      where: scoped,
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    prisma.contentPack.groupBy({
      by: ["workspaceId"],
      where: scoped,
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    prisma.generation.groupBy({
      by: ["workspaceId"],
      where: scoped,
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.adJob.groupBy({
      by: ["workspaceId"],
      where: scoped,
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
  ])

  for (const row of voiceRows) {
    const id = row.workspaceId
    if (!id || !map.has(id)) continue
    const s = map.get(id)!
    s.voiceCount = row._count._all
    s.lastArtifactAt = maxDate(s.lastArtifactAt, row._max.updatedAt)
  }
  for (const row of packRows) {
    const id = row.workspaceId
    if (!id || !map.has(id)) continue
    const s = map.get(id)!
    s.contentPackCount = row._count._all
    s.lastArtifactAt = maxDate(s.lastArtifactAt, row._max.updatedAt)
  }
  for (const row of genRows) {
    const id = row.workspaceId
    if (!id || !map.has(id)) continue
    const s = map.get(id)!
    s.generationCount = row._count._all
    s.lastArtifactAt = maxDate(s.lastArtifactAt, row._max.createdAt)
  }
  for (const row of jobRows) {
    const id = row.workspaceId
    if (!id || !map.has(id)) continue
    const s = map.get(id)!
    s.adJobCount = row._count._all
    s.lastArtifactAt = maxDate(s.lastArtifactAt, row._max.updatedAt)
  }

  for (const id of workspaceIds) {
    const s = map.get(id)!
    s.linkedTotal =
      s.voiceCount + s.contentPackCount + s.generationCount + s.adJobCount
  }

  return map
}

function serializeWorkspace(
  w: {
    id: string
    name: string
    niche: string
    targetAudience: string
    primaryPlatforms: string[]
    contentGoals: string[]
    defaultCtaStyle: string
    createdAt: Date
    updatedAt: Date
  },
  usage: WorkspaceUsageStats
) {
  return {
    id: w.id,
    name: w.name,
    niche: w.niche,
    targetAudience: w.targetAudience,
    primaryPlatforms: w.primaryPlatforms,
    contentGoals: w.contentGoals,
    defaultCtaStyle: w.defaultCtaStyle,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
    usage: {
      voiceCount: usage.voiceCount,
      contentPackCount: usage.contentPackCount,
      generationCount: usage.generationCount,
      adJobCount: usage.adJobCount,
      linkedTotal: usage.linkedTotal,
      lastArtifactAt: usage.lastArtifactAt?.toISOString() ?? null,
    },
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
    const items = await prisma.workspace.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    })
    const ids = items.map((w) => w.id)
    const usageMap = await loadWorkspaceUsageStats(userId, ids)
    for (const w of items) {
      const s = usageMap.get(w.id)
      if (!s) continue
      s.lastArtifactAt = maxDate(s.lastArtifactAt, w.updatedAt)
    }
    const sorted = [...items].sort((a, b) => {
      const ua = usageMap.get(a.id) ?? emptyUsage()
      const ub = usageMap.get(b.id) ?? emptyUsage()
      const ta = ua.lastArtifactAt?.getTime() ?? 0
      const tb = ub.lastArtifactAt?.getTime() ?? 0
      if (tb !== ta) return tb - ta
      if (ub.linkedTotal !== ua.linkedTotal) return ub.linkedTotal - ua.linkedTotal
      return b.updatedAt.getTime() - a.updatedAt.getTime()
    })
    return toolOk(res, {
      requestId,
      stage: "finalize",
      workspaces: sorted.map((w) =>
        serializeWorkspace(w, usageMap.get(w.id) ?? emptyUsage())
      ),
      limits: {
        maxWorkspaces: limits.workspaces,
        maxBrandVoices: limits.brandVoices,
        maxContentPacks: limits.contentPacks,
      },
    })
  } catch (err) {
    console.error("WORKSPACES_LIST_ERROR", err)
    return toolFail(res, 500, "Failed to list workspaces", {
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
      stage: "validate",
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
    const count = await prisma.workspace.count({ where: { userId } })
    if (isAtWorkflowLimit(plan, "workspaces", count)) {
      const cap = getWorkflowLimits(plan).workspaces
      return toolFail(res, 403, `Workspace limit reached (${cap} on your plan).`, {
        requestId,
        stage: "validate",
        code: "FORBIDDEN",
        limit: cap,
      })
    }
    const w = await prisma.workspace.create({
      data: {
        userId,
        name: parsed.data.name.trim(),
        niche: parsed.data.niche.trim(),
        targetAudience: parsed.data.targetAudience.trim(),
        primaryPlatforms: parsed.data.primaryPlatforms.map((s) => s.trim()).filter(Boolean),
        contentGoals: parsed.data.contentGoals.map((s) => s.trim()).filter(Boolean),
        defaultCtaStyle: parsed.data.defaultCtaStyle.trim(),
      },
    })
    const usage = (await loadWorkspaceUsageStats(userId, [w.id])).get(w.id) ?? emptyUsage()
    usage.lastArtifactAt = maxDate(usage.lastArtifactAt, w.updatedAt)
    return toolOk(res, {
      requestId,
      stage: "finalize",
      workspace: serializeWorkspace(w, usage),
    })
  } catch (err) {
    console.error("WORKSPACE_CREATE_ERROR", err)
    return toolFail(res, 500, "Failed to create workspace", {
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
    const existing = await prisma.workspace.findFirst({
      where: { id, userId },
    })
    if (!existing) {
      return toolFail(res, 404, "Workspace not found", {
        requestId,
        code: "NOT_FOUND",
      })
    }
    const data = parsed.data
    const w = await prisma.workspace.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.niche !== undefined ? { niche: data.niche.trim() } : {}),
        ...(data.targetAudience !== undefined
          ? { targetAudience: data.targetAudience.trim() }
          : {}),
        ...(data.primaryPlatforms !== undefined
          ? {
              primaryPlatforms: data.primaryPlatforms
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {}),
        ...(data.contentGoals !== undefined
          ? {
              contentGoals: data.contentGoals
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {}),
        ...(data.defaultCtaStyle !== undefined
          ? { defaultCtaStyle: data.defaultCtaStyle.trim() }
          : {}),
      },
    })
    const usage = (await loadWorkspaceUsageStats(userId, [w.id])).get(w.id) ?? emptyUsage()
    usage.lastArtifactAt = maxDate(usage.lastArtifactAt, w.updatedAt)
    return toolOk(res, {
      requestId,
      stage: "finalize",
      workspace: serializeWorkspace(w, usage),
    })
  } catch (err) {
    console.error("WORKSPACE_PATCH_ERROR", err)
    return toolFail(res, 500, "Failed to update workspace", {
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
    const del = await prisma.workspace.deleteMany({ where: { id, userId } })
    if (del.count === 0) {
      return toolFail(res, 404, "Workspace not found", {
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
    console.error("WORKSPACE_DELETE_ERROR", err)
    return toolFail(res, 500, "Failed to delete workspace", {
      requestId,
      code: "INTERNAL_ERROR",
    })
  }
})

export default router
