"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import ToolPageShell from "@/components/tools/ToolPageShell"
import { formatBlockedReason, useEntitlementSnapshot } from "@/hooks/useEntitlementSnapshot"
import { incrementToolUsage, pushOutputHistory } from "@/lib/growth"

export default function PromptPage() {
  const searchParams = useSearchParams()
  const { entitlement } = useEntitlementSnapshot()
  const [topic, setTopic] = useState("")
  const [audience, setAudience] = useState("")
  const [style, setStyle] = useState("Viral TikTok")
  const [prompt, setPrompt] = useState("")
  const [copied, setCopied] = useState(false)
  const [repeatUsageCount, setRepeatUsageCount] = useState(0)

  useEffect(() => {
    const handoffTopic = searchParams.get("topic")
    const handoffStyle = searchParams.get("style")
    if (handoffTopic) setTopic(handoffTopic)
    if (handoffStyle) setStyle(handoffStyle)
  }, [searchParams])

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
    const audienceLine = audience.trim()
      ? `Target viewer: ${audience.trim()}`
      : "Target viewer: define niche, age band, and primary pain in one line."

    const finalPrompt = `ROLE: You are a short-form retention editor (TikTok / Reels / Shorts).

BRIEF:
${topic.trim() || "[Insert your core topic or offer]"}

${audienceLine}

FORMAT STYLE: ${style}
Style notes: ${styleHints}

STRUCTURE (spoken script outline):
1) HOOK (0–2s): pattern interrupt + curiosity gap — no "Hey guys" / no "In this video".
2) CONTEXT (2–8s): why this matters now; one relatable line.
3) VALUE LADDER: 3–5 beats; each beat raises tension, novelty, or clarity.
4) PROOF BEAT: one concrete detail (metric, anecdote, demo, or contrast) — no fabricated stats.
5) COMMENT BAIT: one polarizing-but-safe line or question.
6) CTA: one action (save, follow, stitch, DM keyword, link in bio) tied to the goal.

CAPTION / SUBS:
- Max ~14 words per on-screen line.
- Assume sound-on but captions must read well muted.

OUTPUT:
Write the full spoken script only (no stage directions). Then one platform caption (under 220 chars) and 8–12 hashtags as a single line.`

    setPrompt(finalPrompt)
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
      subtitle="Build layered, retention-aware prompt templates — tuned for hooks, ladders, and distribution."
      guidance="Use this when you want repeatable quality for a niche, offer, or audience segment."
      statusLabel={blockedMessage || "No credits required"}
      statusTone={blockedMessage ? "warning" : "success"}
    >
      <div className="mx-auto max-w-6xl pb-20">
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
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          className="mb-6 w-full rounded-xl border border-white/10 bg-[#0f172a] p-3"
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
          onClick={generatePrompt}
          disabled={!canGenerate}
          className="w-full rounded-full bg-gradient-to-r from-blue-500 to-purple-600 py-4 font-semibold disabled:opacity-50"
        >
          Generate Prompt
        </button>
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
                  await navigator.clipboard.writeText(prompt)
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 1600)
                }}
                className="rounded-lg border border-white/15 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
              >
                {copied ? "Copied" : "Copy prompt"}
              </button>
            </div>
            <p className="whitespace-pre-line text-gray-300">{prompt}</p>
          </div>
        )}
      </div>
    </ToolPageShell>
  )
}
