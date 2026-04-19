"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Copy, Download, RotateCcw, Sparkles } from "lucide-react"
import ToolPageShell from "@/components/tools/ToolPageShell"
import {
  ToolErrorPanel,
  ToolInputSection,
  ToolOutputSection,
  ToolPrimaryCta,
  ToolUpgradeHint,
} from "@/components/tools/ToolWorkspace"
import { tools } from "@/config/tools"
import { formatBlockedReason, useEntitlementSnapshot } from "@/hooks/useEntitlementSnapshot"
import { incrementToolUsage, pushOutputHistory } from "@/lib/growth"
import { useAuth } from "@/context/AuthContext"
import { displayPlanForUser, getPlanOutputLimits } from "@/lib/plans"
import {
  VARIANT_META,
  buildPromptDocument,
  documentHasImproveMarker,
  improveMarker,
  improveSnippet,
  type ImproveKind,
  type Platform,
  type PromptVariantId,
} from "./prompt-build"

const VARIANT_ORDER: PromptVariantId[] = ["balanced", "bold", "lean", "convert"]
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
  const { user } = useAuth()
  const { entitlement } = useEntitlementSnapshot()
  const [topic, setTopic] = useState("")
  const [audience, setAudience] = useState("")
  const [style, setStyle] = useState("Viral TikTok")
  const [presetId, setPresetId] = useState<PresetId>("UGC_AD")
  const [platform, setPlatform] = useState<Platform>("TikTok")
  const [variantPack, setVariantPack] = useState<Partial<Record<PromptVariantId, string>>>({})
  const [activeVariant, setActiveVariant] = useState<PromptVariantId>("balanced")
  const [improvementsByVariant, setImprovementsByVariant] = useState<
    Record<PromptVariantId, string[]>
  >({ balanced: [], bold: [], lean: [], convert: [] })
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [builtAt, setBuiltAt] = useState<string | null>(null)
  const [repeatUsageCount, setRepeatUsageCount] = useState(0)

  const promptToolMeta = tools.find((t) => t.id === "prompt")

  const activeBase = variantPack[activeVariant] ?? ""
  const activeExtras = improvementsByVariant[activeVariant] ?? []
  const activeFullPrompt = activeBase + activeExtras.join("")
  const wordCount = activeFullPrompt.trim() ? activeFullPrompt.trim().split(/\s+/).length : 0

  const uiPlan = user ? displayPlanForUser(user.plan, user.role) : "FREE"
  const improveCap =
    entitlement?.improveActionsLimit ?? getPlanOutputLimits(uiPlan).improveActionsLimit
  const improvePassesUsed = useMemo(
    () =>
      Object.values(improvementsByVariant).reduce((sum, arr) => sum + arr.length, 0),
    [improvementsByVariant]
  )

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

  const generatePrompt = () => {
    if (!canGenerate) return
    if (topic.trim().length < 3) {
      setError("Add a clear topic (at least 3 characters) before generating.")
      return
    }
    setError(null)

    const preset = getPresetById(presetId)
    const nextPack: Partial<Record<PromptVariantId, string>> = {}
    for (const v of VARIANT_ORDER) {
      nextPack[v] = buildPromptDocument({
        preset,
        platform,
        style,
        topic: topic.trim(),
        audience,
        variant: v,
      })
    }
    setVariantPack(nextPack)
    setImprovementsByVariant({
      balanced: [],
      bold: [],
      lean: [],
      convert: [],
    })
    setActiveVariant("balanced")
    setBuiltAt(new Date().toLocaleTimeString())
    const usageCount = incrementToolUsage("prompt")
    setRepeatUsageCount(usageCount)
    pushOutputHistory({
      tool: "prompt",
      title: "Prompt pack created (4 variants)",
      summary: topic.slice(0, 72),
      continuePath: "/dashboard/tools/video",
      nextAction: "Paste a variant into your model or open Video Script Engine.",
    })
  }

  const applyImprove = (kind: ImproveKind) => {
    if (improvePassesUsed >= improveCap) {
      setError(
        "You’ve reached your Improve limit for this plan. Upgrade for more stacked passes per pack."
      )
      return
    }
    setError(null)
    const base = variantPack[activeVariant] ?? ""
    const extras = [...(improvementsByVariant[activeVariant] ?? [])]
    const candidate = base + extras.join("")
    if (documentHasImproveMarker(candidate, kind)) return
    extras.push(improveSnippet(kind))
    setImprovementsByVariant({ ...improvementsByVariant, [activeVariant]: extras })
  }

  const resetActiveTweaks = () => {
    setImprovementsByVariant({ ...improvementsByVariant, [activeVariant]: [] })
  }

  const copyActiveVariant = async () => {
    try {
      await navigator.clipboard.writeText(activeFullPrompt)
      setCopied(true)
      setError(null)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setError("Couldn’t access the clipboard. Select the text and copy manually.")
    }
  }

  const copyAllVariants = async () => {
    const chunks = VARIANT_ORDER.map((id) => {
      const b = variantPack[id] ?? ""
      const e = (improvementsByVariant[id] ?? []).join("")
      const meta = VARIANT_META[id]
      return `═══ ${meta.label.toUpperCase()}${meta.badge ? ` · ${meta.badge}` : ""} ═══\n\n${b}${e}`
    })
    try {
      await navigator.clipboard.writeText(chunks.join("\n\n\n"))
      setCopied(true)
      setError(null)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setError("Couldn’t access the clipboard.")
    }
  }

  const downloadAllVariants = () => {
    const chunks = VARIANT_ORDER.map((id) => {
      const b = variantPack[id] ?? ""
      const e = (improvementsByVariant[id] ?? []).join("")
      const meta = VARIANT_META[id]
      return `=== ${meta.label} ===\n\n${b}${e}`
    })
    const blob = new Blob([chunks.join("\n\n\n\n")], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `novapulse-prompt-pack-${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasPack = VARIANT_ORDER.some((id) => Boolean(variantPack[id]?.trim()))

  return (
    <ToolPageShell
      toolId="prompt"
      title="Prompt Intelligence"
      outcome={promptToolMeta?.outcome}
      subtitle="One tap builds four strategic prompt variants — Improve passes stack locally (no credits). More passes on higher plans."
      guidance="Give a specific topic and audience. Pick a preset + platform — we handle structure, constraints, and A/B-ready variation notes."
      statusLabel={blockedMessage || "No credits used — builds locally"}
      statusTone={blockedMessage ? "warning" : "success"}
    >
      <div className="mx-auto max-w-6xl space-y-6 pb-20">
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-white/10 bg-gradient-to-r from-purple-500/[0.07] to-fuchsia-500/[0.05] px-4 py-3">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-purple-300" aria-hidden />
          <p className="text-xs leading-relaxed text-white/70">
            <span className="font-semibold text-white/88">What you get:</span> four complete prompt documents
            (same core brief, different strategic bias) — each with role, objective, strict output sections, and
            constraints. Refine any tab with <span className="text-white/88">Improve</span> passes, then paste into
            ChatGPT / Claude or{" "}
            <a href="/dashboard/tools/video" className="font-medium text-purple-200 underline">
              Video Script Engine
            </a>
            .
          </p>
        </div>

        <ToolInputSection
          title="What are you making?"
          description="One specific topic + one specific audience beats a vague niche every time."
        >
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Why we replaced our funnel with a single Loom + a Notion page — and doubled booked calls"
            className="mb-3 w-full rounded-xl border border-white/10 bg-white/5 p-4 text-sm outline-none transition focus:border-purple-400/40 focus:ring-2 focus:ring-purple-400/20"
            rows={3}
          />
          <input
            type="text"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="Who watches this? (e.g. B2B marketers doing demand gen with small teams)"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none transition focus:border-purple-400/40"
          />
        </ToolInputSection>

        <ToolInputSection
          title="Creative preset"
          description="Tap a card — each preset ships a different strategic skeleton (still the same quality bar)."
        >
          <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {PROMPT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setPresetId(preset.id)}
                className={`min-w-[148px] shrink-0 rounded-xl border px-3 py-2.5 text-left text-xs transition ${
                  presetId === preset.id
                    ? "border-purple-400/45 bg-purple-500/15 text-white shadow-[0_0_24px_-8px_rgba(168,85,247,0.5)]"
                    : "border-white/10 bg-black/25 text-white/70 hover:border-white/20 hover:bg-white/[0.04]"
                }`}
              >
                <span className="block font-semibold text-white/92">{preset.label}</span>
                <span className="mt-1 block leading-snug text-white/50">{preset.summary}</span>
              </button>
            ))}
          </div>
        </ToolInputSection>

        <ToolInputSection
          title="Channel"
          description="We bake platform-native pacing into the prompt so the model doesn’t sound generic."
        >
          <div className="flex flex-wrap gap-2">
            {(
              [
                "TikTok",
                "Instagram Reels",
                "YouTube Shorts",
                "X / Threads",
                "LinkedIn",
              ] as Platform[]
            ).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                className={`rounded-full border px-3.5 py-2 text-xs font-medium transition ${
                  platform === p
                    ? "border-purple-400/50 bg-purple-500/20 text-white"
                    : "border-white/12 bg-white/[0.04] text-white/65 hover:border-white/22"
                }`}
              >
                {p === "Instagram Reels" ? "Reels" : p === "YouTube Shorts" ? "Shorts" : p === "X / Threads" ? "X" : p}
              </button>
            ))}
          </div>
        </ToolInputSection>

        <details className="np-card open:border-purple-500/25 open:bg-white/[0.02] p-5">
          <summary className="cursor-pointer list-none text-sm font-semibold text-white/88 [&::-webkit-details-marker]:hidden">
            Advanced: delivery style
            <span className="ml-2 text-xs font-normal text-white/45">(optional — auto-matched to preset)</span>
          </summary>
          <div className="mt-4 space-y-3">
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="np-select w-full max-w-md"
            >
              <option>Viral TikTok</option>
              <option>Authority Content</option>
              <option>Emotional Story</option>
              <option>Contrarian Take</option>
              <option>Product Launch</option>
              <option>Tutorial Deep-Dive</option>
              <option>UGC Testimonial</option>
            </select>
            <p className="text-xs leading-relaxed text-white/48">{styleHints}</p>
            <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/55">
              <span className="font-medium text-white/70">Preset fit: </span>
              {getPresetById(presetId).useCases[0]}
            </div>
          </div>
        </details>

        <ToolPrimaryCta
          onClick={generatePrompt}
          disabled={!canGenerate}
          helperText={
            blockedMessage
              ? blockedMessage
              : "Builds 4 variants instantly on your device. Starter+ required to use this tool in production."
          }
        >
          Generate 4 prompt variants
        </ToolPrimaryCta>

        {error ? <ToolErrorPanel message={error} /> : null}

        {repeatUsageCount >= 3 ? (
          <ToolUpgradeHint message="You’re shipping a lot of creative briefs — upgrade for higher monthly credits on Video Script, Story Maker, Clipper, and Elite ads." />
        ) : null}

        {uiPlan === "STARTER" && hasPack ? (
          <ToolUpgradeHint
            message="Pro adds more monthly credits and Story Maker — turn these prompts into narrative scripts without leaving the stack."
            cta="View Pro"
          />
        ) : null}

        {hasPack ? (
          <ToolOutputSection
            title="Your prompt studio"
            description="Switch variants for different angles. Stack Improve passes on the active tab — each pass appends a revision block your model will follow."
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              {builtAt ? (
                <p className="text-xs text-white/45">
                  Pack built <span className="text-white/65">{builtAt}</span>
                  <span className="ml-2 text-white/35">· ~{wordCount} words (active tab)</span>
                </p>
              ) : (
                <span />
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyActiveVariant()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/88 hover:bg-white/10"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  {copied ? "Copied" : "Copy tab"}
                </button>
                <button
                  type="button"
                  onClick={() => void copyAllVariants()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/88 hover:bg-white/10"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  Copy all 4
                </button>
                <button
                  type="button"
                  onClick={downloadAllVariants}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/15"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  Download .txt
                </button>
              </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2 border-b border-white/10 pb-3">
              {VARIANT_ORDER.map((id) => {
                const meta = VARIANT_META[id]
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveVariant(id)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      activeVariant === id
                        ? "border-purple-400/45 bg-purple-500/20 text-white"
                        : "border-white/10 bg-black/30 text-white/60 hover:border-white/18"
                    }`}
                  >
                    {meta.label}
                    {meta.badge ? (
                      <span className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-200">
                        {meta.badge}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>

            <p className="mb-3 text-xs leading-relaxed text-white/52">{VARIANT_META[activeVariant].hint}</p>

            <div className="mb-4 flex flex-wrap gap-2">
              <span className="w-full text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
                Improve active variant
              </span>
              {(
                [
                  { kind: "shorter" as const, label: "Tighten" },
                  { kind: "aggressive" as const, label: "More aggressive" },
                  { kind: "conversion" as const, label: "Rewrite for conversions" },
                ] as const
              ).map(({ kind, label }) => {
                const applied = documentHasImproveMarker(activeFullPrompt, kind)
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={applied || improvePassesUsed >= improveCap}
                    onClick={() => applyImprove(kind)}
                    className="rounded-full border border-white/12 bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    title={applied ? `${improveMarker(kind)} already added` : undefined}
                  >
                    {label}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={resetActiveTweaks}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/55 hover:bg-white/5"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Reset tab tweaks
              </button>
            </div>

            <pre className="max-h-[min(520px,55vh)] overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-[13px] leading-relaxed text-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              {activeFullPrompt}
            </pre>

            <p className="mt-4 text-xs text-white/45">
              Next:{" "}
              <a href="/dashboard/tools/video" className="font-medium text-purple-200 underline">
                Open Video Script Engine with this brief →
              </a>
            </p>
          </ToolOutputSection>
        ) : null}
      </div>
    </ToolPageShell>
  )
}
