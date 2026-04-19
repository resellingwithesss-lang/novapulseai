/**
 * Admin-gated Ad Studio routes.
 *
 * Extracted from `ads.routes.ts` to separate staff-only operations
 * (rerender from a stored variant, operator review, lineage inspection)
 * from the user-facing generate / cancel / get flows.
 *
 * Zero behavior change: every route, middleware chain, validation
 * schema, and response shape is identical to the pre-split
 * implementation. Helpers that remain private to `ads.routes.ts` are
 * injected via `createAdminRouter(deps)` so we do not duplicate
 * pipeline state and do not create a circular import cycle.
 */
import { Router, Response } from "express"
import { Prisma } from "@prisma/client"
import crypto from "crypto"
import type { LimitFunction } from "p-limit"
import type { z } from "zod"

import { prisma } from "../../lib/prisma"
import { requireAuth, AuthRequest } from "../auth/auth.middleware"
import { requireAdmin } from "../auth/admin.middleware"
import { resolveRequestId, toolFail, toolOk } from "../../lib/tool-response"
import {
  type PersistedAdJobMetadata,
  findRootJobRow,
  readJobMetadata,
} from "./ad-job-lineage"
import {
  resolveVideoPackaging,
  type VideoPackagingPresetId,
} from "./pipeline/ad.studio-modes"
import { adJobCreateWithWorkspaceFallback } from "./ad-job.create"
import { runLimitedBackgroundJob } from "../../lib/background-job"
import { requireCsrfForCookieAuth } from "../../middlewares/csrf-protect"

/**
 * Minimum shape of the stored ad script we need to reason about when
 * rerendering from a chosen variant. Matches the `AdScript` alias in
 * `ads.routes.ts`; kept duplicated here to avoid a circular value
 * import (type-only import would also work but declaring the surface
 * explicitly documents the admin-side contract).
 */
export interface AdminAdScript {
  hook?: string
  cta?: string
  scenes?: Array<{ text?: string; caption?: string; page?: string }>
  narration?: string
  structured?: unknown
  builtScenes?: unknown[]
  interactionPacingMul?: number
  adVariants?: unknown[]
  selectedVariantId?: string
  variantId?: string
  variantLabel?: string
  scoreSelection?: { usedThresholdGate?: boolean; note?: string }
}

export type AdminGenerateTone = "aggressive" | "emotional" | "clean" | "cinematic"
export type AdminGeneratePlatform = "tiktok" | "instagram" | "youtube"
export type AdminGenerateVoice =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "sage"
  | "shimmer"
  | "verse"
export type AdminCreativeMode = "cinematic" | "ugc_social"
export type AdminVoiceMode = "ai_openai_tts" | "silent_music_only"

/**
 * Parameters for the rerender worker. Mirrors the private
 * `runAdRerenderFromVariantJob` signature in `ads.routes.ts`.
 */
export interface AdminRerenderJobParams {
  userId: string
  jobDbId: string
  requestId: string
  siteUrl: string
  sourceJobPublicId: string
  variantId: string
  duration: number
  tone: AdminGenerateTone
  platform: AdminGeneratePlatform
  ultra: boolean
  voice: AdminGenerateVoice
  voiceMode?: AdminVoiceMode
  videoPackaging?: VideoPackagingPresetId
  captionAccentHex?: string
  sourceScript: AdminAdScript
  variantPayload: Record<string, unknown>
  creativeMode: AdminCreativeMode
  fastPreview?: boolean
}

/** Parsed payload for the rerender-from-variant admin route. */
export interface AdminRerenderFromVariantBody {
  variantId: string
  rerenderReason?: string
  ultra?: boolean
  voice?: AdminGenerateVoice
  previewMode?: "fast"
}

/** Parsed payload for the operator-review admin route. */
export interface AdminOperatorReviewBody {
  preferred?: boolean
  approved?: boolean
  favorite?: boolean
}

/**
 * Dependencies the admin router needs from `ads.routes.ts`. Injected
 * at router creation time so we do not import values from a module
 * that imports us (avoids the partial-module hazard of circular
 * static imports in Node).
 */
export interface AdminRouterDeps {
  rerenderFromVariantSchema: z.ZodType<AdminRerenderFromVariantBody>
  operatorReviewSchema: z.ZodType<AdminOperatorReviewBody>
  findVariantPayload: (
    scriptJson: unknown,
    variantId: string
  ) => Record<string, unknown> | null
  validateVariantForRerender: (v: Record<string, unknown>) => string | null
  resolveSiteUrlForRerender: (
    job: { metadata: unknown },
    scriptJson: unknown
  ) => { ok: true; siteUrl: string } | { ok: false; reason: string }
  coalesceVoice: (input: unknown) => AdminGenerateVoice
  coerceToneFromDb: (s: string) => AdminGenerateTone
  coercePlatformFromDb: (s: string) => AdminGeneratePlatform
  envAdFastPreviewEnabled: () => boolean
  mergeMetadataJson: (
    current: unknown,
    patch: Record<string, unknown>
  ) => Prisma.InputJsonValue
  concurrencyLimit: LimitFunction
  runAdRerenderFromVariantJob: (params: AdminRerenderJobParams) => Promise<void>
}

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const router = Router()

  const {
    rerenderFromVariantSchema,
    operatorReviewSchema,
    findVariantPayload,
    validateVariantForRerender,
    resolveSiteUrlForRerender,
    coalesceVoice,
    coerceToneFromDb,
    coercePlatformFromDb,
    envAdFastPreviewEnabled,
    mergeMetadataJson,
    concurrencyLimit,
    runAdRerenderFromVariantJob,
  } = deps

  router.post(
    "/:jobId/rerender-from-variant",
    requireAuth,
    requireAdmin,
    requireCsrfForCookieAuth,
    async (req: AuthRequest, res: Response) => {
      const requestId = resolveRequestId(req)
      if (!req.user) {
        return toolFail(res, 401, "Unauthorized", {
          requestId,
          stage: "validate",
          status: "failed",
          code: "UNAUTHORIZED",
        })
      }

      const parsed = rerenderFromVariantSchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        return toolFail(res, 400, "Invalid request", {
          requestId,
          stage: "validate",
          status: "failed",
          code: "INVALID_INPUT",
          errors: parsed.error.flatten(),
        })
      }

      const source = await prisma.adJob.findFirst({
        where: { jobId: req.params.jobId },
      })
      if (!source) {
        return toolFail(res, 404, "Job not found", {
          requestId,
          stage: "finalize",
          status: "failed",
          code: "NOT_FOUND",
        })
      }
      if (source.status !== "completed") {
        return toolFail(res, 409, "Source job must be completed before rerender", {
          requestId,
          stage: "validate",
          status: "failed",
          code: "INVALID_INPUT",
        })
      }

      const scriptJson = source.script
      if (scriptJson == null) {
        return toolFail(res, 400, "Source job has no stored script", {
          requestId,
          stage: "validate",
          status: "failed",
          code: "INVALID_INPUT",
        })
      }

      const variantPayload = findVariantPayload(scriptJson, parsed.data.variantId)
      if (!variantPayload) {
        return toolFail(res, 404, "Variant not found in stored adVariants", {
          requestId,
          stage: "validate",
          status: "failed",
          code: "NOT_FOUND",
        })
      }

      const validationErr = validateVariantForRerender(variantPayload)
      if (validationErr) {
        return toolFail(res, 400, validationErr, {
          requestId,
          stage: "validate",
          status: "failed",
          code: "INVALID_INPUT",
        })
      }

      const siteUrlResult = resolveSiteUrlForRerender(source, scriptJson)
      if (siteUrlResult.ok === false) {
        return toolFail(res, 400, siteUrlResult.reason, {
          requestId,
          stage: "validate",
          status: "failed",
          code: "INVALID_INPUT",
        })
      }

      const sourceScript = scriptJson as AdminAdScript
      const metaPrev = readJobMetadata(source)
      const ultra = parsed.data.ultra ?? Boolean(metaPrev.ultra)
      const voice = coalesceVoice(parsed.data.voice ?? metaPrev.voice)

      const newJobId = crypto.randomUUID()
      const tone = coerceToneFromDb(source.tone)
      const platform = coercePlatformFromDb(source.platform)
      const fastPreview =
        envAdFastPreviewEnabled() || parsed.data.previewMode === "fast"

      const videoPackaging = resolveVideoPackaging(
        typeof metaPrev.videoPackaging === "string" ? metaPrev.videoPackaging : undefined,
        "story_cinematic"
      )
      const voiceMode: AdminVoiceMode =
        metaPrev.voiceMode === "silent_music_only" || metaPrev.voiceMode === "ai_openai_tts"
          ? metaPrev.voiceMode
          : "ai_openai_tts"

      const metadata: PersistedAdJobMetadata = {
        siteUrl: siteUrlResult.siteUrl,
        editingStyle: metaPrev.editingStyle ?? "premium",
        ultra,
        voice,
        creativeMode: metaPrev.creativeMode ?? "cinematic",
        ...(metaPrev.studioCreativeModeId
          ? { studioCreativeModeId: metaPrev.studioCreativeModeId }
          : {}),
        videoPackaging,
        voiceMode,
        ...(metaPrev.captionAccentHex
          ? { captionAccentHex: metaPrev.captionAccentHex }
          : {}),
        ...(metaPrev.operatorBrief ? { operatorBrief: metaPrev.operatorBrief } : {}),
        rerenderOfJobId: source.jobId,
        sourceJobId: source.jobId,
        sourceVariantId: parsed.data.variantId,
        rerenderReason: parsed.data.rerenderReason ?? "",
        rerenderSourceDbId: source.id,
        ...(fastPreview ? { fastPreview: true } : {}),
      }

      const newJob = await adJobCreateWithWorkspaceFallback({
        userId: source.userId,
        jobId: newJobId,
        requestId,
        status: "processing",
        platform: source.platform,
        duration: source.duration,
        tone: source.tone,
        progress: 5,
        failedReason: null,
        metadata: metadata as unknown as Prisma.InputJsonValue,
        ...(source.workspaceId ? { workspaceId: source.workspaceId } : {}),
        ...(source.sourceContentPackId
          ? { sourceContentPackId: source.sourceContentPackId }
          : {}),
        ...(source.sourceGenerationId
          ? { sourceGenerationId: source.sourceGenerationId }
          : {}),
        ...(source.sourceType ? { sourceType: source.sourceType } : {}),
      })

      runLimitedBackgroundJob(
        concurrencyLimit,
        {
          job: "ad_rerender_variant",
          requestId,
          jobDbId: newJob.id,
          userId: source.userId,
          publicJobId: newJobId,
          variantId: parsed.data.variantId,
        },
        async () => {
          await runAdRerenderFromVariantJob({
            userId: source.userId,
            jobDbId: newJob.id,
            requestId,
            siteUrl: siteUrlResult.siteUrl,
            sourceJobPublicId: source.jobId,
            variantId: parsed.data.variantId,
            duration: source.duration,
            tone,
            platform,
            ultra,
            voice,
            voiceMode,
            videoPackaging,
            captionAccentHex: metaPrev.captionAccentHex,
            sourceScript,
            variantPayload,
            creativeMode: metaPrev.creativeMode ?? "cinematic",
            fastPreview,
          })
        }
      )

      return toolOk(
        res,
        {
          requestId,
          stage: "analyze",
          status: "queued",
          progress: 5,
          jobId: newJobId,
          result: {
            jobId: newJobId,
            sourceJobId: source.jobId,
            sourceVariantId: parsed.data.variantId,
          },
        },
        202
      )
    }
  )

  router.patch(
    "/:jobId/operator-review",
    requireAuth,
    requireAdmin,
    requireCsrfForCookieAuth,
    async (req: AuthRequest, res: Response) => {
      const requestId = resolveRequestId(req)
      if (!req.user) {
        return toolFail(res, 401, "Unauthorized", {
          requestId,
          stage: "validate",
          status: "failed",
          code: "UNAUTHORIZED",
        })
      }

      const parsed = operatorReviewSchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        return toolFail(res, 400, "Invalid request", {
          requestId,
          stage: "validate",
          status: "failed",
          code: "INVALID_INPUT",
          errors: parsed.error.flatten(),
        })
      }

      const job = await prisma.adJob.findFirst({
        where: { jobId: req.params.jobId },
      })
      if (!job) {
        return toolFail(res, 404, "Job not found", {
          requestId,
          stage: "finalize",
          status: "failed",
          code: "NOT_FOUND",
        })
      }

      try {
        const root = await findRootJobRow(job.jobId)

        if (parsed.data.preferred === true) {
          await prisma.adJob.update({
            where: { id: root.id },
            data: {
              metadata: mergeMetadataJson(root.metadata, {
                operatorPreferredJobId: job.jobId,
              }),
            },
          })
        } else if (parsed.data.preferred === false) {
          const rootMeta = readJobMetadata({ metadata: root.metadata })
          if (rootMeta.operatorPreferredJobId === job.jobId) {
            await prisma.adJob.update({
              where: { id: root.id },
              data: {
                metadata: mergeMetadataJson(root.metadata, {
                  operatorPreferredJobId: null,
                }),
              },
            })
          }
        }

        if (
          parsed.data.approved !== undefined ||
          parsed.data.favorite !== undefined
        ) {
          const patch: Record<string, unknown> = {}
          if (parsed.data.approved !== undefined) {
            patch.operatorApproved = parsed.data.approved
          }
          if (parsed.data.favorite !== undefined) {
            patch.operatorFavorite = parsed.data.favorite
          }
          await prisma.adJob.update({
            where: { id: job.id },
            data: {
              metadata: mergeMetadataJson(job.metadata, patch),
            },
          })
        }

        const updated = await prisma.adJob.findFirst({
          where: { id: job.id },
        })
        if (!updated) {
          return toolFail(res, 500, "Failed to reload job", {
            requestId,
            stage: "finalize",
            status: "failed",
            code: "INTERNAL_ERROR",
          })
        }

        const rootAfter = await findRootJobRow(updated.jobId)
        const rootMetaAfter = readJobMetadata({ metadata: rootAfter.metadata })
        const preferredJobId =
          typeof rootMetaAfter.operatorPreferredJobId === "string"
            ? rootMetaAfter.operatorPreferredJobId
            : null
        const jm = readJobMetadata({ metadata: updated.metadata })

        return toolOk(res, {
          requestId,
          stage: "finalize",
          status: "completed",
          jobId: req.params.jobId,
          operatorReview: {
            preferredJobId,
            isPreferred: preferredJobId === updated.jobId,
            approved: jm.operatorApproved === true,
            favorite: jm.operatorFavorite === true,
            rootJobId: rootAfter.jobId,
          },
          result: {
            operatorReview: {
              preferredJobId,
              isPreferred: preferredJobId === updated.jobId,
              approved: jm.operatorApproved === true,
              favorite: jm.operatorFavorite === true,
              rootJobId: rootAfter.jobId,
            },
          },
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Operator review failed"
        return toolFail(res, 400, msg, {
          requestId,
          stage: "validate",
          status: "failed",
          code: "INVALID_INPUT",
        })
      }
    }
  )

  router.get(
    "/:jobId/lineage",
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res: Response) => {
      const requestId = resolveRequestId(req)
      if (!req.user) {
        return toolFail(res, 401, "Unauthorized", {
          requestId,
          stage: "validate",
          status: "failed",
          code: "UNAUTHORIZED",
        })
      }

      const anchor = await prisma.adJob.findFirst({
        where: { jobId: req.params.jobId },
        select: {
          id: true,
          jobId: true,
          status: true,
          createdAt: true,
          outputUrl: true,
          failedReason: true,
          metadata: true,
        },
      })

      if (!anchor) {
        return toolFail(res, 404, "Job not found", {
          requestId,
          stage: "finalize",
          status: "failed",
          code: "NOT_FOUND",
        })
      }

      const anchorMeta = readJobMetadata({ metadata: anchor.metadata })
      const parentPublicId = anchorMeta.rerenderOfJobId

      let rootJobId = anchor.jobId
      {
        let walkId: string | undefined = anchor.jobId
        for (let i = 0; i < 24; i++) {
          const row = await prisma.adJob.findFirst({
            where: { jobId: walkId },
            select: { jobId: true, metadata: true },
          })
          if (!row) break
          const m = readJobMetadata({ metadata: row.metadata })
          const p = m.rerenderOfJobId
          if (!p || typeof p !== "string") {
            rootJobId = row.jobId
            break
          }
          walkId = p
        }
      }

      const rootRow = await prisma.adJob.findFirst({
        where: { jobId: rootJobId },
        select: { metadata: true },
      })
      const rootMetaPreferred = readJobMetadata({
        metadata: rootRow?.metadata,
      })
      const preferredJobId =
        typeof rootMetaPreferred.operatorPreferredJobId === "string"
          ? rootMetaPreferred.operatorPreferredJobId
          : null

      const parent =
        parentPublicId && typeof parentPublicId === "string"
          ? await prisma.adJob.findFirst({
              where: { jobId: parentPublicId },
              select: {
                jobId: true,
                status: true,
                createdAt: true,
                outputUrl: true,
                failedReason: true,
                metadata: true,
              },
            })
          : null

      const siblings =
        parentPublicId && typeof parentPublicId === "string"
          ? await prisma.adJob.findMany({
              where: {
                AND: [
                  {
                    metadata: {
                      path: ["rerenderOfJobId"],
                      equals: parentPublicId,
                    },
                  },
                  { NOT: { jobId: anchor.jobId } },
                ],
              },
              orderBy: { createdAt: "asc" },
              select: {
                jobId: true,
                status: true,
                createdAt: true,
                outputUrl: true,
                failedReason: true,
                metadata: true,
              },
            })
          : []

      const children = await prisma.adJob.findMany({
        where: {
          metadata: {
            path: ["rerenderOfJobId"],
            equals: anchor.jobId,
          },
        },
        orderBy: { createdAt: "asc" },
        select: {
          jobId: true,
          status: true,
          createdAt: true,
          outputUrl: true,
          failedReason: true,
          metadata: true,
        },
      })

      type LineageRow = {
        jobId: string
        status: string
        createdAt: string
        outputUrl: string | null
        failedReason: string | null
        sourceVariantId?: string
        rerenderReason?: string
        rerenderOfJobId?: string
        relation: "parent" | "sibling" | "self" | "child"
        isPreferred?: boolean
        operatorApproved?: boolean
        operatorFavorite?: boolean
      }

      const pack = (
        row: {
          jobId: string
          status: string
          createdAt: Date
          outputUrl: string | null
          failedReason: string | null
          metadata: unknown
        },
        relation: LineageRow["relation"]
      ): LineageRow => {
        const m = readJobMetadata({ metadata: row.metadata })
        return {
          jobId: row.jobId,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          outputUrl: row.outputUrl,
          failedReason: row.failedReason,
          sourceVariantId: m.sourceVariantId,
          rerenderReason: m.rerenderReason,
          rerenderOfJobId: m.rerenderOfJobId,
          relation,
          isPreferred:
            preferredJobId !== null && preferredJobId === row.jobId,
          operatorApproved: m.operatorApproved === true,
          operatorFavorite: m.operatorFavorite === true,
        }
      }

      const rows: LineageRow[] = []
      if (parent) rows.push(pack(parent, "parent"))
      for (const s of siblings) rows.push(pack(s, "sibling"))
      rows.push(pack(anchor, "self"))
      for (const c of children) rows.push(pack(c, "child"))

      rows.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )

      const role: "original" | "rerender" = parentPublicId ? "rerender" : "original"

      return toolOk(res, {
        requestId,
        stage: "finalize",
        status: "completed",
        jobId: req.params.jobId,
        result: {
          jobId: anchor.jobId,
          role,
          rootJobId,
          preferredJobId,
          parent: parent ? pack(parent, "parent") : null,
          siblings: siblings.map(s => pack(s, "sibling")),
          children: children.map(c => pack(c, "child")),
          timeline: rows,
        },
      })
    }
  )

  return router
}
