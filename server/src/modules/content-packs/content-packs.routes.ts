import { Router, Response } from "express"
import { z } from "zod"
import { ContentPackStatus } from "@prisma/client"
import { prisma } from "../../lib/prisma"
import { requireAuth, AuthRequest } from "../auth/auth.middleware"
import { staffFloorPlan } from "../../lib/staff-plan"
import { evaluateBillingAccess } from "../billing/billing.access"
import {
  getWorkflowLimits,
  isAtWorkflowLimit,
} from "../plans/plan.constants"
import { resolveRequestId, toolFail, toolOk } from "../../lib/tool-response"
import { logToolEvent } from "../../lib/tool-logger"
import { openai, AI_MODELS } from "../../lib/openai"
import {
  classifyRetryableError,
  computeRetryDelay,
  sleepMs,
} from "../generation/generation.retry"
import {
  formatCreatorContextForPrompt,
  loadCreatorContextAttachments,
} from "../workflow/creator-context"

const router = Router()

const CONTENT_PACK_COST = 2
const COOLDOWN_MS = 3000
const MAX_RETRIES = 3
const OPENAI_TIMEOUT_MS = 90_000
const MODEL = AI_MODELS.SCRIPT

export const generateSchema = z.object({
  topic: z.string().min(3).max(500),
  platform: z.string().min(1).max(48),
  audience: z.string().max(200).optional().default(""),
  workspaceId: z.string().min(5).max(64).optional(),
  brandVoiceId: z.string().min(5).max(64).optional(),
})

const packPayloadSchema = z.object({
  hooks: z.array(z.string()).min(5).max(5),
  scripts: z.array(z.string()).min(3).max(3),
  titles: z.array(z.string()).min(3).max(3),
  captions: z.array(z.string()).min(3).max(3),
  ctas: z.array(z.string()).min(3).max(3),
  clipAngles: z.array(z.string()).min(3).max(3),
})

function serializePack(p: {
  id: string
  userId: string
  workspaceId: string | null
  brandVoiceId: string | null
  title: string
  topic: string
  platform: string
  audience: string
  payloadJson: unknown
  status: ContentPackStatus
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    brandVoiceId: p.brandVoiceId,
    title: p.title,
    topic: p.topic,
    platform: p.platform,
    audience: p.audience,
    payload: p.payloadJson,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("request_timeout")), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

router.post("/generate", requireAuth, async (req: AuthRequest, res: Response) => {
  const start = Date.now()
  const requestId = resolveRequestId(req)
  const userId = req.user?.id
  logToolEvent("info", {
    tool: "content-pack",
    requestId,
    userId,
    stage: "request",
    status: "start",
  })

  if (!userId) {
    return toolFail(res, 401, "Unauthorized", {
      requestId,
      code: "UNAUTHORIZED",
    })
  }

  const parsed = generateSchema.safeParse(req.body)
  if (!parsed.success) {
    return toolFail(res, 400, "Invalid input", {
      requestId,
      stage: "validate",
      code: "INVALID_INPUT",
      errors: parsed.error.flatten(),
    })
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      credits: true,
      plan: true,
      role: true,
      banned: true,
      subscriptionStatus: true,
      trialExpiresAt: true,
      stripeSubscriptionId: true,
    },
  })

  if (!user) {
    return toolFail(res, 404, "User not found", {
      requestId,
      code: "NOT_FOUND",
    })
  }

  const access = evaluateBillingAccess(user)
  if (access.allowed === false) {
    return toolFail(res, access.status, access.message, {
      requestId,
      code: "FORBIDDEN",
    })
  }

  if (user.credits < CONTENT_PACK_COST) {
    return toolFail(res, 403, "No credits remaining", {
      requestId,
      code: "FORBIDDEN",
    })
  }

  const packCount = await prisma.contentPack.count({ where: { userId } })
  const planTier = staffFloorPlan(user.plan, user.role)
  if (isAtWorkflowLimit(planTier, "contentPacks", packCount)) {
    const cap = getWorkflowLimits(planTier).contentPacks
    return toolFail(res, 403, `Content pack limit reached (${cap} saved on your plan).`, {
      requestId,
      code: "FORBIDDEN",
      limit: cap,
    })
  }

  const lastPack = await prisma.contentPack.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  })
  if (lastPack) {
    const diff = Date.now() - lastPack.createdAt.getTime()
    if (diff < COOLDOWN_MS) {
      return toolFail(res, 429, "Please wait before generating again.", {
        requestId,
        code: "RETRY_LATER",
        retryAfterMs: COOLDOWN_MS - diff,
      })
    }
  }

  const ctxLoad = await loadCreatorContextAttachments(prisma, userId, {
    workspaceId: parsed.data.workspaceId,
    brandVoiceId: parsed.data.brandVoiceId,
  })
  if (ctxLoad.ok === false) {
    const message =
      ctxLoad.code === "BRAND_VOICE_WORKSPACE_MISMATCH"
        ? "Brand voice does not belong to the selected workspace."
        : "Workspace or brand voice not found."
    return toolFail(res, 400, message, {
      requestId,
      code: "INVALID_INPUT",
    })
  }

  const creatorBlock = formatCreatorContextForPrompt(
    ctxLoad.workspace,
    ctxLoad.brandVoice
  )

  const topic = parsed.data.topic.trim()
  const platform = parsed.data.platform.trim()
  const audience = parsed.data.audience.trim()

  const userPrompt = `
Topic: "${topic}"
Primary platform: ${platform}
Audience: ${audience || "General short-form viewers"}

${creatorBlock ? `${creatorBlock}\n` : ""}

Return ONLY valid JSON with this exact shape:
{
  "hooks": [ /* exactly 5 strings, each a scroll-stopping spoken hook */ ],
  "scripts": [ /* exactly 3 strings: full short-form spoken scripts, newline-separated beats, max ~14 words per line */ ],
  "titles": [ /* exactly 3 strings */ ],
  "captions": [ /* exactly 3 platform-ready captions */ ],
  "ctas": [ /* exactly 3 specific CTAs */ ],
  "clipAngles": [ /* exactly 3 strings: how to cut or reframe this idea for vertical video */ ]
}
`.trim()

  let validated: z.infer<typeof packPayloadSchema> | null = null
  let attempt = 0
  let lastError: unknown = null

  while (!validated && attempt < MAX_RETRIES) {
    attempt++
    try {
      const completion = await withTimeout(
        openai.chat.completions.create({
          model: MODEL,
          temperature: 0.85,
          max_tokens: 4500,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `You are a short-form content strategist for TikTok, Reels, Shorts, and X video.
Output ONLY JSON. Arrays must have the exact lengths requested. No markdown.`,
            },
            { role: "user", content: userPrompt },
          ],
        }),
        OPENAI_TIMEOUT_MS
      )
      const content = completion.choices[0]?.message?.content
      if (!content) throw new Error("MODEL_OUTPUT_INVALID")
      const json = JSON.parse(content)
      const v = packPayloadSchema.safeParse(json)
      if (!v.success) throw new Error("MODEL_OUTPUT_INVALID")
      validated = v.data
    } catch (error) {
      lastError = error
      const retryDecision = classifyRetryableError(error)
      logToolEvent("warn", {
        tool: "content-pack",
        requestId,
        userId,
        stage: "rank",
        attempt,
        retriable: retryDecision.retriable && attempt < MAX_RETRIES,
      })
      if (!retryDecision.retriable || attempt >= MAX_RETRIES) break
      const delay = computeRetryDelay(attempt)
      await sleepMs(delay.delayMs)
    }
  }

  if (!validated) {
    return toolFail(res, 502, "AI response invalid", {
      requestId,
      stage: "rank",
      code: "AI_INVALID",
      message: lastError instanceof Error ? lastError.message : "pack_failed",
    })
  }

  const titleBase = topic.length > 56 ? `${topic.slice(0, 53)}…` : topic
  const title = `Pack: ${titleBase}`

  try {
    const pack = await prisma.$transaction(async (tx) => {
      const debit = await tx.user.updateMany({
        where: { id: userId, credits: { gte: CONTENT_PACK_COST } },
        data: {
          credits: { decrement: CONTENT_PACK_COST },
          totalGenerations: { increment: 1 },
        },
      })
      if (debit.count === 0) {
        throw new Error("INSUFFICIENT_CREDITS")
      }
      await tx.creditTransaction.create({
        data: {
          userId,
          amount: -CONTENT_PACK_COST,
          type: "CREDIT_USE",
          reason: "Content pack generation",
          requestId,
        },
      })
      return tx.contentPack.create({
        data: {
          userId,
          workspaceId: ctxLoad.workspace?.id ?? null,
          brandVoiceId: ctxLoad.brandVoice?.id ?? null,
          title,
          topic,
          platform,
          audience,
          payloadJson: validated as object,
          status: ContentPackStatus.READY,
        },
      })
    })

    logToolEvent("info", {
      tool: "content-pack",
      requestId,
      userId,
      stage: "finalize",
      status: "completed",
      elapsedMs: Date.now() - start,
    })

    return toolOk(res, {
      requestId,
      stage: "finalize",
      creditsUsed: CONTENT_PACK_COST,
      durationMs: Date.now() - start,
      contentPack: serializePack(pack),
    })
  } catch (err) {
    if (err instanceof Error && err.message === "INSUFFICIENT_CREDITS") {
      return toolFail(res, 403, "No credits remaining", {
        requestId,
        code: "FORBIDDEN",
      })
    }
    console.error("CONTENT_PACK_PERSIST_ERROR", err)
    return toolFail(res, 500, "Failed to save content pack", {
      requestId,
      code: "INTERNAL_ERROR",
    })
  }
})

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
    const items = await prisma.contentPack.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
    return toolOk(res, {
      requestId,
      stage: "finalize",
      contentPacks: items.map(serializePack),
      limits: {
        maxWorkspaces: limits.workspaces,
        maxBrandVoices: limits.brandVoices,
        maxContentPacks: limits.contentPacks,
      },
    })
  } catch (err) {
    console.error("CONTENT_PACKS_LIST_ERROR", err)
    return toolFail(res, 500, "Failed to list content packs", {
      requestId,
      code: "INTERNAL_ERROR",
    })
  }
})

router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
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
    const pack = await prisma.contentPack.findFirst({
      where: { id, userId },
    })
    if (!pack) {
      return toolFail(res, 404, "Content pack not found", {
        requestId,
        code: "NOT_FOUND",
      })
    }
    return toolOk(res, {
      requestId,
      stage: "finalize",
      contentPack: serializePack(pack),
    })
  } catch (err) {
    console.error("CONTENT_PACK_GET_ERROR", err)
    return toolFail(res, 500, "Failed to load content pack", {
      requestId,
      code: "INTERNAL_ERROR",
    })
  }
})

export default router
