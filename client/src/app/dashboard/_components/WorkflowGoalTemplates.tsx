"use client"

import Link from "next/link"

const TEMPLATES: Array<{
  label: string
  sub: string
  href: string
}> = [
  {
    label: "Faceless reel pack",
    sub: "Hooks + script angles",
    href: "/dashboard/tools/video",
  },
  {
    label: "Storytime arc",
    sub: "Narrative + captions",
    href: "/dashboard/tools/story-maker",
  },
  {
    label: "UGC site promo",
    sub: "URL → video ad",
    href: "/dashboard/tools/ai-ad-generator",
  },
  {
    label: "Clip batch",
    sub: "Long video → shorts",
    href: "/dashboard/tools/clipper",
  },
  {
    label: "Prompt system",
    sub: "Reusable briefs",
    href: "/dashboard/tools/prompt",
  },
]

export default function WorkflowGoalTemplates() {
  return (
    <section className="np-card p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-white/40">
        Start from a workflow
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-white/50">
        Goal-based entry points — each opens the right tool so you ship faster.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {TEMPLATES.map((t) => (
          <Link
            key={t.href + t.label}
            href={t.href}
            className="group rounded-xl border border-white/[0.078] bg-black/25 px-4 py-3 text-left outline-none transition-[border-color,background-color] duration-200 hover:border-purple-400/22 hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
          >
            <span className="block text-sm font-medium tracking-[-0.01em] text-white/[0.97] group-hover:text-white">
              {t.label}
            </span>
            <span className="mt-0.5 block text-xs text-white/48">{t.sub}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
