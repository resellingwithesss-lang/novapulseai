import { Router, Response } from "express"
import { z } from "zod"
import crypto from "crypto"
import pLimit from "p-limit"
import path from "path"
import fs from "fs"
import { Prisma } from "@prisma/client"

import { prisma } from "../../lib/prisma"
import { requireAuth, AuthRequest } from "../auth/auth.middleware"
import { requireAdmin } from "../auth/admin.middleware"
import { evaluateBillingAccess } from "../billing/billing.access"
import { resolveRequestId, toolFail, toolOk } from "../../lib/tool-response"
import { buildMediaOutput } from "../tools/tool.media"
import { logToolEvent } from "../../lib/tool-logger"
import { validateAdJobSourceRefs } from "../workflow/source-metadata"
import {
  type PersistedAdJobMetadata,
  findRootJobRow,
  readJobMetadata,
} from "./ad-job-lineage"

import { generateAdScriptsPerformancePack, generateVoiceover } from "./ads.service"
import {
  resolveStudioCreativeMode,
  resolveVideoPackaging,
  STUDIO_CREATIVE_MODE_ENUM,
  VIDEO_PACKAGING_ENUM,
  type VideoPackagingPresetId,
} from "./pipeline/ad.studio-modes"
import { generateSilentVoiceTrack } from "./voice/voiceover.generator"
import {
  analyzeWebsite,
  analysisToSiteIngestion,
  type WebsiteAnalysis,
} from "./website.analyzer"
import type { AdSiteIngestion, BuiltAdScene, StructuredAdScript } from "./pipeline/types"
import { buildInteractiveAdPlan } from "./pipeline/interaction.plan"
import { rankedVariantPool } from "./pipeline/ad.scoring"
import { detectNovaPulseAIProduct, novaPulseAIDemoLoginConfigured } from "./pipeline/ad.product-profile"
import { novaPulseAICtaOverlay, novaPulseAIHookOverlay } from "./pipeline/scene.builder"
import { buildCinematicAssets } from "./rendering/cinematic.pipeline"
import { applyColorGrade } from "./rendering/color.grader"
import { mixAudio } from "./audio.mixer"
import { renderVideo } from "./ads.renderer"
import { adJobCreateWithWorkspaceFallback } from "./ad-job.create"
import { runLimitedBackgroundJob } from "../../lib/background-job"
import {
  assertPublicHttpUrl,
  isLoopbackIngestionAllowed,
} from "../../lib/url-guard"

const router = Router()

/** Short, operator-facing failure text for ad jobs (stored on `failedReason`). */
function humanizeAdWorkerFailure(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const lower = raw.toLowerCase()
  const captureStage = /\[AD_CAPTURE:([^\]]+)\]/.exec(raw)?.[1]
  if (captureStage) {
    const hints =
      "NovaPulseAI jobs use a tuned capture profile; if this persists, check ads:capture logs for phase timings."
    switch (captureStage) {
      case "interactive pre-launch":
        return `Capture failed before the first page load (wall clock exhausted during browser startup). ${hints}`
      case "interactive segment start":
        return `Capture timed out between product-demo scenes (navigation or setup took too long). ${hints}`
      case "interactive frame loop":
        return `Capture timed out while recording screen frames (frame loop exceeded wall budget). ${hints}`
      case "interactive padding frames":
        return `Capture timed out finishing remaining video frames (padding pass). ${hints}`
      case "timeline pre-launch":
        return `Timeline capture failed before the first navigation (wall clock). ${hints}`
      case "timeline step":
        return `Timeline capture timed out on a site route. For local NovaPulseAI UI (localhost), set AD_TREAT_LOCALHOST_AS_NOVAPULSEAI=true so the tuned profile applies; see ads:capture (novaPulseAICaptureReason, captureSiteHost). ${hints}`
      case "timeline frames":
        return `Timeline capture timed out during frame recording. For local NovaPulseAI UI (localhost), set AD_TREAT_LOCALHOST_AS_NOVAPULSEAI=true so the tuned profile applies; see ads:capture (novaPulseAICaptureProfile, fallbackFromInteractive). ${hints}`
      case "timeline padding frames":
        return `Timeline capture timed out while padding frames. For localhost NovaPulseAI dev, set AD_TREAT_LOCALHOST_AS_NOVAPULSEAI=true if the profile was off. ${hints}`
      case "frames_to_video":
        return `Browser capture finished but ffmpeg (frames→video) timed out. Check AD_CAPTURE_FFMPEG_MS and disk/CPU.`
      default:
        return `Website capture timed out during: ${captureStage}. See server logs (ads:capture).`
    }
  }
  if (
    lower.includes("website capture exceeded") ||
    lower.includes("[ad_capture:") ||
    lower.includes("puppeteer.launch(ad capture)") ||
    lower.includes("frames-to-video timed out")
  ) {
    return "Website capture or browser automation hit a time limit. Try again, simplify the target page, or ask an admin to raise AD_CAPTURE_WALL_CLOCK_MS / AD_PUPPETEER_LAUNCH_TIMEOUT_MS."
  }
  if (lower.includes("[ad_ffmpeg:cinematic_stitch]") || (lower.includes("cinematic stitch") && lower.includes("timed out"))) {
    return "Cinematic stitch (ffmpeg) timed out after capture. Try fast preview or check server load."
  }
  if (lower.includes("timed out after") || /\btimed out\b/.test(lower)) {
    return "Ad script generation timed out (AI model). Try again later, or ask an admin to raise AD_SCRIPT_LLM_TIMEOUT_MS."
  }
  if (raw.includes("OPENAI_API_KEY") || (lower.includes("openai") && lower.includes("key"))) {
    return "AI is not configured: OPENAI_API_KEY is missing on the server."
  }
  if (raw.includes("All ad variants failed")) {
    return "AI script generation failed for every variant. Check server logs for ads:script:llm."
  }
  if (/non-json|llm returned|validation error|invalid json/i.test(raw)) {
    return "The AI returned a script we could not parse. Try again or use a simpler landing page."
  }
  if (lower.includes("ffmpeg") && (lower.includes("timeout") || lower.includes("exited"))) {
    return "Video encoding failed during capture or render. Check server logs for ffmpeg details."
  }
  if (lower.includes("ffprobe timed out")) {
    return "Could not read the captured video metadata (ffprobe timed out). Try again or raise AD_FFPROBE_TIMEOUT_MS."
  }
  if (raw.length > 480) return `${raw.slice(0, 477)}...`
  return raw
}

const concurrencyLimit = pLimit(2)
const GENERATED_DIR = path.resolve("generated")

const MAX_URL_LENGTH = 500
const MAX_DURATION = 120
const MIN_DURATION = 5

const RENDER_TIMEOUT_MS = 10 * 60 * 1000
const MIN_OUTPUT_SIZE_BYTES = 50_000
const AD_JOB_STALE_MS = 1000 * 60 * 30

const BRAND_NAME = "NovaPulseAI"
const MAX_RENDER_ATTEMPTS = 2

function isAdminUser(role: string | undefined): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN"
}

const generateSchema = z.object({
  siteUrl: z.string().trim().url().max(MAX_URL_LENGTH),
  tone: z.enum(["aggressive", "emotional", "clean", "cinematic"]),
  /** JSON sometimes sends numbers as strings; coerce for reliable validation. */
  duration: z.coerce.number().int().min(MIN_DURATION).max(MAX_DURATION),
  platform: z.enum(["tiktok", "instagram", "youtube"]),
  ultra: z.preprocess(
    v => {
      if (v === true || v === "true" || v === 1 || v === "1") return true
      if (v === false || v === "false" || v === 0 || v === "0") return false
      return v
    },
    z.boolean().optional().default(false)
  ),
  editingStyle: z
    .enum(["aggressive", "premium", "auto", "website", "desk"])
    .optional()
    .default("premium"),
  /** Cinematic = polished product commercial (default). UGC = short-form native. */
  creativeMode: z
    .enum(["cinematic", "ugc_social"])
    .optional()
    .default("cinematic"),
  /** How many top-scored variants to render (1 default). Env AD_RENDER_TOP_VARIANTS overrides when omitted. */
  renderTopVariants: z.preprocess(
    v => {
      if (v === 2 || v === "2") return 2
      if (v === 1 || v === "1") return 1
      return v
    },
    z.union([z.literal(1), z.literal(2)]).optional()
  ),
  voice: z
    .enum(["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"])
    .optional()
    .default("alloy"),
  workspaceId: z.string().min(5).max(64).optional(),
  sourceContentPackId: z.string().min(5).max(64).optional(),
  sourceGenerationId: z.string().min(5).max(64).optional(),
  sourceType: z.enum(["CONTENT_PACK", "GENERATION", "MANUAL"]).optional(),
  /** Dev / iteration: faster capture and lighter encodes (also enable via AD_FAST_PREVIEW). */
  previewMode: z.enum(["fast"]).optional(),
  /** Operator / internal brief — stored on job metadata for traceability (does not replace site analysis). */
  operatorBrief: z.string().trim().max(4000).optional(),
  /** Ad Studio creative mode — drives LLM directive + variant ordering + default packaging. */
  studioCreativeMode: z.enum(STUDIO_CREATIVE_MODE_ENUM).optional(),
  /** Override caption / lower-third packaging (otherwise studio default or story_cinematic). */
  videoPackaging: z.enum(VIDEO_PACKAGING_ENUM).optional(),
  /** ai_openai_tts = real OpenAI speech; silent_music_only = music bed only (no VO). */
  voiceMode: z.enum(["ai_openai_tts", "silent_music_only"]).optional().default("ai_openai_tts"),
  /** Optional 6-char hex without # — accent for streamer / highlight caption styles. */
  captionAccentHex: z
    .string()
    .trim()
    .regex(/^[0-9A-Fa-f]{6}$/)
    .optional(),
})

type GenerateBody = z.infer<typeof generateSchema>

function envAdFastPreviewEnabled(): boolean {
  const v = process.env.AD_FAST_PREVIEW?.trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes"
}

function resolveAdFastPreview(body: { previewMode?: "fast" }): boolean {
  return envAdFastPreviewEnabled() || body.previewMode === "fast"
}

type CaptionItem = {
  text: string
  start: number
  end: number
}

type ScriptScene = {
  text?: string
  caption?: string
  page?: string
}

type AdScript = {
  hook?: string
  cta?: string
  scenes?: ScriptScene[]
  narration?: string
  structured?: StructuredAdScript
  builtScenes?: BuiltAdScene[]
  interactionPacingMul?: number
  adVariants?: unknown[]
  selectedVariantId?: string
  variantId?: string
  variantLabel?: string
  scoreSelection?: { usedThresholdGate?: boolean; note?: string }
}

const rerenderFromVariantSchema = z.object({
  variantId: z.string().min(1).max(80),
  rerenderReason: z.string().max(500).optional(),
  ultra: z.boolean().optional(),
  voice: generateSchema.shape.voice.optional(),
  previewMode: z.enum(["fast"]).optional(),
})

const voiceEnum = z.enum([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
])

function coalesceVoice(input: unknown): NonNullable<GenerateBody["voice"]> {
  const v = voiceEnum.safeParse(input)
  return v.success ? v.data : "alloy"
}

function coerceToneFromDb(s: string): GenerateBody["tone"] {
  const t = z.enum(["aggressive", "emotional", "clean", "cinematic"]).safeParse(s)
  return t.success ? t.data : "emotional"
}

function coercePlatformFromDb(s: string): GenerateBody["platform"] {
  const t = z.enum(["tiktok", "instagram", "youtube"]).safeParse(s)
  return t.success ? t.data : "tiktok"
}

function mergeMetadataJson(
  current: unknown,
  patch: Record<string, unknown>
): Prisma.InputJsonValue {
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {}
  return { ...base, ...patch } as Prisma.InputJsonValue
}

function resolveRenderTopVariants(requested?: number): 1 | 2 {
  if (requested === 2) return 2
  if (requested === 1) return 1
  const raw = (process.env.AD_RENDER_TOP_VARIANTS || "").trim().toLowerCase()
  if (raw === "2" || raw === "two") return 2
  return 1
}

function safeFilePart(s: string): string {
  const t = String(s || "var").replace(/[^a-zA-Z0-9_-]+/g, "-")
  return t.slice(0, 48) || "var"
}

type VariantRenderProgress = (localPercent: number) => void

async function executeSingleVariantRender(params: {
  jobDbId: string
  requestId: string
  siteUrl: string
  duration: number
  tone: GenerateBody["tone"]
  platform: GenerateBody["platform"]
  ultra: boolean
  voice: NonNullable<GenerateBody["voice"]>
  voiceMode?: "ai_openai_tts" | "silent_music_only"
  videoPackaging?: VideoPackagingPresetId
  captionAccentHex?: string
  script: AdScript
  analysis: WebsiteAnalysis
  ingestion: AdSiteIngestion
  creativeMode: NonNullable<GenerateBody["creativeMode"]>
  /** Unique per render (e.g. preset id + rank) for temp/output filenames. */
  fileSuffix: string
  onProgress?: VariantRenderProgress
  fastPreview?: boolean
}): Promise<{
  outputPath: string
  fileSizeBytes: number
  renderDurationMs: number
  voicePath: string
  captionCount: number
}> {
  const {
    jobDbId,
    requestId,
    siteUrl,
    duration,
    tone,
    platform,
    ultra,
    voice,
    script,
    analysis,
    ingestion,
    creativeMode,
    fileSuffix,
    onProgress,
    fastPreview = false,
  } = params
  const voiceMode = params.voiceMode ?? "ai_openai_tts"
  const videoPackaging = params.videoPackaging ?? "story_cinematic"
  const captionAccentHex = params.captionAccentHex

  const npaiProduct = detectNovaPulseAIProduct(ingestion)
  const npaiDemoLoginJob = npaiProduct && novaPulseAIDemoLoginConfigured()
  /** Normal NovaPulseAI cinematic path: target 20–40s (floor 15) so stitch/capture budget matches a real demo. */
  const renderDuration =
    npaiProduct && !fastPreview
      ? Math.max(15, Math.min(40, npaiDemoLoginJob ? Math.max(20, duration) : Math.max(18, duration)))
      : duration

  const startedAt = Date.now()
  const sfx = safeFilePart(fileSuffix)

  const narration =
    script.narration ||
    [
      analysis.brandName && `${analysis.brandName}.`,
      script?.hook,
      ...(script?.scenes ?? []).map(scene => scene?.text).filter(Boolean),
      script?.cta,
    ]
      .filter(Boolean)
      .join(" ")

  const renderLog = `[ads:render] requestId=${requestId} jobDbId=${jobDbId}`

  onProgress?.(5)
  const tVoice = Date.now()
  const voiceStage = voiceMode === "silent_music_only" ? "silent_voice_track" : "voiceover"
  console.log(renderLog, `stage=${voiceStage}`, JSON.stringify({ phase: "start", ts: new Date().toISOString() }))
  const voicePath =
    voiceMode === "silent_music_only"
      ? await generateSilentVoiceTrack(renderDuration)
      : await generateVoiceover(narration, voice)
  console.log(
    renderLog,
    `stage=${voiceStage}`,
    JSON.stringify({ phase: "end", durationMs: Date.now() - tVoice, ts: new Date().toISOString() })
  )
  onProgress?.(15)
  await assertJobRunnable(jobDbId)

  const capturePrefs = preferredPathsFromIngestion(ingestion)

  const built = script.builtScenes ?? []
  const allowDestructiveSubmit = process.env.AD_ALLOW_DESTRUCTIVE_SUBMIT === "true"
  const interactivePlan =
    built.length > 0
      ? buildInteractiveAdPlan(siteUrl, ingestion, built, {
          allowDestructiveSubmit,
          allowNovaPulseAIDemoLoginSubmit:
            detectNovaPulseAIProduct(ingestion) && novaPulseAIDemoLoginConfigured(),
        })
      : undefined

  const pacingMultiplier =
    (typeof script.interactionPacingMul === "number" ? script.interactionPacingMul : 1) *
    (tone === "cinematic" ? 1.22 : tone === "clean" ? 0.92 : 1.08) *
    (creativeMode === "ugc_social" ? 0.88 : 1)

  const timingProfile =
    creativeMode === "ugc_social"
      ? "snappy"
      : tone === "clean"
        ? "snappy"
        : "cinematic"

  const tCine = Date.now()
  let lastCaptureProgressPct = -10
  const cinematic = await buildCinematicAssets(siteUrl, renderDuration, platform, {
    sceneDurations: script.builtScenes?.map(s => s.duration),
    sceneTypes: script.builtScenes?.map(s => s.type),
    preferredPaths: capturePrefs.length ? capturePrefs : undefined,
    interactivePlan,
    visualStyle: creativeMode === "ugc_social" ? "ugc_social" : "cinematic",
    interaction: {
      allowDestructiveSubmit,
      timingProfile,
      pacingMultiplier,
    },
    fastPreview,
    vfSiteIngestion: npaiDemoLoginJob ? ingestion : undefined,
    novaPulseAIProductAd: detectNovaPulseAIProduct(ingestion),
    logCtx: { requestId, jobDbId },
    onPhase: phase => {
      if (phase === "capture_start") onProgress?.(17)
      else if (phase === "capture_end") onProgress?.(32)
      else if (phase === "prepare_stitch") onProgress?.(34)
      else if (phase === "ffmpeg_stitch_start") onProgress?.(36)
      else if (phase === "ffmpeg_stitch_end") onProgress?.(39)
    },
    onCaptureProgress: pct => {
      if (pct < 100 && pct - lastCaptureProgressPct < 2) return
      lastCaptureProgressPct = pct
      const local = 17 + Math.round((pct / 100) * 14)
      onProgress?.(Math.min(31, Math.max(17, local)))
    },
  })
  console.log(
    renderLog,
    "stage=cinematic_assets",
    JSON.stringify({ phase: "end", durationMs: Date.now() - tCine, ts: new Date().toISOString() })
  )
  onProgress?.(40)
  await assertJobRunnable(jobDbId)

  const tGrade = Date.now()
  console.log(renderLog, "stage=color_grade", JSON.stringify({ phase: "start", ts: new Date().toISOString() }))
  const graded = await applyColorGrade({
    inputPath: cinematic.finalVideo,
    outputFileName: `graded-${requestId}-${sfx}.mp4`,
    platform,
    tone:
      creativeMode === "ugc_social"
        ? "clean"
        : tone === "clean"
          ? "clean"
          : "cinematic",
    quality: ultra ? "ultra" : "high",
    useFilmGrain: fastPreview ? false : creativeMode === "ugc_social" ? false : tone !== "clean",
    useVignette: fastPreview ? false : creativeMode === "ugc_social" ? false : true,
    fastPreview,
  })
  console.log(
    renderLog,
    "stage=color_grade",
    JSON.stringify({ phase: "end", durationMs: Date.now() - tGrade, ts: new Date().toISOString() })
  )
  onProgress?.(55)
  await assertJobRunnable(jobDbId)

  const tMix = Date.now()
  console.log(renderLog, "stage=audio_mix", JSON.stringify({ phase: "start", ts: new Date().toISOString() }))
  const audio = await mixAudio({
    voicePath,
    musicPath: "assets/music.mp3",
    outputFileName: `audio-${requestId}-${sfx}.aac`,
    durationSeconds: renderDuration,
  })
  console.log(
    renderLog,
    "stage=audio_mix",
    JSON.stringify({ phase: "end", durationMs: Date.now() - tMix, ts: new Date().toISOString() })
  )
  onProgress?.(70)
  await assertJobRunnable(jobDbId)

  const captions = buildCaptionsFromScript(script, renderDuration)
  const hookOverlay = npaiProduct ? novaPulseAIHookOverlay(String(script?.hook ?? "")) : script?.hook
  const ctaOverlay = npaiProduct ? novaPulseAICtaOverlay(String(script?.cta ?? "")) : script?.cta

  const tFinal = Date.now()
  console.log(renderLog, "stage=final_render", JSON.stringify({ phase: "start", ts: new Date().toISOString() }))
  const rendered = await renderWithRetry(async () => {
    return Promise.race<string>([
      renderVideo({
        clips: [graded],
        voicePath: audio,
        captions,
        platform,
        quality: ultra ? "ultra" : "high",
        hook: hookOverlay,
        cta: ctaOverlay,
        watermarkText: analysis.brandName || BRAND_NAME,
        outputFileName: `render-${requestId}-${sfx}.mp4`,
        overlayStyle: creativeMode === "ugc_social" ? "ugc_social" : undefined,
        captionPackaging: videoPackaging,
        ...(captionAccentHex ? { captionAccentHex } : {}),
        ...(npaiProduct && creativeMode !== "ugc_social"
          ? { hookOverlayStartSec: 0.45, hookOverlayEndSec: 2.45 }
          : {}),
        fastPreview,
      }),
      timeoutPromise(RENDER_TIMEOUT_MS),
    ])
  }, requestId)

  console.log(
    renderLog,
    "stage=final_render",
    JSON.stringify({ phase: "end", durationMs: Date.now() - tFinal, ts: new Date().toISOString() })
  )

  assertSafeGeneratedFile(rendered)

  const stats = fs.statSync(rendered)
  const renderDurationMs = Date.now() - startedAt
  onProgress?.(100)

  return {
    outputPath: rendered,
    fileSizeBytes: stats.size,
    renderDurationMs,
    voicePath,
    captionCount: captions.length,
  }
}

const operatorReviewSchema = z
  .object({
    preferred: z.boolean().optional(),
    approved: z.boolean().optional(),
    favorite: z.boolean().optional(),
  })
  .refine(
    d =>
      d.preferred !== undefined ||
      d.approved !== undefined ||
      d.favorite !== undefined,
    { message: "At least one of preferred, approved, or favorite is required" }
  )

function resolveSiteUrlForRerender(
  job: { metadata: unknown },
  scriptJson: unknown
): { ok: true; siteUrl: string } | { ok: false; reason: string } {
  const meta = readJobMetadata(job)
  if (typeof meta.siteUrl === "string" && meta.siteUrl.trim()) {
    try {
      return { ok: true, siteUrl: normalizeUrl(meta.siteUrl) }
    } catch {
      /* fall through */
    }
  }
  if (scriptJson && typeof scriptJson === "object") {
    const s = scriptJson as Record<string, unknown>
    const built = s.builtScenes
    if (Array.isArray(built) && built[0] && typeof built[0] === "object") {
      const page = (built[0] as Record<string, unknown>).page
      if (typeof page === "string" && /^https?:\/\//i.test(page.trim())) {
        try {
          return { ok: true, siteUrl: normalizeUrl(page) }
        } catch {
          /* ignore */
        }
      }
    }
  }
  return {
    ok: false,
    reason:
      "Source job has no siteUrl in metadata and no inferable URL from scenes. Generate a new ad once to persist site URL, or ensure builtScenes[0].page is a full URL.",
  }
}

function findVariantPayload(
  scriptJson: unknown,
  variantId: string
): Record<string, unknown> | null {
  if (!scriptJson || typeof scriptJson !== "object") return null
  const root = scriptJson as Record<string, unknown>
  const list = root.adVariants
  if (!Array.isArray(list)) return null
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    if (o.id === variantId) return o
  }
  return null
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0
}

function validateVariantForRerender(v: Record<string, unknown>): string | null {
  if (!nonEmptyString(v.hook)) return "Variant is missing hook"
  if (!nonEmptyString(v.cta)) return "Variant is missing cta"
  const builtOk = Array.isArray(v.builtScenes) && v.builtScenes.length > 0
  const scenesOk = Array.isArray(v.scenes) && v.scenes.length > 0
  if (!builtOk && !scenesOk) {
    return "Variant needs builtScenes or scenes for capture and captions"
  }
  const narrOk = nonEmptyString(v.narration)
  if (narrOk) return null
  if (scenesOk) {
    const hasText = (v.scenes as unknown[]).some(
      x => x && typeof x === "object" && nonEmptyString((x as ScriptScene).text)
    )
    if (hasText) return null
  }
  if (builtOk) {
    const hasText = (v.builtScenes as BuiltAdScene[]).some(s => nonEmptyString(s?.text))
    if (hasText) return null
  }
  return "Variant needs narration or scene/built scene text for voiceover"
}

function assembleAdScriptFromVariant(
  sourceScript: AdScript,
  variant: Record<string, unknown>,
  variantId: string,
  sourceJobPublicId: string
): AdScript {
  const label = nonEmptyString(variant.label) ? variant.label : undefined
  return {
    hook: String(variant.hook ?? ""),
    cta: String(variant.cta ?? ""),
    narration: nonEmptyString(variant.narration) ? variant.narration : undefined,
    structured:
      variant.structured && typeof variant.structured === "object"
        ? (variant.structured as StructuredAdScript)
        : undefined,
    builtScenes: Array.isArray(variant.builtScenes)
      ? (variant.builtScenes as BuiltAdScene[])
      : undefined,
    scenes: Array.isArray(variant.scenes)
      ? (variant.scenes as ScriptScene[])
      : undefined,
    interactionPacingMul:
      typeof variant.interactionPacingMul === "number"
        ? variant.interactionPacingMul
        : undefined,
    adVariants: sourceScript.adVariants,
    selectedVariantId: variantId,
    variantId,
    variantLabel: label,
    scoreSelection: {
      usedThresholdGate: false,
      note: `Rerender from stored variant "${variantId}" (source job ${sourceJobPublicId}).`,
    },
  }
}

async function runAdRenderPipelineFromScript(params: {
  userId: string
  jobDbId: string
  requestId: string
  siteUrl: string
  duration: number
  tone: GenerateBody["tone"]
  platform: GenerateBody["platform"]
  ultra: boolean
  voice: NonNullable<GenerateBody["voice"]>
  voiceMode?: "ai_openai_tts" | "silent_music_only"
  videoPackaging?: VideoPackagingPresetId
  captionAccentHex?: string
  script: AdScript
  analysis: WebsiteAnalysis
  ingestion: AdSiteIngestion
  startedAt: number
  creativeMode?: NonNullable<GenerateBody["creativeMode"]>
  fastPreview?: boolean
}): Promise<void> {
  const {
    jobDbId,
    requestId,
    siteUrl,
    duration,
    tone,
    platform,
    ultra,
    voice,
    script,
    analysis,
    ingestion,
    startedAt,
  } = params
  const creativeMode = params.creativeMode ?? "cinematic"
  const fastPreview = params.fastPreview === true

  await updateJob(jobDbId, {
    progress: 30,
    script: script as unknown as Prisma.InputJsonValue,
    scenePlan: ((script?.builtScenes ?? script?.scenes ?? []) as unknown) as Prisma.InputJsonValue,
  })
  await assertJobRunnable(jobDbId)

  const result = await executeSingleVariantRender({
    jobDbId,
    requestId,
    siteUrl,
    duration,
    tone,
    platform,
    ultra,
    voice,
    voiceMode: params.voiceMode,
    videoPackaging: params.videoPackaging,
    captionAccentHex: params.captionAccentHex,
    script,
    analysis,
    ingestion,
    creativeMode,
    fileSuffix: "primary",
    fastPreview,
    onProgress: p => {
      void updateJob(jobDbId, {
        progress: Math.min(99, 30 + Math.round((p / 100) * 65)),
      })
    },
  })

  const finishedAt = new Date()

  await updateJob(jobDbId, {
    status: "completed",
    outputUrl: `/generated/${path.basename(result.outputPath)}`,
    progress: 100,
    failedReason: null,
    renderCompletedAt: finishedAt,
    voicePath: result.voicePath,
    fileSizeBytes: result.fileSizeBytes,
    resolution: getResolution(platform),
    aspectRatio: getAspectRatio(platform),
    sceneCount: result.captionCount,
    renderDurationMs: Date.now() - startedAt,
  })
}

function ensureGeneratedFolder(): void {
  if (!fs.existsSync(GENERATED_DIR)) {
    fs.mkdirSync(GENERATED_DIR, { recursive: true })
  }
}

function normalizeUrl(input: string): string {
  // Guards the `siteUrl` that feeds Puppeteer `page.goto` downstream. Rejects
  // IP literals, RFC1918 / loopback / link-local / cloud-metadata targets, and
  // embedded credentials. Loopback only permitted in local dev when the
  // operator has opted in via `AD_TREAT_LOCALHOST_AS_NOVAPULSEAI`.
  return assertPublicHttpUrl(input, {
    maxLength: MAX_URL_LENGTH,
    allowLoopback: isLoopbackIngestionAllowed(),
  })
}

function buildCaptionsFromScript(
  script: AdScript | null | undefined,
  duration: number
): CaptionItem[] {
  const built = script?.builtScenes
  if (Array.isArray(built) && built.length > 0) {
    let t = 0
    const out: CaptionItem[] = []
    for (const s of built) {
      const seg = Math.min(Math.max(s.duration, 0.6), duration)
      const beats =
        Array.isArray(s.captionBeats) && s.captionBeats.length > 0
          ? s.captionBeats.map(b => String(b).trim()).filter(Boolean)
          : [String(s.caption ?? "").trim()].filter(Boolean)
      if (beats.length && seg > 0) {
        const slice = seg / beats.length
        for (let k = 0; k < beats.length; k++) {
          const text = beats[k]!
          const start = Number((t + k * slice).toFixed(2))
          const end = Number((t + (k + 1) * slice).toFixed(2))
          if (text && end > start) out.push({ text, start, end })
        }
      }
      t += seg
    }
    if (out.length) return out
  }

  const scenes = Array.isArray(script?.scenes) ? script.scenes : []

  if (!scenes.length) return []

  const segment = duration / scenes.length

  return scenes
    .map((scene, i) => {
      const text = String(scene?.caption ?? "").trim()
      if (!text) return null

      const start = Number((i * segment).toFixed(2))
      const end = Number(((i + 1) * segment).toFixed(2))

      if (end <= start) return null

      return { text, start, end }
    })
    .filter((item): item is CaptionItem => item !== null)
}

function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => {
      clearTimeout(timer)
      reject(new Error("Render timeout"))
    }, ms)
  })
}

function assertSafeGeneratedFile(filePath: string): void {
  const resolved = path.resolve(filePath)
  const root = path.resolve(GENERATED_DIR)

  if (!resolved.startsWith(root)) {
    throw new Error("Invalid render path")
  }

  if (!fs.existsSync(resolved)) {
    throw new Error("Render output missing")
  }

  const stats = fs.statSync(resolved)

  if (!stats.isFile()) {
    throw new Error("Render output is not a file")
  }

  if (stats.size < MIN_OUTPUT_SIZE_BYTES) {
    throw new Error("Render output too small")
  }
}

function getResolution(platform: GenerateBody["platform"]): string {
  switch (platform) {
    case "youtube":
      return "1920x1080"
    case "instagram":
      return "1080x1080"
    default:
      return "1080x1920"
  }
}

function getAspectRatio(platform: GenerateBody["platform"]): string {
  switch (platform) {
    case "youtube":
      return "16:9"
    case "instagram":
      return "1:1"
    default:
      return "9:16"
  }
}

function preferredPathsFromIngestion(ingestion: import("./pipeline/types").AdSiteIngestion): string[] {
  const vf = detectNovaPulseAIProduct(ingestion)
  const addPath = (href: string | undefined, out: string[]) => {
    if (!href) return
    try {
      const p = new URL(href).pathname
      if (p && p !== "/" && !out.includes(p)) out.push(p)
    } catch {
      if (href.startsWith("/") && href !== "/" && !out.includes(href)) out.push(href)
    }
  }
  const prioritized: string[] = []
  if (vf) {
    addPath(ingestion.toolsUrl, prioritized)
    addPath(ingestion.dashboardUrl, prioritized)
    addPath(ingestion.loginUrl, prioritized)
  }
  for (const v of ingestion.visuals) {
    try {
      const p = new URL(v.url).pathname
      if (p && p !== "/" && !prioritized.includes(p)) prioritized.push(p)
    } catch {
      /* skip */
    }
  }
  if (vf) addPath(ingestion.pricingUrl, prioritized)
  return [...new Set(prioritized)].slice(0, 8)
}

async function updateJob(jobId: string, data: Prisma.AdJobUpdateInput): Promise<void> {
  await prisma.adJob.update({
    where: { id: jobId },
    data
  })
}

async function getJobByDbId(jobId: string) {
  return prisma.adJob.findUnique({
    where: { id: jobId },
    select: { status: true, failedReason: true },
  })
}

async function assertJobRunnable(jobDbId: string): Promise<void> {
  const job = await getJobByDbId(jobDbId)
  if (!job) throw new Error("JOB_NOT_FOUND")
  if (job.status === "failed" && (job.failedReason || "").toLowerCase().includes("cancel")) {
    throw new Error("JOB_CANCELLED")
  }
  if (job.status === "failed") throw new Error("JOB_ALREADY_FAILED")
}

async function runAdGenerationJob(params: {
  userId: string
  jobDbId: string
  requestId: string
  siteUrl: string
  duration: number
  tone: GenerateBody["tone"]
  platform: GenerateBody["platform"]
  editingStyle: NonNullable<GenerateBody["editingStyle"]>
  ultra: boolean
  voice: NonNullable<GenerateBody["voice"]>
  /** Resolved pipeline mode (may differ from UI when a studio preset overrides). */
  effectiveCreativeMode: NonNullable<GenerateBody["creativeMode"]>
  studioPack?: {
    studioCreativeDirective?: string
    variantPreference?: string[]
  }
  videoPackaging: VideoPackagingPresetId
  voiceMode: "ai_openai_tts" | "silent_music_only"
  captionAccentHex?: string
  renderTopVariants: 1 | 2
  fastPreview: boolean
}): Promise<void> {
  const startedAt = Date.now()

  try {
    logToolEvent("info", {
      tool: "ads",
      requestId: params.requestId,
      jobId: params.jobDbId,
      userId: params.userId,
      stage: "start",
      status: "processing",
      message: "Starting ad generation",
    })

    await updateJob(params.jobDbId, {
      progress: 10,
      renderStartedAt: new Date(),
      failedReason: null,
      requestId: params.requestId
    })
    await assertJobRunnable(params.jobDbId)

    const analysis = await analyzeWebsite(params.siteUrl)

    await updateJob(params.jobDbId, {
      progress: 18
    })
    await assertJobRunnable(params.jobDbId)

    const ingestion = analysisToSiteIngestion(analysis)

    await updateJob(params.jobDbId, { progress: 20 })
    await assertJobRunnable(params.jobDbId)

    const pack = await generateAdScriptsPerformancePack(
      params.siteUrl,
      params.tone,
      params.duration,
      params.platform,
      ingestion,
      params.effectiveCreativeMode,
      { requestId: params.requestId, jobDbId: params.jobDbId },
      params.studioPack
    )

    await updateJob(params.jobDbId, { progress: 29 })
    await assertJobRunnable(params.jobDbId)

    const script = pack.primary as AdScript

    if (params.renderTopVariants === 1) {
      await runAdRenderPipelineFromScript({
        userId: params.userId,
        jobDbId: params.jobDbId,
        requestId: params.requestId,
        siteUrl: params.siteUrl,
        duration: params.duration,
        tone: params.tone,
        platform: params.platform,
        ultra: params.ultra,
        voice: params.voice,
        voiceMode: params.voiceMode,
        videoPackaging: params.videoPackaging,
        captionAccentHex: params.captionAccentHex,
        script,
        analysis,
        ingestion,
        startedAt,
        creativeMode: params.effectiveCreativeMode,
        fastPreview: params.fastPreview,
      })
    } else {
      const ranked = rankedVariantPool(pack.scored)
      const slice = ranked.slice(0, Math.min(2, ranked.length))

      if (slice.length <= 1) {
        await runAdRenderPipelineFromScript({
          userId: params.userId,
          jobDbId: params.jobDbId,
          requestId: params.requestId,
          siteUrl: params.siteUrl,
          duration: params.duration,
          tone: params.tone,
          platform: params.platform,
          ultra: params.ultra,
          voice: params.voice,
          voiceMode: params.voiceMode,
          videoPackaging: params.videoPackaging,
          captionAccentHex: params.captionAccentHex,
          script,
          analysis,
          ingestion,
          startedAt,
          creativeMode: params.effectiveCreativeMode,
          fastPreview: params.fastPreview,
        })
      } else {
      const jobRow = await prisma.adJob.findUnique({
        where: { id: params.jobDbId },
        select: { metadata: true },
      })
      await updateJob(params.jobDbId, {
        progress: 24,
        script: script as unknown as Prisma.InputJsonValue,
        scenePlan: ((script?.builtScenes ?? script?.scenes ?? []) as unknown) as Prisma.InputJsonValue,
        metadata: mergeMetadataJson(jobRow?.metadata, {
          renderTopVariants: 2,
          renderedVariants: [],
        }),
      })
      await assertJobRunnable(params.jobDbId)

      const renderedVariants: NonNullable<PersistedAdJobMetadata["renderedVariants"]> = []

      let rank1VoicePath: string | undefined
      let rank1CaptionCount = 0
      let rank1FileSize = 0

      const n = slice.length
      for (let i = 0; i < n; i++) {
        const entry = slice[i]!
        const rank = (i + 1) as 1 | 2
        const scriptFor = entry.script as AdScript
        const suffix = `r${rank}-${safeFilePart(entry.preset.id)}`
        try {
          const result = await executeSingleVariantRender({
            jobDbId: params.jobDbId,
            requestId: params.requestId,
            siteUrl: params.siteUrl,
            duration: params.duration,
            tone: params.tone,
            platform: params.platform,
            ultra: params.ultra,
            voice: params.voice,
            voiceMode: params.voiceMode,
            videoPackaging: params.videoPackaging,
            captionAccentHex: params.captionAccentHex,
            script: scriptFor,
            analysis,
            ingestion,
            creativeMode: params.effectiveCreativeMode,
            fileSuffix: suffix,
            fastPreview: params.fastPreview,
            onProgress: p => {
              const base = 24 + (i * 75) / n
              const span = 75 / n
              void updateJob(params.jobDbId, {
                progress: Math.min(99, Math.round(base + (p / 100) * span)),
              })
            },
          })
          const publicUrl = `/generated/${path.basename(result.outputPath)}`
          renderedVariants.push({
            variantId: entry.preset.id,
            rank,
            outputUrl: publicUrl,
            score: entry.scoreResult.totalScore,
            status: "completed",
            fileSizeBytes: result.fileSizeBytes,
          })
          if (rank === 1) {
            rank1VoicePath = result.voicePath
            rank1CaptionCount = result.captionCount
            rank1FileSize = result.fileSizeBytes
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          renderedVariants.push({
            variantId: entry.preset.id,
            rank,
            status: "failed",
            failedReason: msg.slice(0, 240),
          })
          if (rank === 1) {
            throw err
          }
        }
      }

      const primaryRow = renderedVariants.find(r => r.rank === 1 && r.status === "completed")
      if (!primaryRow?.outputUrl) {
        throw new Error("Primary variant render did not produce an output")
      }

      const metaAfter = await prisma.adJob.findUnique({
        where: { id: params.jobDbId },
        select: { metadata: true },
      })

      const finishedAt = new Date()
      await updateJob(params.jobDbId, {
        status: "completed",
        outputUrl: primaryRow.outputUrl,
        progress: 100,
        failedReason: null,
        renderCompletedAt: finishedAt,
        voicePath: rank1VoicePath,
        fileSizeBytes: rank1FileSize,
        resolution: getResolution(params.platform),
        aspectRatio: getAspectRatio(params.platform),
        sceneCount: rank1CaptionCount,
        renderDurationMs: Date.now() - startedAt,
        metadata: mergeMetadataJson(metaAfter?.metadata, {
          renderedVariants,
        }),
      })
      }
    }

    logToolEvent("info", {
      tool: "ads",
      requestId: params.requestId,
      jobId: params.jobDbId,
      userId: params.userId,
      stage: "finalize",
      status: "completed",
      elapsedMs: Date.now() - startedAt,
      message: "Ad generation completed",
    })
  } catch (error) {
    const isCancelled = error instanceof Error && error.message === "JOB_CANCELLED"
    if (!isCancelled) {
      console.error(
        "[ads:worker] runAdGenerationJob error",
        params.requestId,
        params.jobDbId,
        error
      )
    }
    const failureMessage = isCancelled
      ? "Job cancelled by user"
      : humanizeAdWorkerFailure(error)
    logToolEvent("error", {
      tool: "ads",
      requestId: params.requestId,
      jobId: params.jobDbId,
      userId: params.userId,
      stage: "failed",
      status: "failed",
      elapsedMs: Date.now() - startedAt,
      message: failureMessage,
    })

    await updateJob(params.jobDbId, {
      status: "failed",
      failedReason: failureMessage,
      progress: 0,
      renderCompletedAt: new Date()
    })
  }
}

async function runAdRerenderFromVariantJob(params: {
  userId: string
  jobDbId: string
  requestId: string
  siteUrl: string
  sourceJobPublicId: string
  variantId: string
  duration: number
  tone: GenerateBody["tone"]
  platform: GenerateBody["platform"]
  ultra: boolean
  voice: NonNullable<GenerateBody["voice"]>
  voiceMode?: "ai_openai_tts" | "silent_music_only"
  videoPackaging?: VideoPackagingPresetId
  captionAccentHex?: string
  sourceScript: AdScript
  variantPayload: Record<string, unknown>
  creativeMode: NonNullable<GenerateBody["creativeMode"]>
  fastPreview?: boolean
}): Promise<void> {
  const startedAt = Date.now()

  try {
    logToolEvent("info", {
      tool: "ads",
      requestId: params.requestId,
      jobId: params.jobDbId,
      userId: params.userId,
      stage: "start",
      status: "processing",
      message: "Starting ad rerender from stored variant",
    })

    await updateJob(params.jobDbId, {
      progress: 10,
      renderStartedAt: new Date(),
      failedReason: null,
      requestId: params.requestId,
    })
    await assertJobRunnable(params.jobDbId)

    const analysis = await analyzeWebsite(params.siteUrl)

    await updateJob(params.jobDbId, {
      progress: 18,
    })
    await assertJobRunnable(params.jobDbId)

    const ingestion = analysisToSiteIngestion(analysis)

    const merged = assembleAdScriptFromVariant(
      params.sourceScript,
      params.variantPayload,
      params.variantId,
      params.sourceJobPublicId
    )

    await runAdRenderPipelineFromScript({
      userId: params.userId,
      jobDbId: params.jobDbId,
      requestId: params.requestId,
      siteUrl: params.siteUrl,
      duration: params.duration,
      tone: params.tone,
      platform: params.platform,
      ultra: params.ultra,
      voice: params.voice,
      voiceMode: params.voiceMode,
      videoPackaging: params.videoPackaging,
      captionAccentHex: params.captionAccentHex,
      script: merged,
      analysis,
      ingestion,
      startedAt,
      creativeMode: params.creativeMode,
      fastPreview: params.fastPreview === true,
    })

    logToolEvent("info", {
      tool: "ads",
      requestId: params.requestId,
      jobId: params.jobDbId,
      userId: params.userId,
      stage: "finalize",
      status: "completed",
      elapsedMs: Date.now() - startedAt,
      message: "Ad rerender from variant completed",
    })
  } catch (error) {
    const isCancelled = error instanceof Error && error.message === "JOB_CANCELLED"
    if (!isCancelled) {
      console.error(
        "[ads:worker] runAdRerenderFromVariantJob error",
        params.requestId,
        params.jobDbId,
        error
      )
    }
    const failureMessage = isCancelled
      ? "Job cancelled by user"
      : humanizeAdWorkerFailure(error)
    logToolEvent("error", {
      tool: "ads",
      requestId: params.requestId,
      jobId: params.jobDbId,
      userId: params.userId,
      stage: "failed",
      status: "failed",
      elapsedMs: Date.now() - startedAt,
      message: failureMessage,
    })

    await updateJob(params.jobDbId, {
      status: "failed",
      failedReason: failureMessage,
      progress: 0,
      renderCompletedAt: new Date(),
    })
  }
}

router.post(
  "/generate",
  requireAuth,
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

    try {
    const parsed = generateSchema.safeParse(req.body ?? {})

    if (!parsed.success) {
      return toolFail(res, 400, "Invalid request", {
        requestId,
        stage: "validate",
        status: "failed",
        code: "INVALID_INPUT",
        errors: parsed.error.flatten()
      })
    }

    const billingUser = await prisma.user.findUnique({
      where: { id: req.user.id },
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
        stage: "validate",
        status: "failed",
        code: "NOT_FOUND",
      })
    }

    const access = evaluateBillingAccess(billingUser, {
      minPlan: "ELITE",
    })
    if (access.allowed === false) {
      return toolFail(res, access.status, access.message, {
        requestId,
        stage: "validate",
        status: "failed",
        code: "FORBIDDEN",
      })
    }

    let siteUrl: string

    try {
      siteUrl = normalizeUrl(parsed.data.siteUrl)
    } catch (error) {
      return toolFail(
        res,
        400,
        error instanceof Error ? error.message : "Invalid URL",
        {
          requestId,
          stage: "validate",
          status: "failed",
          code: "INVALID_INPUT",
        }
      )
    }

    const data = parsed.data
    const jobId = crypto.randomUUID()

    const adSourceCheck = await validateAdJobSourceRefs(prisma, req.user.id, {
      sourceContentPackId: data.sourceContentPackId,
      sourceGenerationId: data.sourceGenerationId,
    })
    if (adSourceCheck.ok === false) {
      return toolFail(res, 400, adSourceCheck.message, {
        requestId,
        stage: "validate",
        status: "failed",
        code: "INVALID_INPUT",
      })
    }

    let workspaceIdForJob: string | null = null
    if (data.workspaceId) {
      const ws = await prisma.workspace.findFirst({
        where: { id: data.workspaceId, userId: req.user.id },
      })
      if (!ws) {
        return toolFail(res, 400, "Invalid workspace", {
          requestId,
          stage: "validate",
          status: "failed",
          code: "INVALID_INPUT",
        })
      }
      workspaceIdForJob = ws.id
    }

    ensureGeneratedFolder()

    const renderTop = resolveRenderTopVariants(data.renderTopVariants)
    const fastPreview = resolveAdFastPreview(data)

    const studioResolution = resolveStudioCreativeMode(
      data.studioCreativeMode,
      data.creativeMode ?? "cinematic"
    )
    const videoPackaging = resolveVideoPackaging(
      data.videoPackaging,
      studioResolution.defaultVideoPackaging
    )
    const voiceMode = data.voiceMode ?? "ai_openai_tts"

    const job = await adJobCreateWithWorkspaceFallback({
      userId: req.user.id,
      jobId,
      requestId,
      status: "processing",
      platform: data.platform,
      duration: data.duration,
      tone: data.tone,
      progress: 5,
      failedReason: null,
      metadata: {
        siteUrl,
        editingStyle: data.editingStyle ?? "premium",
        ultra: data.ultra ?? false,
        voice: data.voice ?? "alloy",
        creativeMode: studioResolution.effectiveCreativeMode,
        ...(data.studioCreativeMode
          ? { studioCreativeModeId: data.studioCreativeMode }
          : {}),
        videoPackaging,
        voiceMode,
        ...(data.captionAccentHex ? { captionAccentHex: data.captionAccentHex } : {}),
        renderTopVariants: renderTop,
        ...(fastPreview ? { fastPreview: true } : {}),
        ...(data.operatorBrief && data.operatorBrief.length > 0
          ? { operatorBrief: data.operatorBrief.slice(0, 4000) }
          : {}),
      } satisfies PersistedAdJobMetadata as unknown as Prisma.InputJsonValue,
      ...(workspaceIdForJob ? { workspaceId: workspaceIdForJob } : {}),
      ...(data.sourceContentPackId
        ? { sourceContentPackId: data.sourceContentPackId }
        : {}),
      ...(data.sourceGenerationId
        ? { sourceGenerationId: data.sourceGenerationId }
        : {}),
      ...(data.sourceType ? { sourceType: data.sourceType } : {}),
    })

    runLimitedBackgroundJob(
      concurrencyLimit,
      {
        job: "ad_generation",
        requestId,
        jobDbId: job.id,
        userId: req.user!.id,
        publicJobId: jobId,
      },
      async () => {
        await runAdGenerationJob({
          userId: req.user!.id,
          jobDbId: job.id,
          requestId,
          siteUrl,
          duration: data.duration,
          tone: data.tone,
          platform: data.platform,
          editingStyle: data.editingStyle ?? "premium",
          ultra: data.ultra ?? false,
          voice: data.voice ?? "alloy",
          effectiveCreativeMode: studioResolution.effectiveCreativeMode,
          studioPack: {
            studioCreativeDirective: studioResolution.studioCreativeDirective,
            variantPreference: studioResolution.variantPreference,
          },
          videoPackaging,
          voiceMode,
          captionAccentHex: data.captionAccentHex,
          renderTopVariants: renderTop,
          fastPreview,
        })
      }
    )

    return toolOk(res, {
      requestId,
      stage: "analyze",
      status: "queued",
      progress: 5,
      jobId,
      result: {
        jobId,
      },
    }, 202)
    } catch (error: unknown) {
      console.error("[POST /ads/generate]", requestId, error)

      const errName =
        error && typeof error === "object" && "name" in error
          ? String((error as { name?: string }).name)
          : ""
      const prismaCode =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: string }).code ?? "")
          : ""

      if (errName === "PrismaClientInitializationError") {
        return toolFail(
          res,
          503,
          "Database unavailable. Check DATABASE_URL and that PostgreSQL is running.",
          {
            requestId,
            stage: "validate",
            status: "failed",
            code: "RETRY_LATER",
          }
        )
      }

      if (errName === "PrismaClientKnownRequestError") {
        if (prismaCode === "P2002") {
          return toolFail(res, 409, "Duplicate job — retry generation.", {
            requestId,
            stage: "validate",
            status: "failed",
            code: "INVALID_INPUT",
          })
        }
        if (prismaCode === "P2003") {
          return toolFail(res, 400, "Invalid reference (foreign key).", {
            requestId,
            stage: "validate",
            status: "failed",
            code: "INVALID_INPUT",
          })
        }
      }

      const devMessage =
        error instanceof Error && typeof error.message === "string" && error.message.trim()
          ? error.message
          : String(error)

      return toolFail(
        res,
        500,
        process.env.NODE_ENV === "production"
          ? "Unable to start ad generation. Try again or verify the database is migrated and reachable."
          : devMessage,
        {
          requestId,
          stage: "validate",
          status: "failed",
          code: "INTERNAL_ERROR",
        }
      )
    }
  }
)

router.post(
  "/:jobId/cancel",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return toolFail(res, 401, "Unauthorized", {
        requestId: resolveRequestId(req),
        stage: "validate",
        status: "failed",
        code: "UNAUTHORIZED",
      })
    }
    const requestId = resolveRequestId(req)
    const job = await prisma.adJob.findFirst({
      where: {
        jobId: req.params.jobId,
        userId: req.user.id,
      },
    })
    if (!job) {
      return toolFail(res, 404, "Job not found", {
        requestId,
        stage: "finalize",
        status: "failed",
        code: "NOT_FOUND",
      })
    }
    if (job.status === "completed") {
      return toolFail(res, 409, "Completed jobs cannot be cancelled", {
        requestId,
        stage: "finalize",
        status: "completed",
        code: "INVALID_INPUT",
        jobId: req.params.jobId,
      })
    }
    if (job.status === "failed") {
      return toolOk(res, {
        requestId,
        stage: "failed",
        status: "failed",
        progress: job.progress ?? 0,
        jobId: req.params.jobId,
        result: {
          jobId: req.params.jobId,
          cancelled: true,
          reason: job.failedReason || "Job already failed",
        },
      })
    }
    await prisma.adJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        failedReason: "Cancelled by user",
        renderCompletedAt: new Date(),
      },
    })
    logToolEvent("warn", {
      tool: "ads",
      requestId,
      jobId: req.params.jobId,
      userId: req.user.id,
      stage: "failed",
      status: "cancelled",
      message: "Job cancelled by user",
    })
    return toolOk(res, {
      requestId,
      stage: "failed",
      status: "failed",
      progress: 0,
      jobId: req.params.jobId,
      result: {
        jobId: req.params.jobId,
        cancelled: true,
      },
    })
  }
)

router.post(
  "/:jobId/rerender-from-variant",
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

    const sourceScript = scriptJson as AdScript
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
    const voiceMode =
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

router.get(
  "/:jobId",
  requireAuth,
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

    const adminBypass = isAdminUser(req.user.role)

    const job = await prisma.adJob.findFirst({
      where: adminBypass
        ? { jobId: req.params.jobId }
        : {
            jobId: req.params.jobId,
            userId: req.user.id,
          },
    })

    if (!job) {
      return toolFail(res, 404, "Job not found", {
        requestId,
        stage: "finalize",
        status: "failed",
        code: "NOT_FOUND",
      })
    }

    if (
      job.status !== "completed" &&
      job.status !== "failed" &&
      Date.now() - job.updatedAt.getTime() > AD_JOB_STALE_MS
    ) {
      await prisma.adJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          failedReason: "Job expired while processing",
          renderCompletedAt: new Date(),
        },
      })
      return toolFail(res, 410, "Job expired while processing", {
        requestId: job.requestId ?? requestId,
        stage: "failed",
        status: "failed",
        progress: job.progress ?? 0,
        jobId: req.params.jobId,
        code: "EXPIRED",
      })
    }

    if (job.status === "completed" && !job.outputUrl) {
      await prisma.adJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          failedReason: "Job completed without output",
          renderCompletedAt: new Date(),
        },
      })
      return toolFail(res, 502, "Job output missing", {
        requestId: job.requestId ?? requestId,
        stage: "failed",
        status: "failed",
        progress: 100,
        jobId: req.params.jobId,
        code: "PARTIAL_RESULT",
      })
    }

    const stage = mapJobStatusToStage(job.status, job.progress)

    let operatorReview: {
      preferredJobId: string | null
      isPreferred: boolean
      approved: boolean
      favorite: boolean
      rootJobId: string
    } | null = null
    if (adminBypass) {
      try {
        const root = await findRootJobRow(job.jobId)
        const rm = readJobMetadata({ metadata: root.metadata })
        const preferredJobId =
          typeof rm.operatorPreferredJobId === "string"
            ? rm.operatorPreferredJobId
            : null
        const jm = readJobMetadata({ metadata: job.metadata })
        operatorReview = {
          preferredJobId,
          isPreferred: preferredJobId === job.jobId,
          approved: jm.operatorApproved === true,
          favorite: jm.operatorFavorite === true,
          rootJobId: root.jobId,
        }
      } catch {
        operatorReview = null
      }
    }

    return toolOk(res, {
      requestId: job.requestId ?? req.params.jobId,
      stage,
      status:
        job.status === "completed"
          ? "completed"
          : job.status === "failed"
            ? "failed"
            : "processing",
      progress: job.progress ?? 0,
      jobId: req.params.jobId,
      job,
      ...(operatorReview ? { operatorReview } : {}),
      result: {
        job,
      },
      media: job.outputUrl
        ? buildMediaOutput({
            publicPath: job.outputUrl,
            durationSec: job.duration,
            preset: `${job.platform}_preset`,
            qualityScore: Math.min(100, Math.max(1, Math.round((job.progress || 0) * 0.9))),
          })
        : null,
    })
  }
)

export default router

function mapJobStatusToStage(status: string, progress: number | null) {
  if (status === "failed") return "failed" as const
  if (status === "completed") return "finalize" as const
  const value = progress ?? 0
  if (value < 15) return "validate" as const
  if (value < 45) return "analyze" as const
  if (value < 70) return "rank" as const
  return "render" as const
}

async function renderWithRetry(
  operation: () => Promise<string>,
  requestId: string
) {
  let attempt = 0
  let lastError: unknown = null
  while (attempt < MAX_RENDER_ATTEMPTS) {
    attempt += 1
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const errorSummary = error instanceof Error ? error.message : String(error)
      logToolEvent("warn", {
        tool: "ads",
        requestId,
        stage: "render",
        status: "attempt_failed",
        attempt,
        message: errorSummary,
      })
      if (
        attempt >= MAX_RENDER_ATTEMPTS ||
        !isTransientRenderFailure(errorSummary)
      ) {
        break
      }
    }
  }
  throw lastError
}

function isTransientRenderFailure(message: string) {
  const value = message.toLowerCase()
  return (
    value.includes("timeout") ||
    value.includes("temporarily unavailable") ||
    value.includes("eagain") ||
    value.includes("busy")
  )
}