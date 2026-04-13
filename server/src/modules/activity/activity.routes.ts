import { Router, Response } from "express"
import type { GenerationType } from "@prisma/client"
import { prisma } from "../../lib/prisma"
import { requireAuth, AuthRequest } from "../auth/auth.middleware"
import { resolveRequestId, toolFail, toolOk } from "../../lib/tool-response"
import {
  serializeActivityAdJob,
  serializeActivityContentPack,
  serializeActivityGeneration,
} from "./activity.serialization"

const router = Router()

function clampInt(value: unknown, fallback: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(max, Math.floor(n))
}

const GEN_TYPES: GenerationType[] = ["VIDEO", "STORY", "VIDEO_BLUEPRINT"]

function parseGenerationType(raw: unknown): GenerationType | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined
  const u = raw.toUpperCase() as GenerationType
  return GEN_TYPES.includes(u) ? u : undefined
}

function parseSections(raw: unknown): {
  generations: boolean
  adJobs: boolean
  contentPacks: boolean
} {
  if (typeof raw !== "string" || !raw.trim()) {
    return { generations: true, adJobs: true, contentPacks: true }
  }
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return {
    generations: parts.includes("generations"),
    adJobs: parts.includes("adjobs") || parts.includes("jobs"),
    contentPacks: parts.includes("contentpacks") || parts.includes("packs"),
  }
}

const generationInclude = {
  workspace: { select: { name: true } },
  brandVoice: { select: { id: true, name: true } },
  sourceContentPack: { select: { id: true, title: true } },
} as const

const adJobInclude = {
  workspace: { select: { name: true } },
  sourceContentPack: { select: { id: true, title: true } },
} as const

const contentPackInclude = {
  workspace: { select: { name: true } },
  brandVoice: { select: { id: true, name: true } },
} as const

/**
 * Recent server-side activity for the command center + library.
 * Does not return full Generation.output — input preview only.
 * Optional: workspaceId, generationType, sections (comma: generations,adJobs,contentPacks).
 */
router.get("/recent", requireAuth, async (req: AuthRequest, res: Response) => {
  const requestId = resolveRequestId(req)
  const userId = req.user?.id

  if (!userId) {
    return toolFail(res, 401, "Unauthorized", {
      requestId,
      stage: "validate",
      code: "UNAUTHORIZED",
    })
  }

  try {
    const genLimit = clampInt(req.query.generationsLimit, 24, 40)
    const jobLimit = clampInt(req.query.jobsLimit, 12, 24)
    const packLimit = clampInt(req.query.contentPacksLimit, 24, 40)

    const workspaceFilter =
      typeof req.query.workspaceId === "string" && req.query.workspaceId.trim().length >= 5
        ? req.query.workspaceId.trim()
        : undefined

    const generationType = parseGenerationType(req.query.generationType)
    const sections = parseSections(req.query.sections)

    const genWhere = {
      userId,
      ...(workspaceFilter ? { workspaceId: workspaceFilter } : {}),
      ...(generationType ? { type: generationType } : {}),
    }

    const jobWhere = {
      userId,
      ...(workspaceFilter ? { workspaceId: workspaceFilter } : {}),
    }

    const packWhere = {
      userId,
      ...(workspaceFilter ? { workspaceId: workspaceFilter } : {}),
    }

    const [generations, adJobs, contentPacks] = await Promise.all([
      sections.generations
        ? prisma.generation.findMany({
            where: genWhere,
            orderBy: { createdAt: "desc" },
            take: genLimit,
            select: {
              id: true,
              type: true,
              input: true,
              creditsUsed: true,
              durationMs: true,
              requestId: true,
              createdAt: true,
              modelUsed: true,
              workspaceId: true,
              brandVoiceId: true,
              sourceContentPackId: true,
              sourceGenerationId: true,
              sourceType: true,
              workspace: generationInclude.workspace,
              brandVoice: generationInclude.brandVoice,
              sourceContentPack: generationInclude.sourceContentPack,
            },
          })
        : Promise.resolve([]),
      sections.adJobs
        ? prisma.adJob.findMany({
            where: jobWhere,
            orderBy: { createdAt: "desc" },
            take: jobLimit,
            select: {
              id: true,
              jobId: true,
              status: true,
              progress: true,
              platform: true,
              duration: true,
              tone: true,
              outputUrl: true,
              failedReason: true,
              createdAt: true,
              updatedAt: true,
              workspaceId: true,
              sourceContentPackId: true,
              sourceGenerationId: true,
              sourceType: true,
              workspace: adJobInclude.workspace,
              sourceContentPack: adJobInclude.sourceContentPack,
            },
          })
        : Promise.resolve([]),
      sections.contentPacks
        ? prisma.contentPack.findMany({
            where: packWhere,
            orderBy: { createdAt: "desc" },
            take: packLimit,
            select: {
              id: true,
              title: true,
              topic: true,
              platform: true,
              audience: true,
              status: true,
              createdAt: true,
              updatedAt: true,
              workspaceId: true,
              brandVoiceId: true,
              workspace: contentPackInclude.workspace,
              brandVoice: contentPackInclude.brandVoice,
            },
          })
        : Promise.resolve([]),
    ])

    return toolOk(res, {
      requestId,
      stage: "finalize",
      generations: generations.map((g) => serializeActivityGeneration(g)),
      adJobs: adJobs.map((j) => serializeActivityAdJob(j)),
      contentPacks: contentPacks.map((p) => serializeActivityContentPack(p)),
    })
  } catch (err) {
    console.error("ACTIVITY_RECENT_ERROR", err)
    return toolFail(res, 500, "Failed to load activity", {
      requestId,
      stage: "failed",
      code: "INTERNAL_ERROR",
    })
  }
})

export default router
