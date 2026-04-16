import fs from "fs"
import path from "path"
import crypto from "crypto"
import { openai } from "../../lib/openai"
import type { AdSiteIngestion, BuiltAdScene, StructuredAdScript } from "./pipeline/types"
import {
  generateStructuredAdScript,
  type AdScriptGenLogContext,
} from "./pipeline/ad.script"
import {
  applyNovaPulseAIQualityPass,
  buildAdScenes,
  type SceneBuildProfile,
} from "./pipeline/scene.builder"
import type {
  AdCreativeMode,
  AdVariantPreset,
  HookPattern,
  NarrativeMode,
  ScriptEmphasis,
} from "./pipeline/ad.variant-presets"
import { defaultVariantCount, getAdVariantPresets } from "./pipeline/ad.variant-presets"
import { detectNovaPulseAIProduct } from "./pipeline/ad.product-profile"
import {
  compareScoreResults,
  evaluateAdVariant,
  selectWinningVariant,
  type AdScoreBreakdown,
  type AdVariantScoreResult,
} from "./pipeline/ad.scoring"

export interface GeneratedScene {
  text: string
  caption: string
  page: string
}

export interface AdVariantSummary {
  id: string
  label: string
  /** Weighted total (1–100), same as `totalScore`. */
  score: number
  totalScore?: number
  hook: string
  cta: string
  narration: string
  builtScenes?: BuiltAdScene[]
  scenes?: GeneratedScene[]
  structured?: StructuredAdScript
  interactionPacingMul?: number
  scoreBreakdown?: AdScoreBreakdown
  explanation?: string
  heuristicNotes?: string[]
  heuristicAdjustmentSummary?: string
  passesThresholds?: boolean
  llmBreakdown?: AdScoreBreakdown
  heuristicBreakdown?: AdScoreBreakdown
  /** Preset arc (stored on new jobs; optional for older payloads). */
  narrativeMode?: NarrativeMode
  emphasis?: ScriptEmphasis
  hookPattern?: HookPattern
}

export interface GeneratedScript {
  hook: string
  scenes: GeneratedScene[]
  cta: string
  narration: string
  structured?: StructuredAdScript
  builtScenes?: BuiltAdScene[]
  /** Set when this script came from multi-variant generation. */
  variantId?: string
  variantLabel?: string
  interactionPacingMul?: number
  adVariants?: AdVariantSummary[]
  selectedVariantId?: string
  /** How the primary variant was chosen (threshold gate vs fallback). */
  scoreSelection?: {
    usedThresholdGate: boolean
    note: string
  }
}

export interface GeneratedAdVariant {
  id: string
  script: GeneratedScript
  voiceoverPath: string
  score: number
  /** Structured score when produced by `evaluateAdVariant` (tie-breaks, debugging). */
  scoreDetail?: AdVariantScoreResult
}

export interface GeneratedAdPackage {
  siteUrl: string
  tone: string
  duration: number
  variants: GeneratedAdVariant[]
  bestVariant: GeneratedAdVariant
  createdAt: number
}

export type VoiceOption =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "sage"
  | "shimmer"
  | "verse"

const TMP_DIR = path.resolve("tmp")
const TTS_MODEL = "gpt-4o-mini-tts"
const DEFAULT_VOICE: VoiceOption = "alloy"

const MAX_VARIANTS = 3
const MAX_SCRIPT_INPUT_CHARS = 4000

const MAX_HOOK_LENGTH = 90
const MAX_CTA_LENGTH = 160
const MAX_SCENE_TEXT_LENGTH = 420
const MAX_CAPTION_LENGTH = 72
const MIN_TTS_FILE_SIZE_BYTES = 8000

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true })
  }
}

function sanitize(input: string) {
  return String(input ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function sceneProfileFromPreset(
  preset: AdVariantPreset,
  creativeMode: AdCreativeMode = "cinematic",
  ingestion?: AdSiteIngestion
): SceneBuildProfile {
  const pacing =
    preset.emphasis === "speed"
      ? "snappy"
      : preset.emphasis === "proof"
        ? "deliberate"
        : "standard"
  let out: SceneBuildProfile = {
    narrativeMode: preset.narrativeMode,
    emphasis: preset.emphasis,
    pacing,
  }
  if (creativeMode === "ugc_social") {
    if (out.pacing === "deliberate") {
      out = { ...out, pacing: "standard" }
    } else {
      out = { ...out, pacing: "snappy" }
    }
  }
  if (ingestion && detectNovaPulseAIProduct(ingestion)) {
    out = { ...out, creatorProductDemo: true }
  }
  return out
}

function sanitizeCaption(text: string) {
  let cleaned = sanitize(text)

  if (!cleaned) return ""

  cleaned = cleaned.replace(/[.!?]+$/g, "")

  if (cleaned.length > MAX_CAPTION_LENGTH) {
    cleaned = cleaned.slice(0, MAX_CAPTION_LENGTH - 3) + "..."
  }

  return cleaned
}

function sanitizeNarration(text: string, max: number) {
  const cleaned = sanitize(text)

  if (!cleaned) return ""

  if (cleaned.length <= max) return cleaned

  return cleaned.slice(0, max - 3) + "..."
}

type BrandContext = {
  brandName?: string
  headline?: string
  keyBenefits?: string[]
}

export function legacyBrandToIngestion(siteUrl: string, brand?: BrandContext): AdSiteIngestion {
  const benefits = brand?.keyBenefits ?? []
  return {
    siteUrl,
    brandName: brand?.brandName,
    headline: brand?.headline,
    headings: brand?.headline ? [brand.headline] : [],
    keyParagraphs: [],
    valueProps: benefits,
    features: benefits,
    tone: "confident",
    visuals: [],
  }
}

export async function generateAdScript(
  siteUrl: string,
  tone: string,
  duration: number,
  platform: string = "tiktok",
  ingestion: AdSiteIngestion,
  preset?: AdVariantPreset,
  variantIndex = 0,
  creativeMode: AdCreativeMode = "cinematic",
  scriptGenLog?: AdScriptGenLogContext,
  studioCreativeDirective?: string
): Promise<GeneratedScript> {
  const genOpts = preset
    ? {
        hookPattern: preset.hookPattern,
        emphasis: preset.emphasis,
        narrativeMode: preset.narrativeMode,
        toneModifier: preset.toneModifier,
        variantTemperatureBump: variantIndex * 0.035,
        creativeMode,
        ...(studioCreativeDirective?.trim()
          ? { studioCreativeDirective: studioCreativeDirective.trim() }
          : {}),
      }
    : {
        creativeMode,
        ...(studioCreativeDirective?.trim()
          ? { studioCreativeDirective: studioCreativeDirective.trim() }
          : {}),
      }

  const structured = await generateStructuredAdScript(
    ingestion,
    tone,
    duration,
    platform,
    genOpts,
    scriptGenLog
  )
  const buildProfile = preset
    ? sceneProfileFromPreset(preset, creativeMode, ingestion)
    : creativeMode === "ugc_social"
      ? {
          pacing: "snappy" as const,
          ...(detectNovaPulseAIProduct(ingestion) ? { creatorProductDemo: true as const } : {}),
        }
      : detectNovaPulseAIProduct(ingestion)
        ? { creatorProductDemo: true as const }
        : undefined
  let builtScenes = buildAdScenes(structured, ingestion, duration, buildProfile)
  if (detectNovaPulseAIProduct(ingestion)) {
    builtScenes = applyNovaPulseAIQualityPass(builtScenes, duration, ingestion)
  }

  const scenes: GeneratedScene[] = builtScenes.map(s => ({
    text: sanitizeNarration(s.text, MAX_SCENE_TEXT_LENGTH),
    caption: sanitizeCaption(s.caption),
    page: sanitize(s.page || "") || "/",
  }))

  const hook = sanitizeNarration(structured.hook, MAX_HOOK_LENGTH)
  const cta = sanitizeNarration(structured.cta, MAX_CTA_LENGTH)

  const narration = builtScenes.map(s => s.text).filter(Boolean).join(". ")

  return {
    hook,
    scenes,
    cta,
    narration: narration || [hook, cta].filter(Boolean).join(". "),
    structured,
    builtScenes,
    variantId: preset?.id,
    variantLabel: preset?.label,
    interactionPacingMul: preset?.interactionPacingMul,
  }
}

/**
 * Generate multiple performance variants, score them, return the best as primary
 * and attach all copies to `primary.adVariants` for storage / A/B.
 */
export async function generateAdScriptsPerformancePack(
  siteUrl: string,
  tone: string,
  duration: number,
  platform: string,
  ingestion: AdSiteIngestion,
  creativeMode: AdCreativeMode = "cinematic",
  scriptGenLog?: AdScriptGenLogContext,
  packOptions?: {
    studioCreativeDirective?: string
    variantPreference?: string[]
  }
): Promise<{
  primary: GeneratedScript
  variants: Array<{
    preset: AdVariantPreset
    script: GeneratedScript
    score: number
    scoreResult: AdVariantScoreResult
  }>
  scored: Array<{
    preset: AdVariantPreset
    script: GeneratedScript
    scoreResult: AdVariantScoreResult
    orderIndex: number
  }>
}> {
  const count = defaultVariantCount()
  const presets = getAdVariantPresets(count, creativeMode, packOptions?.variantPreference)
  const generated: Array<{ preset: AdVariantPreset; script: GeneratedScript }> = []
  for (let i = 0; i < presets.length; i++) {
    const preset = presets[i]!
    try {
      const script = await generateAdScript(
        siteUrl,
        tone,
        duration,
        platform,
        ingestion,
        preset,
        i,
        creativeMode,
        scriptGenLog,
        packOptions?.studioCreativeDirective
      )
      generated.push({ preset, script })
    } catch (error) {
      console.error("Ad variant generation failed:", preset.id, error)
    }
  }

  if (!generated.length) {
    throw new Error("All ad variants failed to generate")
  }

  const allHooks = generated.map(g => g.script.hook)
  const allCtas = generated.map(g => g.script.cta)
  const allNarr = generated.map(g => g.script.narration)

  const scored: Array<{
    preset: AdVariantPreset
    script: GeneratedScript
    scoreResult: AdVariantScoreResult
    orderIndex: number
  }> = []

  for (let i = 0; i < generated.length; i++) {
    const { preset, script } = generated[i]!
    const ctx = {
      siblingHooks: allHooks.filter((_, j) => j !== i),
      siblingCtas: allCtas.filter((_, j) => j !== i),
      siblingNarrations: allNarr.filter((_, j) => j !== i),
    }
    const scoreResult = await evaluateAdVariant(script, ingestion, duration, {
      ...ctx,
      creativeMode,
    })
    scored.push({ preset, script, scoreResult, orderIndex: i })
  }

  const { winner, usedThresholdGate } = selectWinningVariant(scored)
  const primary: GeneratedScript = { ...winner.script }

  const adVariants: AdVariantSummary[] = scored.map(r => ({
    id: r.preset.id,
    label: r.preset.label,
    score: r.scoreResult.totalScore,
    totalScore: r.scoreResult.totalScore,
    hook: r.script.hook,
    cta: r.script.cta,
    narration: r.script.narration,
    builtScenes: r.script.builtScenes,
    scenes: r.script.scenes,
    structured: r.script.structured,
    interactionPacingMul: r.preset.interactionPacingMul,
    narrativeMode: r.preset.narrativeMode,
    emphasis: r.preset.emphasis,
    hookPattern: r.preset.hookPattern,
    scoreBreakdown: r.scoreResult.breakdown,
    explanation: r.scoreResult.explanation,
    heuristicNotes: r.scoreResult.heuristicNotes,
    heuristicAdjustmentSummary: r.scoreResult.heuristicAdjustmentSummary,
    passesThresholds: r.scoreResult.passesThresholds,
    llmBreakdown: r.scoreResult.llmBreakdown,
    heuristicBreakdown: r.scoreResult.heuristicBreakdown,
  }))

  primary.adVariants = adVariants
  primary.selectedVariantId = winner.preset.id
  primary.variantId = winner.preset.id
  primary.variantLabel = winner.preset.label
  primary.interactionPacingMul = winner.preset.interactionPacingMul
  primary.scoreSelection = {
    usedThresholdGate,
    note: usedThresholdGate
      ? "Primary chosen from variants meeting hook/payoff/CTA floors (highest total among eligible)."
      : "No variant met all floors; primary is highest weighted total (review breakdowns).",
  }

  const variants = scored.map(r => ({
    preset: r.preset,
    script: r.script,
    score: r.scoreResult.totalScore,
    scoreResult: r.scoreResult,
  }))

  return { primary, variants, scored }
}

export async function generateVoiceover(
  script: string,
  voice: VoiceOption = DEFAULT_VOICE
): Promise<string> {
  ensureTmpDir()

  const input = script.slice(0, MAX_SCRIPT_INPUT_CHARS)

  const speech = await openai.audio.speech.create({
    model: TTS_MODEL,
    voice,
    input
  })

  const buffer = Buffer.from(await speech.arrayBuffer())
  const filename = `voice-${crypto.randomUUID()}.mp3`
  const filePath = path.join(TMP_DIR, filename)

  await fs.promises.writeFile(filePath, buffer)

  const stats = await fs.promises.stat(filePath)

  if (stats.size < MIN_TTS_FILE_SIZE_BYTES) {
    throw new Error("Voiceover too small")
  }

  return filePath
}

export async function generateAdPackage(
  siteUrl: string,
  tone: string,
  duration: number,
  platform: string = "tiktok",
  brand?: BrandContext
): Promise<GeneratedAdPackage> {
  const voiceOptions: VoiceOption[] = ["alloy", "ash", "sage"]

  const ingestion = legacyBrandToIngestion(siteUrl, brand)

  const scripts: GeneratedScript[] = []
  for (let i = 0; i < MAX_VARIANTS; i++) {
    try {
      scripts.push(await generateAdScript(siteUrl, tone, duration, platform, ingestion))
    } catch (error) {
      console.error("Variant generation failed", error)
    }
  }

  if (!scripts.length) {
    throw new Error("Ad generation failed")
  }

  const hooks = scripts.map(s => s.hook)
  const ctas = scripts.map(s => s.cta)
  const narr = scripts.map(s => s.narration)

  const variants: GeneratedAdVariant[] = []
  for (let i = 0; i < scripts.length; i++) {
    try {
      const script = scripts[i]!
      const scoreDetail = await evaluateAdVariant(script, ingestion, duration, {
        siblingHooks: hooks.filter((_, j) => j !== i),
        siblingCtas: ctas.filter((_, j) => j !== i),
        siblingNarrations: narr.filter((_, j) => j !== i),
      })
      const voiceoverPath = await generateVoiceover(
        script.narration,
        voiceOptions[i % voiceOptions.length]
      )
      variants.push({
        id: crypto.randomUUID(),
        script,
        voiceoverPath,
        score: scoreDetail.totalScore,
        scoreDetail,
      })
    } catch (error) {
      console.error("Variant scoring/voice failed", error)
    }
  }

  if (!variants.length) {
    throw new Error("Ad generation failed")
  }

  const ordered = variants.map((v, orderIndex) => ({ v, orderIndex }))
  ordered.sort((a, b) =>
    compareScoreResults(
      a.v.scoreDetail!,
      b.v.scoreDetail!,
      a.orderIndex,
      b.orderIndex
    )
  )

  const sorted = ordered.map(x => x.v)

  return {
    siteUrl,
    tone,
    duration,
    variants: sorted,
    bestVariant: sorted[0]!,
    createdAt: Date.now()
  }
}