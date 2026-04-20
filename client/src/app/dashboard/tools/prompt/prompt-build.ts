/**
 * Pure builders for Prompt Intelligence — all local (no network).
 * Keeps page.tsx readable and makes variants testable.
 */

export type Platform =
  | "TikTok"
  | "Instagram Reels"
  | "YouTube Shorts"
  | "X / Threads"
  | "LinkedIn"

/** Minimal preset shape for building documents (full presets on page satisfy this). */
export type PromptPresetForBuild = {
  label: string
  roleFraming: string
  objectiveFraming: string
  hookLogic: string
  pacingRules: string
  ctaStyle: string
  outputConstraints: string[]
  extraConstraints: string[]
  examples: string[]
}

export type PromptVariantId = "balanced" | "bold" | "lean" | "convert"

export const VARIANT_META: Record<
  PromptVariantId,
  { label: string; badge?: string; hint: string }
> = {
  balanced: {
    label: "Balanced",
    badge: "Recommended",
    hint: "Best default — full structure, strict output schema.",
  },
  bold: {
    label: "High impact",
    hint: "Stronger tension, faster pattern interrupts, more native social energy.",
  },
  lean: {
    label: "Tight cut",
    hint: "Shorter spoken length, fewer overlays, ruthless clarity.",
  },
  convert: {
    label: "Conversion",
    hint: "Proof earlier, objection handling, one decisive CTA.",
  },
}

function variantModifier(id: PromptVariantId): string {
  switch (id) {
    case "balanced":
      return ""
    case "bold":
      return `

VARIANT PROFILE — HIGH IMPACT
- Increase scroll-stopping energy in the first 2 seconds without clickbait.
- Add 2–3 micro pattern interrupts in the first half of the script.
- Prefer short sentences (mostly under 11 words) in spoken lines.
- CTA should feel inevitable, not polite — still honest and non-manipulative.`
    case "lean":
      return `

VARIANT PROFILE — TIGHT RUNTIME
- Target ~30–45 seconds spoken (not 45–75); compress value density.
- Reduce on-screen text plan to 4–7 overlays (each still <= 8 words).
- Remove redundancy: no repeated points between hook and body.
- Keep exactly one CTA — the simplest viable action for this audience.`
    case "convert":
      return `

VARIANT PROFILE — CONVERSION
- Move a concrete proof beat into the first third of the script (metric, scenario, or observable outcome).
- Add one explicit objection + one-line response before the CTA.
- CTA must name the action and the payoff in plain language (no vague “check it out”).
- Variation notes should emphasize offer angles and risk-reversal language (still truthful).`
    default:
      return ""
  }
}

export function inferAudienceDetail(audience: string): string {
  const clean = audience.trim()
  if (!clean) {
    return "Define this clearly before generation: niche, sophistication level, buying intent, and what they tried before."
  }
  return clean
}

export function platformGuidance(platform: Platform): string {
  switch (platform) {
    case "TikTok":
      return "Fast open in first 1.5 seconds, pattern interrupts every 3-5 seconds, native language over corporate phrasing."
    case "Instagram Reels":
      return "Visual-first framing, concise line breaks, polished but conversational pacing, strong first-frame text."
    case "YouTube Shorts":
      return "Clear progression and payoff, stronger context setup, high information density, fewer slang shortcuts."
    case "X / Threads":
      return "Short lines, sharp thesis, high clarity, no fluff, one concrete takeaway per beat."
    case "LinkedIn":
      return "Authority-forward framing, practical insight cadence, proof-led examples, no meme slang, no clickbait phrasing."
    default:
      return "Match platform-native consumption style while preserving clarity and retention."
  }
}

export function styleDirectives(style: string): string {
  const map: Record<string, string> = {
    "Viral TikTok":
      "Use kinetic, high-retention pacing. Short lines. Curiosity-driven transitions. Keep language native and concrete.",
    "Authority Content":
      "Use confident expert voice. Name frameworks. Prioritize clarity and specificity over hype.",
    "Emotional Story":
      "Build emotional arc: tension -> vulnerability -> realization -> shift. Sensory detail where useful.",
    "Contrarian Take":
      "Lead with a credible disagreement. Steel-man the common view once, then provide a stronger alternative.",
    "Product Launch":
      "Use mechanism-led persuasion: pain -> unique mechanism -> evidence -> objection handling -> CTA.",
    "Tutorial Deep-Dive":
      "Teach in steps with mini outcomes. Keep transitions explicit. Avoid abstract advice without actions.",
    "UGC Testimonial":
      "Use first-person lived experience voice. Ground claims in concrete moments, metrics, and before/after context.",
  }
  return map[style] ?? "Write with high clarity, concrete detail, and platform-native pacing."
}

export function buildPromptDocument(params: {
  preset: PromptPresetForBuild
  platform: Platform
  style: string
  topic: string
  audience: string
  variant: PromptVariantId
}): string {
  const { preset, platform, style, topic, audience, variant } = params
  const cleanTopic = topic.trim()
  const cleanAudience = inferAudienceDetail(audience)
  const styleRule = styleDirectives(style)
  const platformRule = platformGuidance(platform)
  const mod = variantModifier(variant)

  return `ROLE
${preset.roleFraming}

OBJECTIVE
${preset.objectiveFraming}
Create one high-retention ${platform} script package about "${cleanTopic}" for "${cleanAudience}" that is specific, usable, and ready to publish.

CONTEXT
- Preset pack: ${preset.label}
- Platform: ${platform}
- Style profile: ${style}
- Topic: ${cleanTopic}
- Audience: ${cleanAudience}
- Primary outcome: maximize retention first, then drive a single clear next action.

STYLE
- ${styleRule}
- ${platformRule}
- Hook logic: ${preset.hookLogic}
- Pacing rules: ${preset.pacingRules}
- CTA style: ${preset.ctaStyle}
- Every section must contain concrete detail, not generic motivational language.
- Keep language easy to read aloud; avoid jargon unless the audience expects it.
${mod}

OUTPUT FORMAT (STRICT)
Return exactly these sections in order:
1) HOOK OPTIONS (3)
   - 3 distinct hooks with different mechanisms (curiosity, contrarian, outcome).
2) SCRIPT (45-75 seconds)
   - A complete spoken script with this internal structure:
     a) Hook
     b) Context
     c) Value Ladder (3-5 beats)
     d) Proof Beat
     e) Friction Removal
     f) CTA
3) ON-SCREEN TEXT PLAN
   - 6-10 overlays, each <= 8 words.
4) CAPTION
   - 1 caption, <= 220 characters.
5) HASHTAGS
   - 8-12 relevant tags, single line.
6) VARIATION NOTES
   - 3 concise ways to adapt this script for A/B testing.
7) VIRAL LEVERAGE (3 bullets, concrete — no generic “be authentic”)
   - Share trigger: one specific reason someone forwards or tags a friend.
   - Rewatch beat: the 3–6s moment people loop (line, reveal, or sync point).
   - Comment friction: one specific question that invites stance (not “thoughts?”).

CONSTRAINTS
- No fake metrics, no fabricated claims, no invented case studies.
- No weak openers like "Hey guys" or "In this video".
- No vague directives like "be authentic" without specific execution.
- In the main SCRIPT section, include exactly one CTA action.
- Keep readability high: short lines, direct verbs, concrete nouns.
${preset.outputConstraints.map((line) => `- ${line}`).join("\n")}
${preset.extraConstraints.map((line) => `- ${line}`).join("\n")}

EXAMPLES (MICRO PATTERNS)
${preset.examples.map((line) => `- ${line}`).join("\n")}
- Strong hook pattern: "You don't need more content ideas. You need a repeatable content operating system."
- Strong proof pattern: "In 14 days, this workflow cut our edit time from 5 hours to 2."
- Strong CTA pattern: "Comment 'SYSTEM' and I'll send the framework."`
}

/** Local “improve” passes — appended so the user’s model sees a second instruction wave. */
export type ImproveKind = "shorter" | "aggressive" | "conversion"

const IMPROVE_MARKERS: Record<ImproveKind, string> = {
  shorter: "REVISION PASS — COMPRESS",
  aggressive: "REVISION PASS — BOLDER HOOKS",
  conversion: "REVISION PASS — CTA & PROOF",
}

export function improveSnippet(kind: ImproveKind): string {
  switch (kind) {
    case "shorter":
      return `

---
${IMPROVE_MARKERS.shorter}
Rewrite only the SCRIPT and ON-SCREEN TEXT PLAN sections to reduce total spoken length by ~25–35% while preserving the same core argument and the single CTA. Remove filler, merge redundant beats, keep hooks sharp. Do not add new claims.`
    case "aggressive":
      return `

---
${IMPROVE_MARKERS.aggressive}
Strengthen HOOK OPTIONS and the opening of SCRIPT: more contrast, more specificity, more “pattern interrupt” — still believable and non-deceptive. Do not invent statistics; use hypothetical or directional language if proof is not provided.`
    case "conversion":
      return `

---
${IMPROVE_MARKERS.conversion}
Optimize for one clear conversion outcome: tighten CTA, add a proof beat if missing (use only user-provided or clearly hypothetical proof), and make VARIATION NOTES about offer angles and audience splits — no fake urgency.`
    default:
      return ""
  }
}

export function improveMarker(kind: ImproveKind): string {
  return IMPROVE_MARKERS[kind]
}

export function documentHasImproveMarker(doc: string, kind: ImproveKind): boolean {
  return doc.includes(IMPROVE_MARKERS[kind])
}
