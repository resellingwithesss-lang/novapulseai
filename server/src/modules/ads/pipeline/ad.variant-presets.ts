/**
 * Performance-oriented ad variants: each run generates multiple scripts;
 * the highest-scoring variant is rendered; all are stored on the job for A/B use.
 */

/** Product ad creative pipeline. Cinematic = polished commercial; UGC = short-form native. */
export type AdCreativeMode = "cinematic" | "ugc_social"

export type HookPattern =
  | "manual_pain"
  | "replace_process"
  | "missed_truth"
  | "tested_for_you"
  | "result_tease"
  | "curiosity_gap"

export type ScriptEmphasis = "balanced" | "proof" | "features" | "speed" | "flow"

export type NarrativeMode = "classic" | "result_first"

export interface AdVariantPreset {
  id: string
  label: string
  hookPattern: HookPattern
  emphasis: ScriptEmphasis
  narrativeMode: NarrativeMode
  /** Blends with the user's selected tone in the LLM prompt. */
  toneModifier: string
  /** Interaction capture pacing (multiplier passed to cinematic pipeline). */
  interactionPacingMul: number
}

/** Four distinct performance angles; slice to2–4 per job. */
export const AD_VARIANT_PRESETS: AdVariantPreset[] = [
  {
    id: "flow",
    label: "Interaction journey",
    hookPattern: "manual_pain",
    emphasis: "flow",
    narrativeMode: "classic",
    toneModifier: "direct, conversational, speak to a real workflow frustration",
    interactionPacingMul: 1.05,
  },
  {
    id: "proof",
    label: "Result-first proof",
    hookPattern: "result_tease",
    emphasis: "proof",
    narrativeMode: "result_first",
    toneModifier: "confident, proof-led; lead with the outcome then explain how",
    interactionPacingMul: 1.18,
  },
  {
    id: "features",
    label: "Feature density",
    hookPattern: "replace_process",
    emphasis: "features",
    narrativeMode: "classic",
    toneModifier: "clear, benefit-dense; each line must land a concrete capability",
    interactionPacingMul: 1.02,
  },
  {
    id: "speed",
    label: "Speed & simplicity",
    hookPattern: "tested_for_you",
    emphasis: "speed",
    narrativeMode: "classic",
    toneModifier: "fast-paced but premium; stress time saved and friction removed",
    interactionPacingMul: 0.94,
  },
]

/** Short-form / feed-native angles: faster interaction, punchier copy, more result-first. */
export const UGC_AD_VARIANT_PRESETS: AdVariantPreset[] = [
  {
    id: "ugc_pain_snap",
    label: "UGC — pain + snap fix",
    hookPattern: "manual_pain",
    emphasis: "speed",
    narrativeMode: "result_first",
    toneModifier:
      "native TikTok/Reels voice: conversational, slightly informal, zero corporate polish; sound like a creator showing a real fix",
    interactionPacingMul: 0.88,
  },
  {
    id: "ugc_proof_first",
    label: "UGC — proof-first",
    hookPattern: "result_tease",
    emphasis: "proof",
    narrativeMode: "result_first",
    toneModifier:
      "show-don't-tell: lead with the outcome, then the how in plain words; imagine fast cuts between proof moments",
    interactionPacingMul: 0.86,
  },
  {
    id: "ugc_hot_take",
    label: "UGC — hot take",
    hookPattern: "missed_truth",
    emphasis: "flow",
    narrativeMode: "classic",
    toneModifier:
      "bold opener, relatable frustration, punchy lines (aim under ~12 spoken words per beat); friend energy not brand voice",
    interactionPacingMul: 0.9,
  },
  {
    id: "ugc_replace_scroll",
    label: "UGC — scroll-stop replace",
    hookPattern: "replace_process",
    emphasis: "features",
    narrativeMode: "result_first",
    toneModifier:
      "direct swap framing (old way vs this way); keep energy high; casual CTA ('try it', 'see for yourself', 'tap in')",
    interactionPacingMul: 0.84,
  },
]

export function getAdVariantPresets(
  count: number,
  mode: AdCreativeMode = "cinematic"
): AdVariantPreset[] {
  const n = Math.max(2, Math.min(4, count))
  const pool = mode === "ugc_social" ? UGC_AD_VARIANT_PRESETS : AD_VARIANT_PRESETS
  return pool.slice(0, n)
}

export function defaultVariantCount(): number {
  const raw = Number(process.env.AD_VARIANT_COUNT)
  if (Number.isFinite(raw) && raw >= 2 && raw <= 4) return Math.floor(raw)
  return 3
}
