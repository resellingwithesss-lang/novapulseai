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
    hint: "Scroll-stop open, tight beats, proof teased early.",
  },
  {
    id: "ugc_testimonial",
    label: "UGC testimonial",
    hint: "Credible first-person voice, specific and conversational.",
  },
  {
    id: "problem_solution",
    label: "Problem → solution",
    hint: "Cold-traffic clarity: pain, mechanism, payoff.",
  },
  {
    id: "product_demo",
    label: "Product demo",
    hint: "Visualizable beats; capability-forward, still premium.",
  },
  {
    id: "story_driven",
    label: "Story-driven",
    hint: "Arc and emotion grounded in on-page facts.",
  },
  {
    id: "luxury_premium",
    label: "Luxury / premium",
    hint: "Restrained, confident, minimal hype.",
  },
  {
    id: "founder_led",
    label: "Founder-led",
    hint: "Direct builder energy when the site supports it.",
  },
  {
    id: "offer_conversion",
    label: "Offer / conversion",
    hint: "Offer-forward; urgency only when the site backs it.",
  },
]

export const VIDEO_PACKAGING_OPTIONS: { id: string; label: string }[] = [
  { id: "bold_viral", label: "Bold viral" },
  { id: "clean_ugc", label: "Clean UGC" },
  { id: "luxury_minimal", label: "Luxury minimal" },
  { id: "podcast_premium", label: "Podcast premium" },
  { id: "streamer_energy", label: "Streamer energy" },
  { id: "product_demo", label: "Product demo" },
  { id: "story_cinematic", label: "Story cinematic" },
]
