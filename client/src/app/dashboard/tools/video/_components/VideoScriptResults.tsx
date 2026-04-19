"use client"

import Link from "next/link"
import { buildToolHandoffUrl } from "@/lib/tool-handoff"
import ToolResultLayout from "@/components/tools/results/ToolResultLayout"
import type { ImproveScriptMode } from "@/lib/local-script-improve"

type ScriptOutput = {
  hook: string
  openLoop: string
  body: string
  cta: string
  caption: string
  hashtags: string[]
}

type VideoScriptResultsProps = {
  result: ScriptOutput[]
  onCopyAll: () => void
  improveActionsLimit?: number
  improveUses?: number
  onImprove?: (index: number, mode: ImproveScriptMode) => void
}

export default function VideoScriptResults({
  result,
  onCopyAll,
  improveActionsLimit = 0,
  improveUses = 0,
  onImprove,
}: VideoScriptResultsProps) {
  const primaryScript = result[0]
  const improveRemaining = Math.max(0, improveActionsLimit - improveUses)
  return (
    <ToolResultLayout
      title="Generated Scripts"
      state={result.length > 0 ? "success" : "empty"}
      statusLabel={result.length > 0 ? `${result.length} variations` : "No output"}
      summary="Use these scripts as publish-ready drafts or hand them off to other tools."
      emptyMessage="No script output returned yet. Generate again with a clearer topic."
      actions={[
        { label: "Copy All Variations", onClick: onCopyAll },
        primaryScript
          ? {
              label: "Send Top Hook to Prompt",
              href: buildToolHandoffUrl("/dashboard/tools/prompt", {
                topic: primaryScript.hook,
                style: "Viral TikTok",
              }),
              tone: "secondary",
            }
          : { label: "Open Prompt", href: "/dashboard/tools/prompt", tone: "secondary" },
      ]}
      recoveryActions={[
        { label: "Regenerate Scripts", href: "/dashboard/tools/video" },
      ]}
      nextSteps={[
        { label: "Open Story Maker", href: "/dashboard/tools/story-maker" },
        { label: "Open Clipper", href: "/dashboard/tools/clipper" },
        { label: "Open AI Ad Generator", href: "/dashboard/tools/ai-ad-generator" },
      ]}
    >
      <div className="mb-3 rounded-xl border border-pink-500/25 bg-pink-500/10 px-3 py-2 text-xs text-pink-100">
        Elite: turn a winning script into a finished ad — AI Ad Generator builds video, voiceover, and variants from your product URL.
      </div>
      {onImprove && improveActionsLimit > 0 ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60">
          <span>
            Improve passes left this run:{" "}
            <span className="font-semibold text-white/85">{improveRemaining}</span>
          </span>
          {improveRemaining === 0 ? (
            <Link href="/dashboard/billing" className="font-medium text-violet-200 underline-offset-2 hover:underline">
              Unlock more improve passes on higher plans
            </Link>
          ) : null}
        </div>
      ) : null}
      <div className="mt-2 space-y-6">
        {result.map((script, i) => (
          <ScriptCard
            key={i}
            script={script}
            index={i}
            isTopPick={i === 0}
            onImprove={onImprove}
            improveDisabled={!onImprove || improveRemaining <= 0}
          />
        ))}
      </div>
    </ToolResultLayout>
  )
}

function ScriptCard({
  script,
  index,
  isTopPick,
  onImprove,
  improveDisabled,
}: {
  script: ScriptOutput
  index: number
  isTopPick?: boolean
  onImprove?: (index: number, mode: ImproveScriptMode) => void
  improveDisabled?: boolean
}) {
  const Block = ({
    title,
    content,
  }: {
    title: string
    content: string
  }) => (
    <div className="bg-white/5 p-6 rounded-xl border border-white/10">
      <div className="flex justify-between mb-3">
        <h3 className="text-purple-400 font-semibold">{title}</h3>

        <button
          onClick={() => navigator.clipboard.writeText(content)}
          className="text-xs text-gray-400 hover:text-white"
        >
          Copy
        </button>
      </div>

      <p className="whitespace-pre-line text-sm">{content}</p>
    </div>
  )

  return (
    <div
      className={`space-y-6 rounded-2xl border p-8 ${
        isTopPick
          ? "border-emerald-400/35 bg-gradient-to-b from-emerald-500/[0.08] to-white/[0.04]"
          : "border-white/10 bg-white/5"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold text-purple-400">Variation {index + 1}</h2>
        {isTopPick ? (
          <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-200">
            Top pick
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <a
          href={buildToolHandoffUrl("/dashboard/tools/prompt", {
            topic: script.hook,
            style: "Viral TikTok",
          })}
          className="text-emerald-300 hover:text-emerald-200"
        >
          Send hook to Prompt Intelligence
        </a>
      </div>

      {onImprove ? (
        <div className="flex flex-wrap gap-2">
          <span className="w-full text-[10px] font-semibold uppercase tracking-[0.12em] text-white/35">
            Improve (local, no extra credit)
          </span>
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
              disabled={improveDisabled}
              onClick={() => onImprove(index, mode)}
              className="rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      <Block title="Hook" content={script.hook} />
      <Block title="Open Loop" content={script.openLoop} />
      <Block title="Body" content={script.body} />
      <Block title="CTA" content={script.cta} />
      <Block title="Caption" content={script.caption} />
      <Block title="Hashtags" content={script.hashtags.join(" ")} />
    </div>
  )
}
