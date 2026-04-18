/**
 * UI labels for Ad Studio modes — keep ids aligned with server `ad.studio-modes.ts`.
 * `hint` is one line of creative direction (shown under the preset picker).
 */

export const STUDIO_CREATIVE_MODE_OPTIONS: {
  id: string
  label: string
  hint: string
}[] = [
  {
    id: "viral_tiktok_hook",
    label: "Viral hook",
    hint: "Pattern-interrupt open, staccato beats, proof teased in the first breath.",
  },
  {
    id: "ugc_testimonial",
    label: "UGC testimonial",
    hint: "First-person proof, conversational specificity — avoids studio polish clichés.",
  },
  {
    id: "problem_solution",
    label: "Problem → solution",
    hint: "Cold-traffic clarity: pain, mechanism, payoff without invented claims.",
  },
  {
    id: "product_demo",
    label: "Product demo",
    hint: "Capability-led beats your site can actually show on camera.",
  },
  {
    id: "story_driven",
    label: "Story-driven",
    hint: "Emotional arc anchored in real on-page facts, not generic lore.",
  },
  {
    id: "luxury_premium",
    label: "Luxury / premium",
    hint: "Restrained pacing, confident diction, minimal hype language.",
  },
  {
    id: "founder_led",
    label: "Founder-led",
    hint: "Direct builder voice when headlines and about copy support it.",
  },
  {
    id: "offer_conversion",
    label: "Offer / conversion",
    hint: "Offer-forward structure; urgency only when the page backs it up.",
  },
]

export type PackagingSwatch = {
  frameGradient: string
  captionBg: string
  captionLine: string
  captionLineMuted?: string
  captionBorder?: string
  highlightBar?: string
}

export type VideoPackagingPreset = {
  id: string
  label: string
  hint: string
  /** What the on-screen caption treatment optimizes for (honest expectation-setting). */
  captionFocus: string
  swatch: PackagingSwatch
}

export const VIDEO_PACKAGING_PRESETS: VideoPackagingPreset[] = [
  {
    id: "bold_viral",
    label: "Bold viral",
    hint: "High-contrast bars, punchy line breaks — built for thumb-stopping Reels/TikTok.",
    captionFocus: "Large type, tight word highlights, aggressive contrast.",
    swatch: {
      frameGradient: "linear-gradient(160deg, #0f0f12 0%, #1a1025 100%)",
      captionBg: "rgba(0,0,0,0.78)",
      captionLine: "#FDE047",
      captionLineMuted: "rgba(253,224,71,0.45)",
      captionBorder: "1px solid rgba(250,204,21,0.35)",
    },
  },
  {
    id: "clean_ugc",
    label: "Clean UGC",
    hint: "Readable native-social captions — bright but not over-designed.",
    captionFocus: "Rounded bars, airy padding, conversational line length.",
    swatch: {
      frameGradient: "linear-gradient(165deg, #111827 0%, #1f2937 100%)",
      captionBg: "rgba(255,255,255,0.12)",
      captionLine: "#F9FAFB",
      captionLineMuted: "rgba(249,250,251,0.5)",
    },
  },
  {
    id: "luxury_minimal",
    label: "Luxury minimal",
    hint: "Thin treatments, generous negative space, editorial restraint.",
    captionFocus: "Small caps energy, subtle dividers, low visual noise.",
    swatch: {
      frameGradient: "linear-gradient(170deg, #0c0a09 0%, #1c1917 100%)",
      captionBg: "rgba(255,255,255,0.06)",
      captionLine: "#E7E5E4",
      captionLineMuted: "rgba(231,229,228,0.35)",
      captionBorder: "1px solid rgba(255,255,255,0.12)",
    },
  },
  {
    id: "podcast_premium",
    label: "Podcast premium",
    hint: "Two-line friendly captions tuned for talking-head density.",
    captionFocus: "Stacked lines, softer shadow, voice-forward legibility.",
    swatch: {
      frameGradient: "linear-gradient(160deg, #0b1220 0%, #172033 100%)",
      captionBg: "rgba(15,23,42,0.88)",
      captionLine: "#BAE6FD",
      captionLineMuted: "rgba(186,230,253,0.45)",
    },
  },
  {
    id: "streamer_energy",
    label: "Streamer energy",
    hint: "Highlight pops on keywords — pairs well with optional accent hex.",
    captionFocus: "Keyword color lifts (uses accent when you set hex on the server).",
    swatch: {
      frameGradient: "linear-gradient(155deg, #1e1b4b 0%, #312e81 100%)",
      captionBg: "rgba(0,0,0,0.55)",
      captionLine: "#A5B4FC",
      captionLineMuted: "#818CF8",
      highlightBar: "#F472B6",
    },
  },
  {
    id: "product_demo",
    label: "Product demo",
    hint: "Lower-third clarity for UI walkthroughs and feature callouts.",
    captionFocus: "Structured bands that read over busy screen recordings.",
    swatch: {
      frameGradient: "linear-gradient(165deg, #0f172a 0%, #1e293b 100%)",
      captionBg: "rgba(30,41,59,0.92)",
      captionLine: "#F8FAFC",
      captionBorder: "1px solid rgba(148,163,184,0.35)",
    },
  },
  {
    id: "story_cinematic",
    label: "Story cinematic",
    hint: "Default narrative polish — balanced for mixed B-roll and site capture.",
    captionFocus: "Cinematic lower third with measured contrast.",
    swatch: {
      frameGradient: "linear-gradient(165deg, #020617 0%, #0f172a 55%, #1e293b 100%)",
      captionBg: "rgba(2,6,23,0.75)",
      captionLine: "#F1F5F9",
      captionLineMuted: "rgba(241,245,249,0.4)",
    },
  },
]

/** Slim list for legacy dropdowns; prefer `VIDEO_PACKAGING_PRESETS` in new UI. */
export const VIDEO_PACKAGING_OPTIONS: { id: string; label: string }[] = VIDEO_PACKAGING_PRESETS.map(
  ({ id, label }) => ({ id, label })
)

export function getVideoPackagingPreset(id: string | null | undefined): VideoPackagingPreset | undefined {
  if (!id) return undefined
  return VIDEO_PACKAGING_PRESETS.find((p) => p.id === id)
}

export type AdsTtsVoiceId =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "sage"
  | "shimmer"
  | "verse"

/** OpenAI TTS catalog — synthetic speech, not voice cloning. */
export const ADS_TTS_VOICE_OPTIONS: {
  id: AdsTtsVoiceId
  label: string
  character: string
}[] = [
  { id: "alloy", label: "Alloy", character: "Balanced, versatile narrator — safe default for mixed brands." },
  { id: "ash", label: "Ash", character: "Dry, composed delivery — works for technical or SaaS reads." },
  { id: "ballad", label: "Ballad", character: "Warm, melodic intonation — softer promotional tone." },
  { id: "coral", label: "Coral", character: "Upbeat clarity — good when energy must stay controlled." },
  { id: "echo", label: "Echo", character: "Deeper register — adds gravitas without theatrical exaggeration." },
  { id: "sage", label: "Sage", character: "Measured, confident — suited to premium or founder-led scripts." },
  { id: "shimmer", label: "Shimmer", character: "Bright and articulate — helps dense copy stay intelligible." },
  { id: "verse", label: "Verse", character: "Expressive range — use when the script has stronger emotional swings." },
]

/** Shown as compact chips above the full creative dropdown (admin + Story Video). */
export const STUDIO_QUICK_PICK_MODE_IDS: string[] = [
  "viral_tiktok_hook",
  "ugc_testimonial",
  "problem_solution",
  "luxury_premium",
]
