/**
 * High-level "Ad Studio" creative modes for operator-driven generation.
 * Maps to LLM directives, variant ordering, default packaging, and creative pipeline mode.
 */

import type { AdCreativeMode } from "./ad.variant-presets"

export type StudioCreativeModeId =
  | "viral_tiktok_hook"
  | "ugc_testimonial"
  | "problem_solution"
  | "product_demo"
  | "story_driven"
  | "luxury_premium"
  | "founder_led"
  | "offer_conversion"

export type VideoPackagingPresetId =
  | "bold_viral"
  | "clean_ugc"
  | "luxury_minimal"
  | "podcast_premium"
  | "streamer_energy"
  | "product_demo"
  | "story_cinematic"

export type StudioCreativeModeDefinition = {
  id: StudioCreativeModeId
  label: string
  description: string
  /** Overrides request creativeMode unless `inherit`. */
  creativeMode: AdCreativeMode | "inherit"
  variantPreference: string[]
  defaultVideoPackaging: VideoPackagingPresetId
  llmDirective: string
}

export const STUDIO_CREATIVE_MODE_IDS: StudioCreativeModeId[] = [
  "viral_tiktok_hook",
  "ugc_testimonial",
  "problem_solution",
  "product_demo",
  "story_driven",
  "luxury_premium",
  "founder_led",
  "offer_conversion",
]

export const STUDIO_CREATIVE_MODE_ENUM = STUDIO_CREATIVE_MODE_IDS as unknown as [
  StudioCreativeModeId,
  ...StudioCreativeModeId[],
]

export const VIDEO_PACKAGING_IDS: VideoPackagingPresetId[] = [
  "bold_viral",
  "clean_ugc",
  "luxury_minimal",
  "podcast_premium",
  "streamer_energy",
  "product_demo",
  "story_cinematic",
]

export const VIDEO_PACKAGING_ENUM = VIDEO_PACKAGING_IDS as unknown as [
  VideoPackagingPresetId,
  ...VideoPackagingPresetId[],
]

export const STUDIO_CREATIVE_MODES: StudioCreativeModeDefinition[] = [
  {
    id: "viral_tiktok_hook",
    label: "Viral TikTok hook",
    description: "Scroll-stop in the first second, punchy beats, proof teased immediately.",
    creativeMode: "ugc_social",
    variantPreference: ["ugc_hot_take", "ugc_proof_first", "ugc_pain_snap"],
    defaultVideoPackaging: "bold_viral",
    llmDirective: `STUDIO MODE — VIRAL TIKTOK HOOK
- Open with a pattern-interrupt: blunt contrast, a sharp outcome tease, or a relatable "you still doing X?" grounded ONLY in site facts.
- Ultra-short clauses; aim for beats under ~12 spoken words where natural.
- CTA: casual and direct ("try it", "see for yourself") but still specific to this product.`,
  },
  {
    id: "ugc_testimonial",
    label: "UGC testimonial",
    description: "Authentic creator testimonial energy — credible, conversational, proof-led.",
    creativeMode: "ugc_social",
    variantPreference: ["ugc_proof_first", "ugc_replace_scroll", "ugc_hot_take"],
    defaultVideoPackaging: "clean_ugc",
    llmDirective: `STUDIO MODE — UGC TESTIMONIAL
- Sound like a real person who tried the product: first-person, specific, not corporate.
- Lead with a believable before/after or "I used to… now I…" framed ONLY from site content.
- Avoid fake reviews or numbers; prefer process clarity and honest outcome language.`,
  },
  {
    id: "problem_solution",
    label: "Problem / solution",
    description: "Tight pain → mechanism → payoff; strong clarity for cold traffic.",
    creativeMode: "inherit",
    variantPreference: ["flow", "proof", "speed"],
    defaultVideoPackaging: "product_demo",
    llmDirective: `STUDIO MODE — PROBLEM / SOLUTION
- Name the pain in one breath; make the mechanism concrete (what changes in the user's workflow).
- Features must each land a capability tied to headings or bullets from the site.
- Payoff must mirror the hook's promise without invented metrics.`,
  },
  {
    id: "product_demo",
    label: "Product demo",
    description: "Premium product-forward walkthrough — clear, visualizable beats.",
    creativeMode: "cinematic",
    variantPreference: ["features", "flow", "proof"],
    defaultVideoPackaging: "product_demo",
    llmDirective: `STUDIO MODE — PRODUCT DEMO
- Write for visual demo beats: each line should suggest a screen moment or tangible output.
- Prioritize clarity and capability density over hype; still premium and modern.
- CTA should invite experiencing the workflow or seeing a concrete result.`,
  },
  {
    id: "story_driven",
    label: "Story-driven",
    description: "Narrative arc: tension → turn → resolution; emotional but honest.",
    creativeMode: "inherit",
    variantPreference: ["flow", "proof", "features"],
    defaultVideoPackaging: "story_cinematic",
    llmDirective: `STUDIO MODE — STORY-DRIVEN AD
- Classic arc with emotional texture: tension → turning point → resolution.
- Keep claims grounded in site facts; no invented stories or testimonials.
- Hook should create curiosity; payoff should feel like the emotional close of the arc.`,
  },
  {
    id: "luxury_premium",
    label: "Luxury / premium brand",
    description: "Restrained, confident, minimal hype — high-end paid social.",
    creativeMode: "cinematic",
    variantPreference: ["proof", "features", "flow"],
    defaultVideoPackaging: "luxury_minimal",
    llmDirective: `STUDIO MODE — LUXURY / PREMIUM
- Confident, restrained tone; shorter sentences; no shouty discount language unless the site explicitly supports it.
- Emphasize craft, clarity, and outcome quality over volume of claims.
- CTA: elegant motion + outcome (e.g. explore, see the experience) while still specific to the product.`,
  },
  {
    id: "founder_led",
    label: "Founder-led",
    description: "Direct, mission-led voice — credible builder energy without fabrication.",
    creativeMode: "inherit",
    variantPreference: ["proof", "flow", "speed"],
    defaultVideoPackaging: "podcast_premium",
    llmDirective: `STUDIO MODE — FOUNDER-LED
- Direct address and builder energy ("we built this because…") ONLY when supported by site copy (about/mission/headlines).
- If founder story is not on-page, stay product-truthful: lead with problem/solution in plain language.
- Avoid inventing personal anecdotes or credentials.`,
  },
  {
    id: "offer_conversion",
    label: "Offer / conversion",
    description: "Offer-forward framing with urgency only when site backs it.",
    creativeMode: "ugc_social",
    variantPreference: ["ugc_replace_scroll", "ugc_proof_first", "speed"],
    defaultVideoPackaging: "streamer_energy",
    llmDirective: `STUDIO MODE — OFFER / CONVERSION
- Strong offer framing: clear reason-to-act tied to site CTAs and value props.
- Use urgency/scarcity ONLY if the site implies it; otherwise use honest momentum ("today", "right now") without lying.
- CTA must mirror on-site CTA language when possible.`,
  },
]

export function resolveStudioCreativeMode(
  id: string | undefined | null,
  requestCreativeMode: AdCreativeMode
): {
  studio: StudioCreativeModeDefinition | null
  effectiveCreativeMode: AdCreativeMode
  studioCreativeDirective: string | undefined
  variantPreference: string[] | undefined
  defaultVideoPackaging: VideoPackagingPresetId | undefined
} {
  if (!id?.trim()) {
    return {
      studio: null,
      effectiveCreativeMode: requestCreativeMode,
      studioCreativeDirective: undefined,
      variantPreference: undefined,
      defaultVideoPackaging: undefined,
    }
  }
  const studio = STUDIO_CREATIVE_MODES.find(m => m.id === id)
  if (!studio) {
    return {
      studio: null,
      effectiveCreativeMode: requestCreativeMode,
      studioCreativeDirective: undefined,
      variantPreference: undefined,
      defaultVideoPackaging: undefined,
    }
  }
  const effectiveCreativeMode: AdCreativeMode =
    studio.creativeMode === "inherit" ? requestCreativeMode : studio.creativeMode
  return {
    studio,
    effectiveCreativeMode,
    studioCreativeDirective: studio.llmDirective,
    variantPreference: studio.variantPreference,
    defaultVideoPackaging: studio.defaultVideoPackaging,
  }
}

export function resolveVideoPackaging(
  explicit: string | undefined | null,
  studioDefault: VideoPackagingPresetId | undefined
): VideoPackagingPresetId {
  if (explicit && VIDEO_PACKAGING_IDS.includes(explicit as VideoPackagingPresetId)) {
    return explicit as VideoPackagingPresetId
  }
  return studioDefault ?? "story_cinematic"
}
