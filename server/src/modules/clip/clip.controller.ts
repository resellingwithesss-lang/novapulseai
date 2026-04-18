import { mkdir, rename, unlink } from "fs/promises"
import path from "path"
import { Request, Response } from "express"
import { z } from "zod"
import type {
  ClipPlatform,
  ClipSourceType,
  ClipSubtitleStyle,
} from "./types/clip.types"
import type { AuthRequest } from "../auth/auth.middleware"
import { prisma } from "../../lib/prisma"
import { evaluateBillingAccess } from "../billing/billing.access"
import { resolveRequestId, toolFail, toolOk } from "../../lib/tool-response"
import { logToolEvent } from "../../lib/tool-logger"
import type { ClipJobRecord } from "./clip.job.types"
import { loadJob, saveJob, toPublicJobView } from "./clip.job.store"
import { createJobId, scheduleClipJob } from "./clip.job.processor"
import { validateUploadedVideoMagicBytes } from "./clip.upload-validate"
import {
  validateYoutubeUrl,
  youtubeUrlRejectionMessage,
} from "../../lib/youtube-url"

interface MulterRequest extends Request, AuthRequest {
  file?: Express.Multer.File
}

const clipPlatforms: [ClipPlatform, ClipPlatform, ClipPlatform] = [
  "tiktok",
  "instagram",
  "youtube",
]
const subtitleStyles: [
  ClipSubtitleStyle,
  ClipSubtitleStyle,
  ClipSubtitleStyle,
  ClipSubtitleStyle
] = ["clean", "bold", "viral", "minimal"]

const emptyToUndefined = (v: unknown) =>
  v === "" || v === null || v === undefined ? undefined : v

const boolish = z.preprocess((v) => {
  if (v === undefined || v === null || v === "") return true
  if (v === true || v === "true" || v === "on" || v === "1") return true
  if (v === false || v === "false" || v === "off" || v === "0") return false
  return true
}, z.boolean())

function resolveTargetClipDurationSec(
  preset: "15" | "30" | "45" | "60" | "custom",
  customSec?: number
): number {
  if (preset === "custom" && customSec !== undefined && Number.isFinite(customSec)) {
    return Math.min(120, Math.max(5, Math.round(customSec)))
  }
  const map: Record<string, number> = {
    "15": 15,
    "30": 30,
    "45": 45,
    "60": 60,
  }
  return map[preset] ?? 30
}

const clipRequestSchema = z
  .object({
    youtubeUrl: z.preprocess(
      emptyToUndefined,
      // Single step: validate, surface a reason-specific message, and emit the
      // normalized absolute URL (scheme prepended when missing) so the job
      // store, yt-dlp, and the SSRF guard in `downloadYoutubeVideo` always see
      // a well-formed value. Allowlist + message strings live in
      // `server/src/lib/youtube-url.ts` (source of truth).
      z
        .string()
        .transform((v, ctx) => {
          const result = validateYoutubeUrl(v)
          if (!result.ok) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: youtubeUrlRejectionMessage(result),
            })
            return z.NEVER
          }
          return result.url
        })
        .optional()
    ),
    clips: z.coerce.number().int().min(1).max(20).default(5),
    platform: z.enum(clipPlatforms).default("tiktok"),
    subtitleStyle: z.enum(subtitleStyles).default("clean"),
    clipLengthPreset: z
      .enum(["15", "30", "45", "60", "custom"])
      .default("30"),
    customClipLengthSec: z.preprocess(emptyToUndefined, z.coerce.number().optional()),
    captionsEnabled: boolish.default(true),
    captionMode: z.enum(["burn", "srt", "both"]).default("both"),
  })
  .refine(
    (data) =>
      data.clipLengthPreset !== "custom" ||
      (data.customClipLengthSec !== undefined &&
        Number.isFinite(data.customClipLengthSec)),
    { message: "Custom clip length required (5–120s)", path: ["customClipLengthSec"] }
  )

/** Multipart: enqueue clip job and return jobId immediately (HTTP 202). */
export const createClipJob = async (req: MulterRequest, res: Response) => {
  const requestId = resolveRequestId(req)

  logToolEvent("info", {
    tool: "clip",
    requestId,
    stage: "enqueue",
    status: "start",
  })

  try {
    const userId = req.user?.id
    if (!userId) {
      return toolFail(res, 401, "Unauthorized", {
        requestId,
        stage: "validate",
        status: "failed",
        code: "UNAUTHORIZED",
      })
    }

    const billingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        plan: true,
        subscriptionStatus: true,
        trialExpiresAt: true,
        stripeSubscriptionId: true,
        banned: true,
      },
    })

    if (!billingUser) {
      return toolFail(res, 404, "User not found", {
        requestId,
        code: "NOT_FOUND",
      })
    }

    const access = evaluateBillingAccess(billingUser, {
      minPlan: "STARTER",
    })
    if (access.allowed === false) {
      return toolFail(res, access.status, access.message, {
        requestId,
        code: "FORBIDDEN",
      })
    }

    const parsed = clipRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return toolFail(res, 400, "Invalid clip request payload", {
        requestId,
        stage: "validate",
        status: "failed",
        code: "INVALID_INPUT",
        errors: parsed.error.flatten(),
      })
    }

    const {
      youtubeUrl,
      clips,
      platform,
      subtitleStyle,
      clipLengthPreset,
      customClipLengthSec,
      captionsEnabled,
      captionMode,
    } = parsed.data

    const targetClipDurationSec = resolveTargetClipDurationSec(
      clipLengthPreset,
      customClipLengthSec
    )

    const hasFile = Boolean(req.file)
    const hasUrl = Boolean(youtubeUrl)
    if (!hasFile && !hasUrl) {
      return toolFail(res, 400, "Upload a video or provide a YouTube link", {
        requestId,
        code: "INVALID_INPUT",
      })
    }

    const jobId = createJobId()
    const source: ClipSourceType = hasFile ? "upload" : "youtube"

    let sourceVideoPath: string | undefined
    if (hasFile && req.file) {
      const magic = await validateUploadedVideoMagicBytes(req.file.path)
      if (magic.ok === false) {
        await unlink(req.file.path).catch(() => {})
        return toolFail(res, 400, magic.reason, {
          requestId,
          stage: "validate",
          status: "failed",
          code: "INVALID_INPUT",
        })
      }
      const sourcesDir = path.join(process.cwd(), "tmp", "clip-jobs-sources")
      await mkdir(sourcesDir, { recursive: true })
      const ext = path.extname(req.file.originalname || "") || ".mp4"
      const dest = path.join(sourcesDir, `${jobId}${ext}`)
      await rename(req.file.path, dest)
      sourceVideoPath = dest
    }

    const record: ClipJobRecord = {
      jobId,
      userId,
      requestId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "queued",
      clipJobStage: "queued",
      progress: 0,
      message: "Queued — your clip job will start immediately.",
      params: {
        source,
        youtubeUrl: youtubeUrl ?? undefined,
        clips,
        platform,
        subtitleStyle,
        clipLengthPreset,
        customClipLengthSec,
        captionsEnabled,
        captionMode,
        targetClipDurationSec,
      },
      sourceVideoPath,
    }

    await saveJob(record)
    scheduleClipJob(jobId)

    logToolEvent("info", {
      tool: "clip",
      requestId,
      stage: "enqueue",
      status: "success",
      jobId,
    })

    return toolOk(
      res,
      {
        requestId,
        jobId,
        clipJobStage: "queued",
        status: "queued",
        progress: 0,
        message:
          "Job accepted. Poll GET /api/clip/jobs/:jobId for status and results.",
        stage: "validate",
      },
      202
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : "enqueue_failed"
    logToolEvent("error", {
      tool: "clip",
      requestId,
      stage: "enqueue",
      status: "error",
      message: msg,
    })
    return toolFail(res, 500, "Could not start clip job", {
      requestId,
      code: "INTERNAL_ERROR",
    })
  }
}

export const getClipJobStatus = async (req: MulterRequest, res: Response) => {
  const requestId = resolveRequestId(req)
  const userId = req.user?.id
  if (!userId) {
    return toolFail(res, 401, "Unauthorized", {
      requestId,
      code: "UNAUTHORIZED",
    })
  }

  const jobId = req.params.jobId
  if (!jobId || typeof jobId !== "string") {
    return toolFail(res, 400, "Invalid job id", {
      requestId,
      code: "INVALID_INPUT",
    })
  }

  const job = await loadJob(jobId)
  if (!job || job.userId !== userId) {
    return toolFail(res, 404, "Job not found", {
      requestId,
      code: "NOT_FOUND",
    })
  }

  const view = toPublicJobView(job)
  return res.status(200).json({
    success: true,
    requestId,
    ...view,
  })
}
