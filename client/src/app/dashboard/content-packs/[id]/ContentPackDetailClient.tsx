"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Clapperboard, Film, Scissors, ScrollText } from "lucide-react"
import DashboardShell from "@/components/dashboard/DashboardShell"
import { ContentPackDetailSkeleton } from "@/components/workflow/WorkflowPageSkeletons"
import { fetchContentPack, type ContentPackDto } from "@/lib/workflowApi"
import { countPackPayloadLines } from "@/lib/contentPackPayload"
import { buildToolHandoffUrl } from "@/lib/tool-handoff"

type PackPayload = {
  hooks?: string[]
  scripts?: string[]
  titles?: string[]
  captions?: string[]
  ctas?: string[]
  clipAngles?: string[]
}

const SCRIPT_TOPIC_MAX = 500
const STORY_TOPIC_MAX = 600
const BRIEF_MAX = 1200
const ANGLE_MAX = 800

function clampText(s: string, max: number) {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1).trimEnd()}…`
}

function adsPlatformLabel(platform: string) {
  const u = platform.toLowerCase()
  if (u.includes("instagram")) return "instagram"
  if (u.includes("youtube")) return "youtube"
  return "tiktok"
}

async function copyLine(label: string, text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    window.prompt(`Copy ${label}`, text)
  }
}

function LineRow({
  text,
  actions,
}: {
  text: string
  actions: { label: string; href?: string; onClick?: () => void }[]
}) {
  return (
    <li className="rounded-lg border border-white/10 bg-black/20 p-3">
      <p className="whitespace-pre-wrap text-sm text-white/85">{text}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {actions.map((a) =>
          a.href ? (
            <Link
              key={a.label}
              href={a.href}
              className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-medium text-purple-200 hover:bg-white/10"
            >
              {a.label}
            </Link>
          ) : (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/75 hover:bg-white/10"
            >
              {a.label}
            </button>
          )
        )}
      </div>
    </li>
  )
}

function LinesSection({
  title,
  lines,
  renderActions,
}: {
  title: string
  lines: string[] | undefined
  renderActions: (line: string) => { label: string; href?: string; onClick?: () => void }[]
}) {
  if (!lines?.length) return null
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-300/90">{title}</h3>
      <ul className="mt-3 space-y-2">
        {lines.map((line, i) => (
          <LineRow key={i} text={line} actions={renderActions(line)} />
        ))}
      </ul>
    </div>
  )
}

export default function ContentPackDetailClient({ id }: { id: string }) {
  const [pack, setPack] = useState<ContentPackDto | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let alive = true
    void (async () => {
      try {
        const p = await fetchContentPack(id)
        if (!alive) return
        setPack(p)
      } catch {
        if (!alive) return
        setError("Failed to load pack.")
        setPack(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [id])

  const payload = (pack?.payload ?? {}) as PackPayload
  const packLineTotal = pack ? countPackPayloadLines(pack.payload).total : 0
  const hasLineBody = packLineTotal > 0

  const regenerateHref =
    pack &&
    buildToolHandoffUrl("/dashboard/content-packs", {
      prefillTopic: clampText(pack.topic, 500),
      prefillPlatform: pack.platform,
      prefillAudience: pack.audience || undefined,
      workspaceId: pack.workspaceId || undefined,
      brandVoiceId: pack.brandVoiceId || undefined,
    })

  const commonSource = pack
    ? {
        workspaceId: pack.workspaceId || undefined,
        brandVoiceId: pack.brandVoiceId || undefined,
        sourceContentPackId: pack.id,
        sourceType: "CONTENT_PACK" as const,
      }
    : null

  return (
    <DashboardShell showCommandHero={false} contentWidth="readable">
      <div className="space-y-8 pb-16">
        <Link href="/dashboard/content-packs" className="text-sm text-purple-300 underline">
          ← All packs
        </Link>

        {pack === undefined && (
          <>
            <h1 className="text-2xl font-semibold text-white">Content pack</h1>
            <ContentPackDetailSkeleton />
          </>
        )}
        {error && (
          <>
            <h1 className="text-2xl font-semibold text-white">Content pack</h1>
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          </>
        )}
        {pack === null && !error && (
          <>
            <h1 className="text-2xl font-semibold text-white">Pack not found</h1>
            <p className="text-sm text-white/55">This pack may have been removed or the link is incorrect.</p>
          </>
        )}
        {pack && (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-white">{pack.title}</h1>
                <p className="mt-2 text-sm text-white/55">{pack.topic}</p>
                <p className="mt-1 text-xs text-white/40">
                  {pack.platform}
                  {pack.audience ? ` · ${pack.audience}` : ""} ·{" "}
                  {new Date(pack.createdAt).toLocaleString()}
                </p>
              </div>
              {regenerateHref && (
                <Link
                  href={regenerateHref}
                  className="shrink-0 rounded-full border border-violet-400/40 bg-violet-500/15 px-4 py-2 text-center text-sm font-medium text-violet-100 hover:bg-violet-500/25"
                >
                  Regenerate similar pack
                </Link>
              )}
            </div>

            <p className="text-xs text-white/45">
              Every handoff below quietly tags this pack as the starting point. That way your library reads like a real
              production history—not a pile of anonymous AI runs.
            </p>

            {pack && !hasLineBody ? (
              <div className="rounded-xl border border-amber-500/25 bg-amber-950/20 px-4 py-4 text-sm text-amber-50/95">
                <p className="font-medium text-white/90">No lined-up beats in this save yet</p>
                <p className="mt-2 text-xs leading-relaxed text-white/55">
                  The topic and project tags are on file, but hooks, titles, and scripts have not landed in this JSON.
                  Use the launch tools above from the brief, open{" "}
                  <Link href="/dashboard/library" className="text-amber-200 underline hover:text-white">
                    library
                  </Link>{" "}
                  to confirm status, or regenerate a similar pack when you are ready for a fresh pass.
                </p>
              </div>
            ) : null}

            {commonSource ? (
              <section className="rounded-2xl border border-violet-400/25 bg-gradient-to-br from-violet-950/45 via-[#0a0c14] to-amber-950/20 p-5 md:p-6">
                <h3 className="text-sm font-semibold text-white">Launch tools with the pack topic</h3>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/50">
                  Same project + style preset you used for the pack ride along here. When you are ready to ship a
                  specific line instead, use the per-line buttons in each section below—they keep the same paper trail.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Link
                    href={buildToolHandoffUrl("/dashboard/tools/video", {
                      topic: clampText(pack.topic, SCRIPT_TOPIC_MAX),
                      mode: "video",
                      ...commonSource,
                    })}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-medium text-white transition hover:border-violet-400/35 hover:bg-black/45"
                  >
                    <Film className="h-5 w-5 shrink-0 text-violet-300" aria-hidden />
                    <span>
                      Video Script
                      <span className="mt-0.5 block text-[11px] font-normal text-white/45">Full script flow</span>
                    </span>
                  </Link>
                  <Link
                    href={buildToolHandoffUrl("/dashboard/tools/story-maker", {
                      topic: clampText(pack.topic, STORY_TOPIC_MAX),
                      ...commonSource,
                    })}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-medium text-white transition hover:border-violet-400/35 hover:bg-black/45"
                  >
                    <ScrollText className="h-5 w-5 shrink-0 text-fuchsia-300" aria-hidden />
                    <span>
                      Story Maker
                      <span className="mt-0.5 block text-[11px] font-normal text-white/45">Structured narrative</span>
                    </span>
                  </Link>
                  <Link
                    href={buildToolHandoffUrl("/dashboard/tools/clipper", {
                      clipAngle: clampText(pack.topic, ANGLE_MAX),
                      workspaceId: pack.workspaceId || undefined,
                      sourceContentPackId: pack.id,
                      sourceType: "CONTENT_PACK",
                    })}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-medium text-white transition hover:border-violet-400/35 hover:bg-black/45"
                  >
                    <Scissors className="h-5 w-5 shrink-0 text-cyan-300" aria-hidden />
                    <span>
                      Clipper
                      <span className="mt-0.5 block text-[11px] font-normal text-white/45">Angles from topic</span>
                    </span>
                  </Link>
                  <Link
                    href={buildToolHandoffUrl("/dashboard/tools/story-video-maker", {
                      videoBrief: clampText(pack.topic, BRIEF_MAX),
                      workspaceId: pack.workspaceId || undefined,
                      sourceContentPackId: pack.id,
                      sourceType: "CONTENT_PACK",
                      platform: adsPlatformLabel(pack.platform),
                    })}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-medium text-white transition hover:border-violet-400/35 hover:bg-black/45"
                  >
                    <Clapperboard className="h-5 w-5 shrink-0 text-amber-300" aria-hidden />
                    <span>
                      Story video
                      <span className="mt-0.5 block text-[11px] font-normal text-white/45">Site → render pipeline</span>
                    </span>
                  </Link>
                </div>
              </section>
            ) : null}

            {hasLineBody ? (
            <div className="grid gap-4 md:grid-cols-2">
              <LinesSection
                title="Hooks"
                lines={payload.hooks}
                renderActions={(line) => [
                  {
                    label: "Use in video script",
                    href: buildToolHandoffUrl("/dashboard/tools/video", {
                      topic: clampText(line, SCRIPT_TOPIC_MAX),
                      mode: "video",
                      ...commonSource,
                    }),
                  },
                  {
                    label: "Use as story seed",
                    href: buildToolHandoffUrl("/dashboard/tools/story-maker", {
                      topic: clampText(line, STORY_TOPIC_MAX),
                      ...commonSource,
                    }),
                  },
                  {
                    label: "Copy",
                    onClick: () => void copyLine("Hook", line),
                  },
                ]}
              />
              <LinesSection
                title="Titles"
                lines={payload.titles}
                renderActions={(line) => [
                  {
                    label: "Use in video script",
                    href: buildToolHandoffUrl("/dashboard/tools/video", {
                      topic: clampText(line, SCRIPT_TOPIC_MAX),
                      mode: "video",
                      ...commonSource,
                    }),
                  },
                  {
                    label: "Copy title",
                    onClick: () => void copyLine("Title", line),
                  },
                ]}
              />
              <LinesSection
                title="Captions"
                lines={payload.captions}
                renderActions={(line) => [
                  {
                    label: "Copy caption",
                    onClick: () => void copyLine("Caption", line),
                  },
                ]}
              />
              <LinesSection
                title="CTAs"
                lines={payload.ctas}
                renderActions={(line) => [
                  {
                    label: "Copy CTA",
                    onClick: () => void copyLine("CTA", line),
                  },
                ]}
              />
              <LinesSection
                title="Clip angles"
                lines={payload.clipAngles}
                renderActions={(line) => [
                  {
                    label: "Use in Clipper",
                    href: buildToolHandoffUrl("/dashboard/tools/clipper", {
                      clipAngle: clampText(line, ANGLE_MAX),
                      workspaceId: pack.workspaceId || undefined,
                      sourceContentPackId: pack.id,
                      sourceType: "CONTENT_PACK",
                    }),
                  },
                  {
                    label: "Copy angle",
                    onClick: () => void copyLine("Clip angle", line),
                  },
                ]}
              />
              <div className="md:col-span-2">
                <LinesSection
                  title="Scripts"
                  lines={payload.scripts}
                  renderActions={(line) => [
                    {
                      label: "Use in video script flow",
                      href: buildToolHandoffUrl("/dashboard/tools/video", {
                        topic: clampText(line, SCRIPT_TOPIC_MAX),
                        mode: "video",
                        ...commonSource,
                      }),
                    },
                    {
                      label: "Use as story seed",
                      href: buildToolHandoffUrl("/dashboard/tools/story-maker", {
                        topic: clampText(line, STORY_TOPIC_MAX),
                        ...commonSource,
                      }),
                    },
                    {
                      label: "Story video brief",
                      href: buildToolHandoffUrl("/dashboard/tools/story-video-maker", {
                        videoBrief: clampText(line, BRIEF_MAX),
                        workspaceId: pack.workspaceId || undefined,
                        sourceContentPackId: pack.id,
                        sourceType: "CONTENT_PACK",
                        platform: adsPlatformLabel(pack.platform),
                      }),
                    },
                    {
                      label: "Copy script",
                      onClick: () => void copyLine("Script", line),
                    },
                  ]}
                />
              </div>
            </div>
            ) : null}

            <aside className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-relaxed text-white/55">
              <p className="font-medium text-white/80">What should you do next?</p>
              <p className="mt-2">
                Ship your strongest lines first, then check the{" "}
                <Link href="/dashboard/library" className="text-violet-300 underline">
                  library
                </Link>{" "}
                with this workspace filter to confirm lineage. Adjust{" "}
                <Link href="/dashboard/workspaces" className="text-violet-300 underline">
                  workspaces
                </Link>{" "}
                or{" "}
                <Link href="/dashboard/brand-voices" className="text-violet-300 underline">
                  brand voices
                </Link>{" "}
                if the next batch needs a different lane.
              </p>
            </aside>
          </>
        )}
      </div>
    </DashboardShell>
  )
}
