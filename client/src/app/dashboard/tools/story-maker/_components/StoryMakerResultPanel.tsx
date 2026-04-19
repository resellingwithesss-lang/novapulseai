"use client"

import Link from "next/link"
import { useState } from "react"
import ToolResultLayout from "@/components/tools/results/ToolResultLayout"
import { buildToolHandoffUrl } from "@/lib/tool-handoff"
import type { ImproveScriptMode } from "@/lib/local-script-improve"

type StoryOutput = {
  title: string
  hook: string
  script: string
  caption: string
  hashtags: string[]
  retentionBreakdown?: {
    hookType: string
    escalationMoments: string
    emotionalSpike: string
    endingMechanism: string
  }
  pinComment?: string
  productionNotes?: string
}

type StoryMakerResultPanelProps = {
  result: StoryOutput
  improveActionsLimit?: number
  improveUses?: number
  onImprove?: (mode: ImproveScriptMode) => void
}

export default function StoryMakerResultPanel({
  result,
  improveActionsLimit = 0,
  improveUses = 0,
  onImprove,
}: StoryMakerResultPanelProps) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [showBreakdown, setShowBreakdown] = useState(false)
  const improveRemaining = Math.max(0, improveActionsLimit - improveUses)

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(
        [
          result.hook,
          "",
          result.script,
          "",
          result.caption,
          "",
          result.hashtags.join(" "),
          result.pinComment ? `\nPin comment:\n${result.pinComment}` : "",
          result.productionNotes ? `\nProduction notes:\n${result.productionNotes}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      )

      setCopied(true)
      setCopyError(null)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyError("Clipboard access failed. Copy text directly from the sections below.")
    }
  }

  return (
    <ToolResultLayout
      title={result.title}
      state="success"
      statusLabel="Ready"
      summary="Structured output ready for editing, voiceover, or repurposing in downstream tools."
      keyOutputs={[
        { label: "Hook", value: result.hook.slice(0, 52) },
        { label: "Caption", value: result.caption.slice(0, 52) },
        { label: "Hashtags", value: `${result.hashtags.length}` },
      ]}
      actions={[
        {
          label: copied ? "Copied" : "Copy All",
          onClick: () => {
            void copyAll()
          },
        },
        {
          label: "Open Prompt Intelligence",
          href: "/dashboard/tools/prompt",
          tone: "secondary",
        },
      ]}
      recoveryActions={[
        { label: "Generate Another Story", href: "/dashboard/tools/story-maker" },
      ]}
      nextSteps={[
        {
          label: "Turn into Video Ad",
          href: buildToolHandoffUrl("/dashboard/tools/ai-ad-generator", {
            topic: result.hook,
          }),
        },
        { label: "Refine Prompt", href: "/dashboard/tools/prompt" },
      ]}
    >
      <div className="mb-3 rounded-xl border border-purple-500/25 bg-purple-500/10 px-3 py-2 text-xs text-purple-100">
        Upgrade path: scale this story into multiple production-ready variants with Pro/Elite workflows.
      </div>
      {onImprove && improveActionsLimit > 0 ? (
        <div className="mb-4 space-y-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/60">
            <span>
              Improve passes left:{" "}
              <span className="font-semibold text-white/85">{improveRemaining}</span>
            </span>
            {improveRemaining === 0 ? (
              <Link
                href="/dashboard/billing"
                className="font-medium text-violet-200 underline-offset-2 hover:underline"
              >
                Unlock more on higher plans
              </Link>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { mode: "aggressive" as const, label: "More aggressive" },
                { mode: "shorter" as const, label: "Shorten" },
                { mode: "conversion" as const, label: "Rewrite for conversions" },
              ] as const
            ).map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                disabled={improveRemaining <= 0}
                onClick={() => onImprove(mode)}
                className="rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-white/40">Local refinements — no extra credit.</p>
        </div>
      ) : null}
      {copyError ? (
        <div className="mb-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200/95">
          {copyError}
        </div>
      ) : null}
      <div className="space-y-5">
        <Section title="Hook" content={result.hook} />
        <Section title="Script" content={result.script} />
        <Section title="Caption" content={result.caption} />
        <Section title="Hashtags" content={result.hashtags.join(" ")} />

        {result.pinComment ? (
          <Section title="Pin comment (first comment)" content={result.pinComment} />
        ) : null}
        {result.productionNotes ? (
          <Section title="Production notes (B-roll / sound / cuts)" content={result.productionNotes} />
        ) : null}

        {result.retentionBreakdown && (
          <div>
            <button
              onClick={() => setShowBreakdown(!showBreakdown)}
              className="text-xs text-purple-400 underline"
            >
              {showBreakdown
                ? "Hide Retention Breakdown"
                : "Show Retention Breakdown"}
            </button>

            {showBreakdown && (
              <div className="mt-4 space-y-2 text-sm text-gray-400">
                <div>Hook Type: {result.retentionBreakdown.hookType}</div>
                <div>Escalation: {result.retentionBreakdown.escalationMoments}</div>
                <div>Emotional Spike: {result.retentionBreakdown.emotionalSpike}</div>
                <div>Ending: {result.retentionBreakdown.endingMechanism}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </ToolResultLayout>
  )
}

function Section({
  title,
  content,
}: {
  title: string
  content: string
}) {
  return (
    <div>
      <h3 className="text-purple-400 font-semibold mb-2">
        {title}
      </h3>
      <p className="whitespace-pre-line text-gray-300 leading-relaxed">
        {content}
      </p>
    </div>
  )
}
