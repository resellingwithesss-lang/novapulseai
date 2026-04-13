"use client"

import { buildToolHandoffUrl } from "@/lib/tool-handoff"
import ToolResultLayout from "@/components/tools/results/ToolResultLayout"

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
}

export default function VideoScriptResults({
  result,
  onCopyAll,
}: VideoScriptResultsProps) {
  const primaryScript = result[0]
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
        { label: "Open Story Video Maker", href: "/dashboard/tools/story-video-maker" },
      ]}
    >
      <div className="mb-3 rounded-xl border border-pink-500/25 bg-pink-500/10 px-3 py-2 text-xs text-pink-100">
        Next level: Turn this into a full video with Elite Story Video Maker.
      </div>
      <div className="mt-2 space-y-6">
        {result.map((script, i) => (
          <ScriptCard key={i} script={script} index={i} />
        ))}
      </div>
    </ToolResultLayout>
  )
}

function ScriptCard({
  script,
  index,
}: {
  script: ScriptOutput
  index: number
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
    <div className="bg-white/5 p-8 rounded-2xl border border-white/10 space-y-6">
      <h2 className="text-xl font-semibold text-purple-400">
        Variation {index + 1}
      </h2>
      <div className="flex items-center gap-4 text-xs">
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

      <Block title="Hook" content={script.hook} />
      <Block title="Open Loop" content={script.openLoop} />
      <Block title="Body" content={script.body} />
      <Block title="CTA" content={script.cta} />
      <Block title="Caption" content={script.caption} />
      <Block title="Hashtags" content={script.hashtags.join(" ")} />
    </div>
  )
}
