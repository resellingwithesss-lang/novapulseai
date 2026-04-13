/**
 * Hybrid heuristic + LLM scoring for ad variant selection (marketing principles).
 */

import { z } from "zod"
import { openai } from "../../../lib/openai"
import type { AdSiteIngestion, BuiltAdScene, StructuredAdScript } from "./types"
import { detectNovaPulseAIProduct } from "./ad.product-profile"

/** Minimal script shape for scoring (avoids circular import with ads.service). */
export interface ScriptForScoring {
  hook: string
  cta: string
  narration: string
  structured?: StructuredAdScript
  builtScenes?: BuiltAdScene[]
}

const SCORING_MODEL = "gpt-4o-mini"
const MAX_ATTEMPTS = 2

export interface AdScoreBreakdown {
  hook: number
  clarity: number
  specificity: number
  novelty: number
  payoff: number
  pacing: number
  cta: number
}

export interface AdVariantScoreResult {
  totalScore: number
  breakdown: AdScoreBreakdown
  /** Short marketer-style rationale. */
  explanation: string
  /** Heuristic-only sub-scores (0–100) before blend. */
  heuristicBreakdown: AdScoreBreakdown
  /** Raw LLM dimension scores (0–100) before blend. */
  llmBreakdown: AdScoreBreakdown
  /** Deterministic check labels (e.g. time_bound_hook, cta_too_generic). */
  heuristicNotes: string[]
  /** Compact summary for logs / UI. */
  heuristicAdjustmentSummary: string
  /** True if this variant passed minimum floors for hook, payoff, CTA. */
  passesThresholds: boolean
}

export type VariantScoreContext = {
  siblingHooks?: string[]
  siblingCtas?: string[]
  siblingNarrations?: string[]
  /** When set, scoring favors hook/payoff/pacing for feed-native scripts. */
  creativeMode?: "cinematic" | "ugc_social"
}

const WEIGHTS: Record<keyof AdScoreBreakdown, number> = {
  hook: 0.2,
  clarity: 0.11,
  specificity: 0.14,
  novelty: 0.1,
  payoff: 0.19,
  pacing: 0.08,
  cta: 0.18,
}

/** Slightly higher weight on hook, payoff, pacing for UGC / short-form selection. */
const UGC_WEIGHTS: Record<keyof AdScoreBreakdown, number> = {
  hook: 0.22,
  clarity: 0.1,
  specificity: 0.13,
  novelty: 0.08,
  payoff: 0.21,
  pacing: 0.11,
  cta: 0.15,
}

function scoringWeights(
  mode?: VariantScoreContext["creativeMode"]
): Record<keyof AdScoreBreakdown, number> {
  return mode === "ugc_social" ? UGC_WEIGHTS : WEIGHTS
}

/** Minimum dimension scores (0–100) for eligibility as primary winner. */
export const SCORE_FLOORS = {
  hook: 52,
  payoff: 48,
  cta: 50,
} as const

const dim = z.coerce.number().min(0).max(100)

const llmResponseSchema = z.object({
  hook: dim,
  clarity: dim,
  specificity: dim,
  novelty: dim,
  payoff: dim,
  pacing: dim,
  cta: dim,
  explanation: z.string().max(900),
})

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim()
}

function tokenSet(text: string): Set<string> {
  return new Set(
    norm(text)
      .split(/[^a-z0-9]+/i)
      .filter(w => w.length > 2)
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1
  let inter = 0
  for (const x of a) {
    if (b.has(x)) inter++
  }
  const u = a.size + b.size - inter
  return u ? inter / u : 0
}

function genericHookPenalty(hook: string): { score: number; notes: string[] } {
  const h = norm(hook)
  const notes: string[] = []
  let p = 0
  if (h.length < 18) {
    p += 22
    notes.push("hook_too_short")
  }
  if (/^(try|discover|introducing|meet|welcome to)\b/.test(h)) {
    if (!/\bnovapulseai\b/.test(h)) {
      p += 14
      notes.push("generic_opening_template")
    }
  }
  if (/^(get started|sign up|click here)\b/.test(h)) {
    p += 25
    notes.push("weak_hook_cta_language")
  }
  if (/something (amazing|incredible|revolutionary)/.test(h)) {
    p += 12
    notes.push("hype_without_substance")
  }
  return { score: clamp(100 - p, 15, 100), notes }
}

function genericCtaPenalty(cta: string): { score: number; notes: string[] } {
  const c = norm(cta)
  const notes: string[] = []
  let p = 0
  if (/^(get started|sign up|sign up now|learn more|click here)\.?$/i.test(c.trim())) {
    p += 45
    notes.push("cta_too_generic")
  }
  if (c.length < 12) {
    p += 18
    notes.push("cta_too_short")
  }
  if (/\b(now|today|seconds|minutes|free|first)\b/.test(c)) {
    p -= 12
    notes.push("cta_specificity_boost")
  }
  if (/\d/.test(c)) {
    p -= 10
    notes.push("cta_numeric_anchor")
  }
  return { score: clamp(100 - p, 10, 100), notes }
}

function hookStrengthHeuristic(hook: string): { score: number; notes: string[] } {
  const h = norm(hook)
  const notes: string[] = []
  let s = 52
  if (/\?/.test(h)) {
    s += 8
    notes.push("hook_question_tension")
  }
  if (/\b(you|your|still|manually|without|stop|replace)\b/.test(h)) {
    s += 10
    notes.push("hook_second_person_or_contrast")
  }
  if (/\b(replace|launch|generate|ship|cut|drop|automate|save|build)\b/.test(h)) {
    s += 8
    notes.push("strong_action_verbs")
  }
  if (/\d+\s*(sec|second|min|minute|hour|day)|under\s+a\s+minute|30\s*sec/i.test(h)) {
    s += 12
    notes.push("time_bound_hook")
  }
  const gen = genericHookPenalty(hook)
  const severe =
    gen.notes.includes("weak_hook_cta_language") ||
    gen.notes.includes("hook_too_short") ||
    gen.notes.includes("generic_opening_template")
  /** Softer than 50/50: keep strong-signal hooks from being dragged to the penalty mean. */
  const blended = severe ? 0.66 * s + 0.34 * gen.score : 0.78 * s + 0.22 * gen.score
  notes.push(...gen.notes)
  return { score: clamp(blended, 5, 100), notes }
}

function specificityHeuristic(script: ScriptForScoring, ingestion: AdSiteIngestion): { score: number; notes: string[] } {
  const notes: string[] = []
  const narr = norm(script.narration || "")
  const pool = [
    ingestion.headline,
    ingestion.brandName,
    ...ingestion.headings.slice(0, 8),
    ...ingestion.valueProps.slice(0, 6),
    ...ingestion.features.slice(0, 8),
  ]
    .filter(Boolean)
    .join(" ")
  const narrTok = tokenSet(narr)
  const siteTok = tokenSet(pool)
  const jac = jaccard(narrTok, siteTok)
  let s = 40 + jac * 55
  if (jac > 0.12) notes.push("grounded_in_site_lexicon")
  else notes.push("thin_site_overlap")
  if (ingestion.ctaTexts?.some(ct => narr.includes(norm(ct)))) {
    s += 8
    notes.push("echoes_site_cta")
  }
  return { score: clamp(s, 5, 100), notes }
}

function payoffHeuristic(
  structured: StructuredAdScript | undefined,
  scenes: BuiltAdScene[] | undefined,
  ingestion?: AdSiteIngestion
): { score: number; notes: string[] } {
  const notes: string[] = []
  const payoffText = norm(structured?.payoff || "")
  let s = 48
  if (payoffText.length < 25) {
    s -= 22
    notes.push("payoff_too_thin")
  }
  if (/\b(clip|clips|repurpose|publish|post|ready|batch|multiple|automat)\b/.test(payoffText)) {
    s += 10
    notes.push("creator_output_language")
  }
  if (/\b(result|output|save|faster|before|after|without|ship|done|ready|proof)\b/.test(payoffText)) {
    s += 14
    notes.push("outcome_language")
  }
  if (/\b(you|your)\b/.test(payoffText)) {
    s += 6
    notes.push("payoff_you_focused")
  }
  const payoffScene = scenes?.find(x => x.type === "payoff")
  if (payoffScene && payoffScene.duration < 1.25) {
    s -= 10
    notes.push("payoff_scene_too_brief")
  }
  if (scenes?.[0]?.type === "hook" && scenes[1]?.type === "payoff") {
    s += 12
    notes.push("result_first_structure")
  }
  if (ingestion && detectNovaPulseAIProduct(ingestion) && scenes?.length) {
    const pi = scenes.findIndex(x => x.type === "payoff")
    if (pi >= 0 && pi <= 2) {
      s += 9
      notes.push("vf_early_payoff_beat")
    }
    if (scenes.some(x => x.type === "transformation_proof")) {
      s += 11
      notes.push("vf_transformation_scene_present")
    }
    if (scenes.some(x => x.type === "demo_auth")) {
      s += 8
      notes.push("vf_logged_in_demo_beat")
    }
    const xf = scenes.find(x => x.type === "transformation_proof")
    if (xf && xf.duration < 1.35) {
      s -= 5
      notes.push("vf_transformation_scene_brief")
    }
    if (xf && xf.duration >= 2.35) {
      s += 5
      notes.push("vf_transformation_rich_dwell")
    }
    if (payoffScene && payoffScene.duration >= 1.45) {
      s += 4
      notes.push("vf_payoff_dwell")
    }
  }
  return { score: clamp(s, 5, 100), notes }
}

function pacingHeuristic(scenes: BuiltAdScene[] | undefined, duration: number): { score: number; notes: string[] } {
  const notes: string[] = []
  if (!scenes?.length) return { score: 55, notes: ["no_scenes"] }
  const hook = scenes.find(s => s.type === "hook")
  const total = scenes.reduce((a, s) => a + s.duration, 0) || 1
  const hookRatio = hook ? hook.duration / total : 0
  let s = 62
  if (hookRatio > 0.32) {
    s -= 18
    notes.push("hook_overweighted_vs_total")
  }
  if (hookRatio < 0.05) {
    s -= 14
    notes.push("hook_underweighted")
  }
  const spread = scenes.map(x => x.duration).sort((a, b) => a - b)
  const variance =
    spread.length > 1 ? spread[spread.length - 1]! - spread[0]! : 0
  if (variance < 0.25 && scenes.length > 4) {
    s -= 8
    notes.push("flat_scene_pacing")
  }
   if (duration >= 20 && hookRatio >= 0.07 && hookRatio <= 0.22) {
    s += 6
    notes.push("pacing_sane_for_length")
  }
  const xf = scenes.find(x => x.type === "transformation_proof")
  if (xf) {
    const xr = xf.duration / total
    if (xr >= 0.14) {
      s += 12
      notes.push("transformation_proof_dominant")
    } else if (xr >= 0.11) {
      s += 9
      notes.push("transformation_proof_dwell")
    } else if (xr < 0.07) {
      s -= 5
      notes.push("transformation_proof_underweighted")
    }
  }
  return { score: clamp(s, 5, 100), notes }
}

function clarityHeuristic(script: ScriptForScoring): { score: number; notes: string[] } {
  const text = norm(script.narration || "")
  const notes: string[] = []
  const sentences = text.split(/[.!?]+/).filter(Boolean)
  const avgLen =
    sentences.length > 0
      ? sentences.reduce((a, s) => a + s.split(/\s+/).length, 0) / sentences.length
      : 0
  let s = 58
  if (avgLen > 28) {
    s -= 12
    notes.push("sentences_too_long")
  }
  if (avgLen < 6 && sentences.length > 2) {
    s += 6
    notes.push("punchy_clauses")
  }
  const buzz = (text.match(/\b(leverage|synergy|innovative|world-?class|cutting-?edge)\b/gi) || []).length
  if (buzz > 1) {
    s -= buzz * 6
    notes.push("corporate_buzzwords")
  }
  return { score: clamp(s, 5, 100), notes }
}

function noveltyHeuristic(hook: string, ctx: VariantScoreContext): { score: number; notes: string[] } {
  const notes: string[] = []
  const h = norm(hook)
  let s = 62
  const sibs = (ctx.siblingHooks || []).map(norm).filter(x => x && x !== h)
  for (const o of sibs) {
    if (h === o || (h.length > 12 && o.includes(h.slice(0, 12)))) {
      s -= 22
      notes.push("hook_near_duplicate_sibling")
      break
    }
    const jac = jaccard(tokenSet(h), tokenSet(o))
    if (jac > 0.45) {
      s -= 14
      notes.push("hook_high_overlap_sibling")
    }
  }
  return { score: clamp(s, 5, 100), notes }
}

function ctaStrengthHeuristic(cta: string): { score: number; notes: string[] } {
  const base = genericCtaPenalty(cta)
  const h = norm(cta)
  let s = base.score
  const notes = [...base.notes]
  if (/\b(try|see|get|launch|watch|build|start)\b.*\b(first|now|free|today)\b/.test(h)) {
    s += 10
    notes.push("cta_action_plus_urgency")
  }
  return { score: clamp(s, 5, 100), notes }
}

function novaPulseAICreatorAlignmentDelta(script: ScriptForScoring): {
  hook: number
  payoff: number
  specificity: number
  clarity: number
} {
  const hooksCombined = norm([script.structured?.hook, script.hook].join(" "))
  const hookOutcomeExtra = /\b(clip|clips|batch|ready|publish|post|outputs?|ship|multiple)\b/.test(
    hooksCombined
  )
    ? 4
    : 0

  const blob = norm(
    [
      script.hook,
      script.cta,
      script.structured?.hook,
      script.structured?.problem,
      script.structured?.solution,
      ...(script.structured?.features ?? []),
      script.structured?.payoff,
    ].join(" ")
  )

  const multiClip =
    /\b(multiple|batch|many|several|dozens?|set of|stack(ed)?)\b/.test(blob) &&
    /\b(clip|clips|video|videos|shorts?|reels?|outputs?|versions?|variation|renders?)\b/.test(blob)
  const repurpose =
    /\b(repurpos|repackag|turn it into|one source|long[\s-]?form|break down|atomiz|splitt?\s+into|clip out)\b/i.test(
      blob
    )
  const automate =
    /\b(automat|workflow|pipeline|less manual|without the|busywork|hands[\s-]?off)\b/i.test(blob)
  const publish =
    /\b(publish|post|ready[\s-]?to[\s-]?post|feed|platform|ship)\b/i.test(blob)

  let cats = 0
  if (multiClip) cats++
  if (repurpose) cats++
  if (automate) cats++
  if (publish) cats++

  if (cats >= 3)
    return { hook: 5 + hookOutcomeExtra, payoff: 12, specificity: 10, clarity: 4 }
  if (cats === 2)
    return { hook: 4 + hookOutcomeExtra, payoff: 8, specificity: 7, clarity: 3 }
  if (cats === 1)
    return { hook: 2 + hookOutcomeExtra, payoff: 4, specificity: 3, clarity: 1 }
  return { hook: -1 + hookOutcomeExtra, payoff: -6, specificity: -5, clarity: 0 }
}

function transformationProofVisualRichBonus(scenes: BuiltAdScene[] | undefined): {
  payoff: number
  pacing: number
  novelty: number
  notes: string[]
} {
  if (!scenes?.length) return { payoff: 0, pacing: 0, novelty: 0, notes: [] }
  const xf = scenes.find(s => s.type === "transformation_proof")
  if (!xf) return { payoff: 0, pacing: 0, novelty: 0, notes: [] }
  const total = scenes.reduce((a, s) => a + s.duration, 0) || 1
  const share = xf.duration / total
  const notes: string[] = []
  let payoff = 0
  let pacing = 0
  let novelty = 0
  if (xf.duration >= 2.4 && share >= 0.12) {
    payoff += 4
    pacing += 3
    novelty += 2
    notes.push("xf_magic_beat_rich")
  }
  if (share >= 0.15) {
    payoff += 3
    pacing += 3
    notes.push("xf_screen_share_hero")
  }
  return { payoff, pacing, novelty, notes }
}

function novaPulseAIWorkflowWithoutOutcomesPenalty(script: ScriptForScoring): {
  payoffDelta: number
  pacingDelta: number
  notes: string[]
} {
  const blob = norm(
    [
      script.structured?.solution,
      script.structured?.problem,
      ...(script.structured?.features ?? []),
    ].join(" ")
  )
  const workflowHits = (
    blob.match(/\b(workflow|dashboard|interface|screen|tabs?|panel|navigate|sidebar)\b/gi) || []
  ).length
  const outcomeHits = (
    blob.match(
      /\b(clip|clips|output|outputs|batch|publish|post|ready|export|thumbnail|grid|variants?|repurpose)\b/gi
    ) || []
  ).length
  if (workflowHits >= 3 && outcomeHits <= 1) {
    return {
      payoffDelta: -8,
      pacingDelta: -5,
      notes: ["vf_workflow_heavy_light_outcomes"],
    }
  }
  return { payoffDelta: 0, pacingDelta: 0, notes: [] }
}

function buildHeuristicBreakdown(
  script: ScriptForScoring,
  ingestion: AdSiteIngestion,
  ctx: VariantScoreContext,
  durationSeconds: number
): { breakdown: AdScoreBreakdown; notes: string[] } {
  const hookH = hookStrengthHeuristic(script.hook)
  const ctaH = ctaStrengthHeuristic(script.cta)
  const specH = specificityHeuristic(script, ingestion)
  const payH = payoffHeuristic(script.structured, script.builtScenes, ingestion)
  const paceH = pacingHeuristic(script.builtScenes, durationSeconds)
  const clarH = clarityHeuristic(script)
  const novH = noveltyHeuristic(script.hook, ctx)

  let allNotes = [
    ...hookH.notes,
    ...ctaH.notes,
    ...specH.notes,
    ...payH.notes,
    ...paceH.notes,
    ...clarH.notes,
    ...novH.notes,
  ]

  let breakdown: AdScoreBreakdown = {
    hook: hookH.score,
    clarity: clarH.score,
    specificity: specH.score,
    novelty: novH.score,
    payoff: payH.score,
    pacing: paceH.score,
    cta: ctaH.score,
  }

  if (detectNovaPulseAIProduct(ingestion)) {
    const d = novaPulseAICreatorAlignmentDelta(script)
    breakdown = {
      hook: clamp(breakdown.hook + d.hook, 5, 100),
      clarity: clamp(breakdown.clarity + d.clarity, 5, 100),
      specificity: clamp(breakdown.specificity + d.specificity, 5, 100),
      novelty: breakdown.novelty,
      payoff: clamp(breakdown.payoff + d.payoff, 5, 100),
      pacing: breakdown.pacing,
      cta: breakdown.cta,
    }
    if (d.payoff > 0) allNotes.push("novapulseai_creator_alignment_boost")
    if (d.payoff < 0) allNotes.push("novapulseai_creator_alignment_weak")

    const wf = novaPulseAIWorkflowWithoutOutcomesPenalty(script)
    if (wf.payoffDelta !== 0 || wf.pacingDelta !== 0) {
      breakdown = {
        ...breakdown,
        payoff: clamp(breakdown.payoff + wf.payoffDelta, 5, 100),
        pacing: clamp(breakdown.pacing + wf.pacingDelta, 5, 100),
      }
      allNotes.push(...wf.notes)
    }

    const xb = transformationProofVisualRichBonus(script.builtScenes)
    if (xb.payoff !== 0 || xb.pacing !== 0 || xb.novelty !== 0) {
      breakdown = {
        ...breakdown,
        payoff: clamp(breakdown.payoff + xb.payoff, 5, 100),
        pacing: clamp(breakdown.pacing + xb.pacing, 5, 100),
        novelty: clamp(breakdown.novelty + xb.novelty, 5, 100),
      }
      allNotes.push(...xb.notes)
    }
  }

  return {
    breakdown,
    notes: [...new Set(allNotes)],
  }
}

function blendBreakdown(
  llm: AdScoreBreakdown,
  heur: AdScoreBreakdown
): AdScoreBreakdown {
  const blend = (a: number, b: number, wL: number) =>
    clamp(Math.round(a * wL + b * (1 - wL)), 1, 100)
  return {
    hook: blend(llm.hook, heur.hook, 0.55),
    clarity: blend(llm.clarity, heur.clarity, 0.62),
    specificity: blend(llm.specificity, heur.specificity, 0.5),
    novelty: blend(llm.novelty, heur.novelty, 0.58),
    payoff: blend(llm.payoff, heur.payoff, 0.52),
    pacing: blend(llm.pacing, heur.pacing, 0.48),
    cta: blend(llm.cta, heur.cta, 0.5),
  }
}

function weightedTotal(
  b: AdScoreBreakdown,
  mode?: VariantScoreContext["creativeMode"]
): number {
  const w = scoringWeights(mode)
  let t = 0
  for (const k of Object.keys(w) as (keyof AdScoreBreakdown)[]) {
    t += w[k] * b[k]
  }
  return clamp(Math.round(t), 1, 100)
}

function passesFloors(b: AdScoreBreakdown): boolean {
  return (
    b.hook >= SCORE_FLOORS.hook &&
    b.payoff >= SCORE_FLOORS.payoff &&
    b.cta >= SCORE_FLOORS.cta
  )
}

async function llmEvaluateDimensions(
  script: ScriptForScoring,
  ingestion: AdSiteIngestion,
  durationSeconds: number,
  creativeMode?: VariantScoreContext["creativeMode"]
): Promise<{ breakdown: AdScoreBreakdown; explanation: string } | null> {
  const siteHint = [
    ingestion.brandName,
    ingestion.headline,
    ingestion.valueProps.slice(0, 3).join("; "),
  ]
    .filter(Boolean)
    .join(" | ")

  const narr = (script.narration || "").slice(0, 3500)
  const structured = script.structured

  const ugcNote =
    creativeMode === "ugc_social"
      ? `

UGC / SHORT-FORM LENS: Reward scripts that feel native to TikTok/Reels (punchy, direct, creator-voice). Penalize polished-corporate tone and slow-burn hooks. Favor strong first-2s energy and clear outcome language.`
      : ""

  const vfNote = detectNovaPulseAIProduct(ingestion)
    ? `

NovaPulseAI / CREATOR LENS: This ad is for NovaPulseAI — a creator-focused system for repurposing, automation, and multiple publish-ready clips (not generic enterprise workflow software). Reward copy that clearly lands multi-clip / publish-ready outcomes, **early payoff or outcome-led hooks**, and a believable **transformation** (one source → many outputs). Penalize generic "efficiency," slow UI walkthroughs, or workflow-first scripts with weak visible outcomes.`
    : ""

  const user = `You are a senior performance marketer grading ONE short video ad script for paid social.

Score each dimension 0-100 (integers). Use strict standards: generic = low, concrete + emotional + clear = high.
${ugcNote}${vfNote}

Dimensions:
- hook: attention in first 2-3 seconds; curiosity/tension; NOT generic platitudes
- clarity: immediately understandable message; low jargon
- specificity: references real product/workflow details (align with SITE FACTS below when relevant)
- novelty: feels distinct vs typical SaaS ads; penalize template phrases
- payoff: strength and visibility of outcome/transformation
- pacing_fit: does implied rhythm fit ~${durationSeconds}s short-form (not overstuffed, not empty)
- cta: clear, actionable, outcome-driven; penalize vague "get started" alone

SITE FACTS (for specificity check only): ${siteHint || "thin"}

STRUCTURED FIELDS:
hook: ${structured?.hook ?? ""}
problem: ${structured?.problem ?? ""}
solution: ${structured?.solution ?? ""}
features: ${(structured?.features ?? []).join(" | ")}
payoff: ${structured?.payoff ?? ""}
cta: ${structured?.cta ?? ""}

FULL NARRATION:
${narr}

Return JSON ONLY:
{"hook":0-100,"clarity":0-100,"specificity":0-100,"novelty":0-100,"payoff":0-100,"pacing":0-100,"cta":0-100,"explanation":"2-4 sentences: what helps and what hurts this script for conversion."}`

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await openai.chat.completions.create({
        model: SCORING_MODEL,
        temperature: 0.25 + attempt * 0.08,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You evaluate ad scripts with expert direct-response judgment. Output valid JSON only. Be harsh on generic hooks and weak CTAs.",
          },
          { role: "user", content: user },
        ],
      })
      const raw = res.choices?.[0]?.message?.content || "{}"
      const parsed = llmResponseSchema.parse(JSON.parse(raw))
      return {
        breakdown: {
          hook: parsed.hook,
          clarity: parsed.clarity,
          specificity: parsed.specificity,
          novelty: parsed.novelty,
          payoff: parsed.payoff,
          pacing: parsed.pacing,
          cta: parsed.cta,
        },
        explanation: parsed.explanation.trim(),
      }
    } catch {
      /* retry */
    }
  }
  return null
}

/** When LLM or blend fails, preserve heuristic vector when available so variants stay distinguishable. */
function fallbackScoreResult(
  reason: string,
  heur?: AdScoreBreakdown,
  creativeMode?: VariantScoreContext["creativeMode"]
): AdVariantScoreResult {
  const mid: AdScoreBreakdown = {
    hook: 50,
    clarity: 50,
    specificity: 50,
    novelty: 50,
    payoff: 50,
    pacing: 50,
    cta: 50,
  }
  const breakdown = heur ?? mid
  const totalScore = heur ? weightedTotal(heur, creativeMode) : 50
  const passes = heur ? passesFloors(heur) : false
  return {
    totalScore,
    breakdown,
    explanation: heur
      ? `scoring_error_fallback: ${reason.slice(0, 180)}. Dimensions kept from heuristics only (LLM/blend unavailable).`
      : `scoring_error_fallback: ${reason.slice(0, 180)}. No heuristic vector; uniform mid-range placeholder.`,
    heuristicBreakdown: heur ?? mid,
    llmBreakdown: mid,
    heuristicNotes: heur ? ["scoring_error_fallback", "heuristic_preserved"] : ["scoring_error_fallback"],
    heuristicAdjustmentSummary: heur ? "fallback_heuristic_only" : "fallback_mid_range",
    passesThresholds: passes,
  }
}

export async function evaluateAdVariant(
  script: ScriptForScoring,
  ingestion: AdSiteIngestion,
  durationSeconds: number,
  ctx: VariantScoreContext = {}
): Promise<AdVariantScoreResult> {
  try {
    const { breakdown: heur, notes: heuristicNotes } = buildHeuristicBreakdown(
      script,
      ingestion,
      ctx,
      durationSeconds
    )

    const llm = await llmEvaluateDimensions(
      script,
      ingestion,
      durationSeconds,
      ctx.creativeMode
    )
    const llmBreakdown: AdScoreBreakdown = llm?.breakdown ?? {
      hook: heur.hook,
      clarity: heur.clarity,
      specificity: heur.specificity,
      novelty: heur.novelty,
      payoff: heur.payoff,
      pacing: heur.pacing,
      cta: heur.cta,
    }

    const blended = blendBreakdown(llmBreakdown, heur)
    let totalScore = weightedTotal(blended, ctx.creativeMode)

    const dupNarr = (ctx.siblingNarrations || []).filter(
      n => n && script.narration && norm(n) === norm(script.narration)
    ).length
    if (dupNarr > 0) {
      totalScore = clamp(totalScore - 8, 1, 100)
      heuristicNotes.push("duplicate_narration_sibling")
    }

    const explanation =
      llm?.explanation ||
      `Heuristic blend (LLM unavailable). Notes: ${heuristicNotes.slice(0, 5).join("; ") || "none"}.`

    const heuristicAdjustmentSummary = `heuristics: ${[...new Set(heuristicNotes)].slice(0, 8).join(", ") || "clean"}`

    return {
      totalScore,
      breakdown: blended,
      explanation,
      heuristicBreakdown: heur,
      llmBreakdown,
      heuristicNotes: [...new Set(heuristicNotes)],
      heuristicAdjustmentSummary,
      passesThresholds: passesFloors(blended),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    let heur: AdScoreBreakdown | undefined
    try {
      heur = buildHeuristicBreakdown(script, ingestion, ctx, durationSeconds).breakdown
    } catch {
      /* keep undefined */
    }
    return fallbackScoreResult(msg.slice(0, 200), heur, ctx.creativeMode)
  }
}

/** If totals within this gap, break ties by dimension (hook → payoff → CTA → specificity → order). */
const TIE_SCORE_EPS = 1

/**
 * Compare two scored variants: higher total wins; on near-ties prefer stronger hook, payoff, CTA, specificity.
 * `orderIndex` is stable preset order (lower = earlier) for final tie-break only.
 */
export function compareScoreResults(
  a: AdVariantScoreResult,
  b: AdVariantScoreResult,
  orderIndexA: number,
  orderIndexB: number
): number {
  if (Math.abs(a.totalScore - b.totalScore) > TIE_SCORE_EPS) {
    return b.totalScore - a.totalScore
  }
  const A = a.breakdown
  const B = b.breakdown
  if (A.hook !== B.hook) return B.hook - A.hook
  if (A.payoff !== B.payoff) return B.payoff - A.payoff
  if (A.cta !== B.cta) return B.cta - A.cta
  if (A.specificity !== B.specificity) return B.specificity - A.specificity
  return orderIndexA - orderIndexB
}

/**
 * Same ranking pool as the primary winner: eligible-if-any, else all; sorted best-first.
 */
export function rankedVariantPool<
  T extends { scoreResult: AdVariantScoreResult; orderIndex: number }
>(results: T[]): T[] {
  if (!results.length) return []
  const eligible = results.filter(r => r.scoreResult.passesThresholds)
  const pool = eligible.length ? [...eligible] : [...results]
  pool.sort((a, b) =>
    compareScoreResults(a.scoreResult, b.scoreResult, a.orderIndex, b.orderIndex)
  )
  return pool
}

/** Pick best variant: prefer passing threshold floors; else fallback to highest total, with tie-breaks. */
export function selectWinningVariant<
  T extends { scoreResult: AdVariantScoreResult; orderIndex: number }
>(results: T[]): { winner: T; usedThresholdGate: boolean } {
  if (!results.length) {
    throw new Error("selectWinningVariant: no scored variants")
  }
  const pool = rankedVariantPool(results)
  const eligible = results.filter(r => r.scoreResult.passesThresholds)
  const usedThresholdGate = eligible.length > 0
  return { winner: pool[0]!, usedThresholdGate }
}
