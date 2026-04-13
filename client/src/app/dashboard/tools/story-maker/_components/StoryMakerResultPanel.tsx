"use client"

import { useState } from "react"
import ToolResultLayout from "@/components/tools/results/ToolResultLayout"
import { buildToolHandoffUrl } from "@/lib/tool-handoff"

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
}

export default function StoryMakerResultPanel({
  result,
}: StoryMakerResultPanelProps) {
  const [copied, setCopied] = useState(false)
  const [showBreakdown, setShowBreakdown] = useState(false)

  const copyAll = async () => {
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
    setTimeout(() => setCopied(false), 2000)
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
          href: buildToolHandoffUrl("/dashboard/tools/story-video-maker", {
            topic: result.hook,
          }),
        },
        { label: "Refine Prompt", href: "/dashboard/tools/prompt" },
      ]}
    >
      <div className="mb-3 rounded-xl border border-purple-500/25 bg-purple-500/10 px-3 py-2 text-xs text-purple-100">
        Upgrade path: scale this story into multiple production-ready variants with Pro/Elite workflows.
      </div>
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
