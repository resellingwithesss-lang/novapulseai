"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import ToolPageShell from "@/components/tools/ToolPageShell"
import { formatBlockedReason, useEntitlementSnapshot } from "@/hooks/useEntitlementSnapshot"
import { incrementToolUsage, pushOutputHistory } from "@/lib/growth"

type Platform = "TikTok" | "Instagram Reels" | "YouTube Shorts" | "X / Threads" | "LinkedIn"
type PresetId =
  | "UGC_AD"
  | "EDUCATIONAL_SHORT"
  | "CONTRARIAN_AUTHORITY"
  | "STORY_BASED_HOOK"
  | "PRODUCT_EXPLAINER"
  | "FOUNDER_PERSONAL_BRAND"
  | "DIRECT_RESPONSE_CLIP"
  | "SOFT_SELL_OFFER_TEASER"

type PromptPreset = {
  id: PresetId
  label: string
  summary: string
  styleDefault: string
  roleFraming: string
  objectiveFraming: string
  hookLogic: string
  pacingRules: string
  ctaStyle: string
  outputConstraints: string[]
  extraConstraints: string[]
  examples: string[]
  useCases: string[]
}

const ENABLE_PROMPT_AI_REFINER = false

async function refinePromptWithAI(prompt: string): Promise<string> {
  // Prepared hook for future optional AI refinement.
  // Intentionally local/no-op until explicitly enabled and wired to backend.
  if (!ENABLE_PROMPT_AI_REFINER) return prompt
  return prompt
}

function inferAudienceDetail(audience: string): string {
  const clean = audience.trim()
  if (!clean) {
    return "Define this clearly before generation: niche, sophistication level, buying intent, and what they tried before."
  }
  return clean
}

function platformGuidance(platform: Platform): string {
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

function styleDirectives(style: string): string {
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

const PROMPT_PRESETS: PromptPreset[] = [
  {
    id: "UGC_AD",
    label: "UGC Ad",
    summary: "First-person product proof with native social language.",
    styleDefault: "UGC Testimonial",
    roleFraming: "Act as a top-performing UGC ad scriptwriter who turns lived experience into credible conversion copy.",
    objectiveFraming: "Produce a trust-first ad script that sounds native, specific, and conversion-capable without sounding like a studio commercial.",
    hookLogic: "Open with a failed prior attempt or common frustration, then pivot into a concrete turning point.",
    pacingRules: "Fast first 8-10 seconds, then practical proof beats. Keep each beat short and spoken-friendly.",
    ctaStyle: "Low-pressure but clear action: comment keyword, save, DM, or link-in-bio micro ask.",
    outputConstraints: [
      "Include one before/after contrast.",
      "Include one concrete proof detail (time, metric, or scenario).",
      "Include one alternate paid-social hook variant in variation notes.",
    ],
    extraConstraints: [
      "No hype claims without concrete support.",
      "No corporate product jargon.",
    ],
    examples: [
      "I tried three routines before this one stopped my afternoon skin flare-ups.",
      "By week two, my editing time dropped from 90 minutes to 35.",
    ],
    useCases: [
      "Creator sharing a first-person result after switching workflow tools",
      "Product testimonial clip for paid social testing",
      "Founder-led UGC ad with proof and low-pressure CTA",
    ],
  },
  {
    id: "EDUCATIONAL_SHORT",
    label: "Educational Short",
    summary: "High-clarity teaching format for fast comprehension.",
    styleDefault: "Tutorial Deep-Dive",
    roleFraming: "Act as an expert educator specializing in short-form learning design.",
    objectiveFraming: "Produce a script that teaches one sharp concept quickly while maximizing completion and retention.",
    hookLogic: "Lead with a high-value promise tied to a concrete learner outcome.",
    pacingRules: "Use step-based sequencing with mini payoff per step; recap at ~70%.",
    ctaStyle: "Invite save/follow for next lesson in sequence.",
    outputConstraints: [
      "3-5 clear teaching beats.",
      "Each beat includes an action verb and expected result.",
      "Add one common mistake to avoid.",
    ],
    extraConstraints: [
      "No abstract advice without executable steps.",
      "No more than one sentence of theory before action.",
    ],
    examples: [
      "If your hook doesn't create a gap, viewers decide in the first second to leave.",
      "Replace broad claims with one proof example per point.",
    ],
    useCases: [
      "Teach one clear framework in under 60 seconds",
      "Break down a common production mistake and fix",
      "Explain a repeatable system step-by-step",
    ],
  },
  {
    id: "CONTRARIAN_AUTHORITY",
    label: "Contrarian Authority",
    summary: "Credible disagreement format for expert positioning.",
    styleDefault: "Contrarian Take",
    roleFraming: "Act as a trusted strategist known for nuanced contrarian takes backed by evidence.",
    objectiveFraming: "Challenge a common belief and replace it with a stronger framework that elevates authority and trust.",
    hookLogic: "Start with a bold but defensible disagreement in plain language.",
    pacingRules: "Frame opposing view briefly, then stack evidence and replacement model.",
    ctaStyle: "Invite debate-oriented CTA (comment stance, share counterexample).",
    outputConstraints: [
      "Include one sentence that fairly steel-mans the opposing view.",
      "Provide one practical replacement model with exactly 3 bullets.",
    ],
    extraConstraints: [
      "No strawman arguments.",
      "No hostile or dismissive tone.",
    ],
    examples: [
      "Consistency is not your growth problem. Feedback latency is.",
      "Volume fails when quality control loops are missing.",
    ],
    useCases: [
      "Challenge a popular creator myth with evidence",
      "Position your method against generic best practices",
      "Authority-building take for opinionated audience segments",
    ],
  },
  {
    id: "STORY_BASED_HOOK",
    label: "Story-Based Hook",
    summary: "Narrative-led opening with emotional tension and payoff.",
    styleDefault: "Emotional Story",
    roleFraming: "Act as a story strategist who builds emotionally sticky short-form narratives.",
    objectiveFraming: "Create a story-first script that earns attention through credible tension, not gimmicks.",
    hookLogic: "Open in-scene at the moment tension peaks, then reveal context after.",
    pacingRules: "Escalate stakes through 3 turning points and one insight payoff.",
    ctaStyle: "CTA should extend the story arc (part 2, save, or follow for resolution).",
    outputConstraints: [
      "Include scene-setting detail in first 2 lines.",
      "Include one internal conflict sentence and one external pressure detail.",
      "End with a transformation statement.",
    ],
    extraConstraints: [
      "No melodrama without concrete context.",
      "No vague inspirational ending.",
    ],
    examples: [
      "At 1:12 a.m., I was still rewriting line one for the seventh time.",
      "The shift happened when I stopped writing for everyone and wrote for one person.",
    ],
    useCases: [
      "Personal turning-point story tied to workflow transformation",
      "Behind-the-scenes narrative about a failed launch and fix",
      "Emotional founder moment that leads into practical lesson",
    ],
  },
  {
    id: "PRODUCT_EXPLAINER",
    label: "Product Explainer",
    summary: "Mechanism-first explanation that removes friction.",
    styleDefault: "Product Launch",
    roleFraming: "Act as a product marketing strategist who explains mechanisms clearly and concisely.",
    objectiveFraming: "Explain how the product works, why it is different, and when to use it in practical production terms.",
    hookLogic: "Open with the costly problem caused by current workflow friction.",
    pacingRules: "Problem -> mechanism -> demonstration -> objection handling -> CTA.",
    ctaStyle: "Offer one practical next step (try, demo, compare).",
    outputConstraints: [
      "Name the mechanism in one line using plain language.",
      "Include one concrete use-case scenario.",
      "Include one objection and concise response.",
    ],
    extraConstraints: [
      "No feature dumping.",
      "No claims without context.",
    ],
    examples: [
      "Most tools generate text. This system generates workflow-ready assets that chain into the next step.",
      "Instead of starting from blank each time, you inherit context from your workspace and brand voice.",
    ],
    useCases: [
      "Explain how your product works without feature dumping",
      "Clarify why your mechanism is different from alternatives",
      "Bridge from problem awareness to product trial intent",
    ],
  },
  {
    id: "FOUNDER_PERSONAL_BRAND",
    label: "Founder Personal Brand",
    summary: "Authority + transparency for founder-led trust building.",
    styleDefault: "Authority Content",
    roleFraming: "Act as a founder-brand ghostwriter focused on credibility, clarity, and trust.",
    objectiveFraming: "Build founder authority with practical lessons, transparent decision logic, and operator-grade specificity.",
    hookLogic: "Lead with one hard-earned lesson or uncomfortable truth from operating experience.",
    pacingRules: "Insight -> context -> decision framework -> practical takeaway.",
    ctaStyle: "Invite audience to share their operating challenge or ask for a framework.",
    outputConstraints: [
      "Include one leadership or operating decision moment.",
      "Include one named framework or principle in plain language.",
    ],
    extraConstraints: [
      "No fake humility or self-congratulatory storytelling.",
      "Avoid overly polished VC-style buzzwords.",
    ],
    examples: [
      "We didn't need better ideas. We needed fewer context switches per day.",
      "The metric I stopped tracking made our output better in two weeks.",
    ],
    useCases: [
      "Founder lesson from a real operating decision",
      "Personal-brand post that balances authority and humility",
      "Narrative around a hard tradeoff and what changed",
    ],
  },
  {
    id: "DIRECT_RESPONSE_CLIP",
    label: "Direct Response Clip",
    summary: "Performance-oriented conversion script for response actions.",
    styleDefault: "Product Launch",
    roleFraming: "Act as a direct-response creative strategist optimizing for measurable action.",
    objectiveFraming: "Generate a high-intent script that converts warm traffic without sounding manipulative.",
    hookLogic: "Open with the cost of inaction and one concrete opportunity gap.",
    pacingRules: "Tight rhythm, proof early, objection handling before CTA.",
    ctaStyle: "Single strong CTA with explicit action and expected benefit.",
    outputConstraints: [
      "Include one urgency reason rooted in context (not fake scarcity).",
      "Include one explicit qualifier for who this is for.",
      "Provide one alternate CTA for colder audiences in variation notes.",
    ],
    extraConstraints: [
      "No fabricated urgency deadlines.",
      "No manipulative fear language.",
    ],
    examples: [
      "If you're still scripting ad hooks manually, you're paying a hidden speed tax every week.",
      "If this sounds like your workflow, comment 'SYSTEM' and I will share the template.",
    ],
    useCases: [
      "Conversion-focused short for warm retargeting audiences",
      "Offer-led clip with objection handling before CTA",
      "Lead magnet call-to-action with measurable response intent",
    ],
  },
  {
    id: "SOFT_SELL_OFFER_TEASER",
    label: "Soft-Sell Offer Teaser",
    summary: "Value-first warmup script that earns demand before pitch.",
    styleDefault: "Authority Content",
    roleFraming: "Act as a soft-conversion strategist specializing in trust-first offers.",
    objectiveFraming: "Create demand through insight and relevance before introducing the offer in a low-pressure way.",
    hookLogic: "Start with a high-relevance pain pattern your audience recognizes instantly.",
    pacingRules: "Teach first, then bridge naturally into offer mention near the end.",
    ctaStyle: "Soft CTA: save, comment, or DM for details; avoid hard close language.",
    outputConstraints: [
      "At least 80% of script should be pure value before any offer mention.",
      "Offer mention must feel like continuation, not abrupt pivot.",
    ],
    extraConstraints: [
      "No hard pressure tactics.",
      "No discount-first framing.",
    ],
    examples: [
      "Most creators don't need more content ideas; they need fewer workflow bottlenecks.",
      "If you want the exact checklist we use, comment 'checklist'.",
    ],
    useCases: [
      "Value-first teaser before introducing a paid offer",
      "Soft bridge from educational content into consultation CTA",
      "Community-building post that warms demand over time",
    ],
  },
]

function getPresetById(id: PresetId): PromptPreset {
  return PROMPT_PRESETS.find((p) => p.id === id) ?? PROMPT_PRESETS[0]!
}

export default function PromptPage() {
  const searchParams = useSearchParams()
  const { entitlement } = useEntitlementSnapshot()
  const [topic, setTopic] = useState("")
  const [audience, setAudience] = useState("")
  const [style, setStyle] = useState("Viral TikTok")
  const [presetId, setPresetId] = useState<PresetId>("UGC_AD")
  const [platform, setPlatform] = useState<Platform>("TikTok")
  const [prompt, setPrompt] = useState("")
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [builtAt, setBuiltAt] = useState<string | null>(null)
  const [repeatUsageCount, setRepeatUsageCount] = useState(0)

  useEffect(() => {
    const handoffTopic = searchParams.get("topic")
    const handoffStyle = searchParams.get("style")
    if (handoffTopic) setTopic(handoffTopic)
    if (handoffStyle) setStyle(handoffStyle)
  }, [searchParams])

  useEffect(() => {
    const preset = getPresetById(presetId)
    setStyle(preset.styleDefault)
  }, [presetId])

  const blockedMessage = entitlement
    ? formatBlockedReason(
        entitlement.featureAccess.prompt.blockedReason,
        entitlement.featureAccess.prompt.minimumPlan
      )
    : null
  const canGenerate = entitlement ? entitlement.featureAccess.prompt.allowed : true

  const styleHints = useMemo(() => {
    const map: Record<string, string> = {
      "Viral TikTok":
        "Fast pattern interrupts, curiosity gaps every 3–5s, native slang OK.",
      "Authority Content":
        "Calm expert tone, frameworks named, proof-forward, minimal hype.",
      "Emotional Story":
        "Vulnerability arc, sensory detail, one clear transformation moment.",
      "Contrarian Take":
        "Challenge a default belief; steel-man the other side once, then flip.",
      "Product Launch":
        "Problem → insight → mechanism → proof → single CTA; urgency without fake scarcity.",
      "Tutorial Deep-Dive":
        "Step beats with outcome per step; assume skimmers — recap hook at 60%.",
      "UGC Testimonial":
        "First-person lived experience; specific numbers/dates; soft CTA.",
    }
    return map[style] ?? map["Viral TikTok"]
  }, [style])

  const generatePrompt = async () => {
    if (!canGenerate) return
    if (topic.trim().length < 3) {
      setError("Add a clear topic (at least 3 characters) before generating.")
      return
    }
    setError(null)

    const cleanTopic = topic.trim()
    const cleanAudience = inferAudienceDetail(audience)
    const styleRule = styleDirectives(style)
    const platformRule = platformGuidance(platform)
    const preset = getPresetById(presetId)

    const basePrompt = `ROLE
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

    const finalPrompt = await refinePromptWithAI(basePrompt)

    setPrompt(finalPrompt)
    setBuiltAt(new Date().toLocaleTimeString())
    const usageCount = incrementToolUsage("prompt")
    setRepeatUsageCount(usageCount)
    pushOutputHistory({
      tool: "prompt",
      title: "Prompt template created",
      summary: topic.slice(0, 72),
      continuePath: "/dashboard/tools/video",
      nextAction: "Apply this prompt to generate scripts.",
    })
  }

  return (
    <ToolPageShell
      toolId="prompt"
      title="Prompt Intelligence"
      subtitle="Build layered, retention-aware prompt templates locally in your browser."
      guidance="Use this when you want consistent prompt structure for a niche, offer, or audience segment."
      statusLabel={blockedMessage || "Template tool (no credits required)"}
      statusTone={blockedMessage ? "warning" : "success"}
    >
      <div className="mx-auto max-w-6xl pb-20">
        <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/70">
          Prompt Intelligence is a local template utility: it does not call the AI backend.
          Use the output directly or pass it into Video Script Engine.
        </div>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Core topic, offer, or story premise..."
          className="mb-4 w-full rounded-xl border border-white/10 bg-white/5 p-4"
          rows={4}
        />

        <input
          type="text"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder="Audience (e.g. beginner creators 18–30, burned out on trends)"
          className="mb-6 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
        />

        <select
          value={presetId}
          onChange={(e) => setPresetId(e.target.value as PresetId)}
          className="np-select mb-3 w-full"
        >
          {PROMPT_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
        <p className="mb-6 text-xs leading-relaxed text-white/55">
          {getPresetById(presetId).summary}
        </p>
        <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/56">
            Use case examples
          </p>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-white/65">
            {getPresetById(presetId).useCases.map((useCase) => (
              <li key={useCase}>• {useCase}</li>
            ))}
          </ul>
        </div>

        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform)}
          className="np-select mb-6 w-full"
        >
          <option>TikTok</option>
          <option>Instagram Reels</option>
          <option>YouTube Shorts</option>
          <option>X / Threads</option>
          <option>LinkedIn</option>
        </select>

        <select
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          className="np-select mb-6 w-full"
        >
          <option>Viral TikTok</option>
          <option>Authority Content</option>
          <option>Emotional Story</option>
          <option>Contrarian Take</option>
          <option>Product Launch</option>
          <option>Tutorial Deep-Dive</option>
          <option>UGC Testimonial</option>
        </select>

        <p className="mb-6 text-xs leading-relaxed text-white/45">{styleHints}</p>

        <button
          onClick={() => {
            void generatePrompt()
          }}
          disabled={!canGenerate}
          className="w-full rounded-full bg-gradient-to-r from-blue-500 to-purple-600 py-4 font-semibold disabled:opacity-50"
        >
          Build Prompt Template
        </button>
        {error && <p className="mt-3 text-sm text-red-300/95">{error}</p>}
        {repeatUsageCount >= 3 && (
          <p className="mt-3 text-sm text-purple-200">
            You’re using Prompt Intelligence frequently. Upgrade for higher throughput across the full
            workflow.
            <a href="/pricing" className="ml-2 underline">
              Upgrade
            </a>
          </p>
        )}

        {prompt && (
          <div className="mt-8 rounded-xl border border-white/10 bg-white/5 p-6">
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(prompt)
                    setCopied(true)
                    setError(null)
                    window.setTimeout(() => setCopied(false), 1600)
                  } catch {
                    setError("Clipboard access failed. Copy manually from the text area.")
                  }
                }}
                className="rounded-lg border border-white/15 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
              >
                {copied ? "Copied" : "Copy prompt"}
              </button>
            </div>
            {builtAt ? (
              <p className="mb-3 text-xs text-white/45">
                Template built locally at {builtAt}.
              </p>
            ) : null}
            <p className="whitespace-pre-line text-gray-300">{prompt}</p>
          </div>
        )}
      </div>
    </ToolPageShell>
  )
}
