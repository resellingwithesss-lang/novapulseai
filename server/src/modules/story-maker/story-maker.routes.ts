import { Router, Response } from "express"
import { prisma } from "../../lib/prisma"
import { requireAuth, AuthRequest } from "../auth/auth.middleware"
import { z } from "zod"
import { GenerationType } from "@prisma/client"
import { evaluateBillingAccess } from "../billing/billing.access"
import { resolveRequestId, toolFail, toolOk } from "../../lib/tool-response"
import { logToolEvent } from "../../lib/tool-logger"
import {
  classifyRetryableError,
  computeRetryDelay,
  sleepMs,
} from "../generation/generation.retry"
import { openai, AI_MODELS } from "../../lib/openai"
import {
  formatCreatorContextForPrompt,
  loadCreatorContextAttachments,
} from "../workflow/creator-context"
import { validateGenerationSourceRefs } from "../workflow/source-metadata"
import { chargeCredits, CreditError, CREDIT_REASON } from "../../lib/credits"

const router = Router()

/* =====================================================
   CONFIG
===================================================== */

const STORY_COST = 1
const MAX_TOPIC_LENGTH = 420
const COOLDOWN_MS = 3000
const MAX_OUTPUT_LENGTH = 28000
const MAX_RETRIES = 3
const MODEL = AI_MODELS.SCRIPT
const OPENAI_TIMEOUT_MS = 75_000

/* =====================================================
   VALIDATION
===================================================== */

const requestSchema = z.object({
  topic: z.string().min(3).max(MAX_TOPIC_LENGTH),
  format: z.string().optional(),
  intensity: z.coerce.number().min(1).max(10).optional(),
  ending: z.string().optional(),
  workspaceId: z.string().min(5).max(64).optional(),
  brandVoiceId: z.string().min(5).max(64).optional(),
  sourceContentPackId: z.string().min(5).max(64).optional(),
  sourceGenerationId: z.string().min(5).max(64).optional(),
  sourceType: z.enum(["CONTENT_PACK", "GENERATION", "MANUAL"]).optional(),
})

function optionalCreatorsField(max: number) {
  return z
    .union([z.string().max(max), z.null()])
    .optional()
    .transform((v) => (v == null || v === "" ? undefined : v))
}

const responseSchema = z.object({
  title: z.string().min(3),
  hook: z.string().min(5),
  script: z.string().min(60),
  caption: z.string().min(5),
  hashtags: z.array(z.string()).min(1),
  retentionBreakdown: z.object({
    hookType: z.string(),
    escalationMoments: z.string(),
    emotionalSpike: z.string(),
    endingMechanism: z.string(),
  }),
  pinComment: optionalCreatorsField(280),
  productionNotes: optionalCreatorsField(2000),
})

/* =====================================================
   UTILITIES
===================================================== */

function sanitize(input: string) {
  return input.trim().replace(/\s+/g, " ")
}

function normalizeHashtags(tags: string[]) {
  return tags
    .slice(0, 12)
    .map((t) =>
      t.startsWith("#") ? t : `#${t.replace(/\s+/g, "")}`
    )
}

function enforceSubtitleRhythm(script: string) {
  return script
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line.split(" ").length > 14
        ? line.split(" ").slice(0, 14).join(" ")
        : line
    )
    .join("\n")
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("request_timeout"))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/* =====================================================
   ROUTE
===================================================== */

router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const start = Date.now()
  const requestId = resolveRequestId(req)
  const userId = req.user?.id
  logToolEvent("info", {
    tool: "story-maker",
    requestId,
    userId,
    stage: "request",
    status: "start",
  })

  try {
    const parsed = requestSchema.safeParse(req.body)
    if (!parsed.success) {
      return toolFail(res, 400, "Invalid input", {
        requestId,
        stage: "validate",
        status: "failed",
        code: "INVALID_INPUT",
        errors: parsed.error.flatten(),
      })
    }

    const {
      topic,
      format = "Reddit Confession",
      intensity = 8,
      ending = "CLIFFHANGER",
    } = parsed.data

    const endingHint =
      ending === "CLIFFHANGER"
        ? "End on an unresolved tension or question that forces comments."
        : ending === "TWIST"
          ? "Deliver a sharp twist in the final beats; recontextualize earlier details."
          : ending === "FULL_CIRCLE"
            ? "Tie back to the opening image or line with emotional payoff."
            : ending === "CALLBACK"
              ? "Use a verbal or situational callback to the hook for satisfying closure."
              : `Ending preference: ${ending}.`

    if (!userId) {
      return toolFail(res, 401, "Unauthorized", {
        requestId,
        stage: "validate",
        status: "failed",
        code: "UNAUTHORIZED",
      })
    }

    const sourceRefCheck = await validateGenerationSourceRefs(prisma, userId, {
      sourceContentPackId: parsed.data.sourceContentPackId,
      sourceGenerationId: parsed.data.sourceGenerationId,
    })
    if (sourceRefCheck.ok === false) {
      return toolFail(res, 400, sourceRefCheck.message, {
        requestId,
        stage: "validate",
        status: "failed",
        code: "INVALID_INPUT",
      })
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        credits: true,
        banned: true,
        plan: true,
        subscriptionStatus: true,
        trialExpiresAt: true,
        stripeSubscriptionId: true,
      },
    })

    if (!user) {
      return toolFail(res, 404, "User not found", {
        requestId,
        stage: "validate",
        status: "failed",
        code: "NOT_FOUND",
      })
    }
    const access = evaluateBillingAccess(user, { minPlan: "PRO" })
    if (access.allowed === false) {
      return toolFail(res, access.status, access.message, {
        requestId,
        stage: "validate",
        status: "failed",
        code: "FORBIDDEN",
      })
    }

    const isUnlimited = false
    if (!isUnlimited && user.credits < STORY_COST) {
      return toolFail(res, 403, "No credits remaining", {
        requestId,
        stage: "validate",
        status: "failed",
        code: "FORBIDDEN",
      })
    }

    /* ===============================
       COOLDOWN
    =============================== */

    const lastGen = await prisma.generation.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    })

    if (lastGen) {
      const diff = Date.now() - lastGen.createdAt.getTime()
      if (diff < COOLDOWN_MS) {
        return toolFail(res, 429, "Please wait before generating again.", {
          requestId,
          stage: "rank",
          status: "failed",
          code: "RETRY_LATER",
          progress: 0,
          retryAfterMs: COOLDOWN_MS - diff,
        })
      }
    }

    const cleanTopic = sanitize(topic)

    let workspaceIdForRow: string | null = null
    let brandVoiceIdForRow: string | null = null
    let creatorAddon = ""
    if (parsed.data.workspaceId || parsed.data.brandVoiceId) {
      const loaded = await loadCreatorContextAttachments(prisma, userId, {
        workspaceId: parsed.data.workspaceId,
        brandVoiceId: parsed.data.brandVoiceId,
      })
      if (loaded.ok === false) {
        return toolFail(
          res,
          400,
          loaded.code === "BRAND_VOICE_WORKSPACE_MISMATCH"
            ? "Brand voice does not match the selected workspace."
            : "Invalid workspace or brand voice.",
          {
            requestId,
            stage: "validate",
            status: "failed",
            code: "INVALID_INPUT",
          }
        )
      }
      workspaceIdForRow = loaded.workspace?.id ?? null
      brandVoiceIdForRow = loaded.brandVoice?.id ?? null
      creatorAddon = formatCreatorContextForPrompt(
        loaded.workspace,
        loaded.brandVoice
      )
    }

    /* ===============================
       AI GENERATION
    =============================== */

    let story: z.infer<typeof responseSchema> | null = null
    let attempt = 0
    let lastError: unknown = null

    while (!story && attempt < MAX_RETRIES) {
      attempt++
      try {
        const completion = await withTimeout(
          openai.chat.completions.create({
            model: MODEL,
            temperature: 0.75 + intensity / 25,
            max_tokens: 3200,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: `You are a senior narrative engineer for short-form (TikTok / Reels / Shorts). You write tight, speakable copy with clear beats — no filler, no stage directions in the main "script" field except line breaks between spoken beats.

Return ONLY valid JSON matching the user schema. Optional keys pinComment and productionNotes help the creator: pinComment = one line optimized to pin as the first comment; productionNotes = b-roll ideas, sound design, or cut suggestions (plain text).`,
              },
              {
                role: "user",
                content: `
Topic / premise: "${cleanTopic}"
${creatorAddon ? `\n${creatorAddon}\n` : ""}

Story format: ${format}
Pacing intensity: ${intensity}/10 (higher = faster cuts, more hooks, sharper turns)
${endingHint}

Requirements:
- "hook" is the first 1–2 spoken lines only (scroll-stopping).
- "script" is the full spoken narrative as short paragraphs or one line per beat (newline separated); max ~14 words per line for on-screen captions.
- "caption" is platform-ready (no thread walls of text).
- "hashtags": 6–12 relevant tags without spam.
- retentionBreakdown: concrete, not generic (name specific beats).

JSON:
{
  "title": "",
  "hook": "",
  "script": "",
  "caption": "",
  "hashtags": [],
  "retentionBreakdown": {
    "hookType": "",
    "escalationMoments": "",
    "emotionalSpike": "",
    "endingMechanism": ""
  },
  "pinComment": "",
  "productionNotes": ""
}
              `,
              },
            ],
          }),
          OPENAI_TIMEOUT_MS
        )

        const content = completion.choices[0]?.message?.content
        if (!content || content.length > MAX_OUTPUT_LENGTH) {
          throw new Error("MODEL_OUTPUT_INVALID")
        }

        const rawStory = JSON.parse(content)
        const validated = responseSchema.safeParse(rawStory)
        if (!validated.success) {
          throw new Error("MODEL_OUTPUT_INVALID")
        }
        story = validated.data
      } catch (error) {
        lastError = error
        const retryDecision = classifyRetryableError(error)
        logToolEvent("warn", {
          tool: "story-maker",
          requestId,
          userId,
          stage: "rank",
          status: "attempt_failed",
          attempt,
          retriable: retryDecision.retriable && attempt < MAX_RETRIES,
          message: error instanceof Error ? error.message : "unknown_error",
        })
        if (!retryDecision.retriable || attempt >= MAX_RETRIES) {
          break
        }
        const delay = computeRetryDelay(attempt)
        await sleepMs(delay.delayMs)
      }
    }

    if (!story) {
      const lastMessage =
        lastError instanceof Error ? lastError.message : "story_generation_failed"
      return toolFail(res, 502, "AI response invalid", {
        requestId,
        stage: "rank",
        status: "failed",
        progress: 72,
        message: lastMessage,
        code: lastMessage === "request_timeout" ? "TIMEOUT" : "AI_INVALID",
      })
    }

    if (!story.script || !Array.isArray(story.hashtags)) {
      return toolFail(res, 502, "Story output incomplete", {
        requestId,
        stage: "finalize",
        status: "failed",
        progress: 90,
        code: "PARTIAL_RESULT",
        recovery: "retry_generation",
      })
    }

    story.script = enforceSubtitleRhythm(story.script)
    story.hashtags = normalizeHashtags(story.hashtags)

    /* ===============================
       SAVE (FIXED ENUM)
    =============================== */

    await prisma.$transaction(async (tx) => {
      if (!isUnlimited) {
        try {
          await chargeCredits({
            tx,
            userId,
            amount: STORY_COST,
            reason: CREDIT_REASON.GENERATION_STORY,
            requestId,
          })
        } catch (err) {
          if (err instanceof CreditError && err.code === "INSUFFICIENT_CREDITS") {
            throw new Error("INSUFFICIENT_CREDITS")
          }
          throw err
        }
        // `chargeCredits` handled the credit debit, ledger row, and
        // lifetimeCreditsUsed increment. Still bump `totalGenerations` in a
        // dedicated write so paid and unlimited paths stay parallel.
        await tx.user.update({
          where: { id: userId },
          data: { totalGenerations: { increment: 1 } },
        })
      } else {
        await tx.user.update({
          where: { id: userId },
          data: { totalGenerations: { increment: 1 } },
        })
      }

      await tx.generation.create({
        data: {
          userId,
          type: GenerationType.STORY, // ✅ FIXED
          input: cleanTopic,
          output: JSON.stringify(story),
          creditsUsed: isUnlimited ? 0 : STORY_COST,
          durationMs: Date.now() - start,
          modelUsed: MODEL,
          ...(workspaceIdForRow ? { workspaceId: workspaceIdForRow } : {}),
          ...(brandVoiceIdForRow ? { brandVoiceId: brandVoiceIdForRow } : {}),
          ...(parsed.data.sourceContentPackId
            ? { sourceContentPackId: parsed.data.sourceContentPackId }
            : {}),
          ...(parsed.data.sourceGenerationId
            ? { sourceGenerationId: parsed.data.sourceGenerationId }
            : {}),
          ...(parsed.data.sourceType ? { sourceType: parsed.data.sourceType } : {}),
        },
      })
    })

    logToolEvent("info", {
      tool: "story-maker",
      requestId,
      userId,
      stage: "finalize",
      status: "completed",
      elapsedMs: Date.now() - start,
    })
    return toolOk(res, {
      requestId,
      stage: "finalize",
      result: story,
      output: story,
      durationMs: Date.now() - start,
      qualitySignals: deriveStoryQualitySignals(story),
    })
  } catch (err) {
    if (err instanceof Error && err.message === "INSUFFICIENT_CREDITS") {
      return toolFail(res, 403, "No credits remaining", {
        requestId,
        stage: "finalize",
        status: "failed",
        code: "FORBIDDEN",
      })
    }
    logToolEvent("error", {
      tool: "story-maker",
      requestId,
      userId,
      stage: "failed",
      status: "failed",
      elapsedMs: Date.now() - start,
      message: err instanceof Error ? err.message : "Story generation failed",
    })
    return toolFail(res, 500, "Story generation failed", {
      requestId,
      stage: "failed",
      status: "failed",
      code: "INTERNAL_ERROR",
    })
  }
})

function deriveStoryQualitySignals(story: {
  hook?: string
  script?: string
  pinComment?: string
  productionNotes?: string
  retentionBreakdown?: Record<string, unknown>
}) {
  const signals: string[] = []
  if ((story.hook ?? "").length >= 18) signals.push("strong_hook")
  if ((story.script ?? "").split("\n").length >= 6) signals.push("paced_structure")
  if (story.retentionBreakdown?.emotionalSpike) signals.push("emotional_spike")
  if ((story.pinComment ?? "").length >= 12) signals.push("pin_comment_ready")
  if ((story.productionNotes ?? "").length >= 40) signals.push("production_blueprint")
  if (signals.length === 0) signals.push("balanced_story")
  return signals
}

export default router