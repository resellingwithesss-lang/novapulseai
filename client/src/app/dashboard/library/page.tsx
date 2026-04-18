"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Archive, BookMarked, RefreshCw, Search } from "lucide-react"
import DashboardShell from "@/components/dashboard/DashboardShell"
import { useActivityRecent } from "@/hooks/useActivityRecent"
import {
  generationToolHref,
  generationTypeLabel,
  type ActivityRecentQuery,
} from "@/lib/activityApi"
import {
  getSortedOutputHistory,
  removeOutputFromHistory,
  setOutputHistoryPinned,
  type OutputHistoryItem,
} from "@/lib/growth"
import { toAbsoluteMediaUrl } from "@/lib/mediaOrigin"
import { fetchWorkspaces, type WorkspaceDto } from "@/lib/workflowApi"
import { LibraryPageSkeleton } from "@/components/workflow/WorkflowPageSkeletons"
import { formatCompactRelative } from "@/lib/compactTime"

type ActivityKind =
  | "all"
  | "gen_VIDEO"
  | "gen_STORY"
  | "gen_VIDEO_BLUEPRINT"
  | "ad_jobs"
  | "content_packs"

function activityQuery(kind: ActivityKind, workspaceId: string): ActivityRecentQuery {
  const ws = workspaceId.trim() || undefined
  switch (kind) {
    case "all":
      return { workspaceId: ws }
    case "gen_VIDEO":
      return { workspaceId: ws, sections: "generations", generationType: "VIDEO" }
    case "gen_STORY":
      return { workspaceId: ws, sections: "generations", generationType: "STORY" }
    case "gen_VIDEO_BLUEPRINT":
      return {
        workspaceId: ws,
        sections: "generations",
        generationType: "VIDEO_BLUEPRINT",
      }
    case "ad_jobs":
      return { workspaceId: ws, sections: "adJobs" }
    case "content_packs":
      return { workspaceId: ws, sections: "contentPacks" }
    default:
      return { workspaceId: ws }
  }
}

const KIND_OPTIONS: { value: ActivityKind; label: string; hint: string }[] = [
  { value: "all", label: "Everything", hint: "Scripts, packs, renders" },
  { value: "gen_VIDEO", label: "Video scripts", hint: "Hook → full script outputs" },
  { value: "gen_STORY", label: "Stories", hint: "Story Maker runs" },
  { value: "gen_VIDEO_BLUEPRINT", label: "Blueprints", hint: "Structured video plans" },
  { value: "ad_jobs", label: "Story video jobs", hint: "Site → video pipeline" },
  { value: "content_packs", label: "Content packs", hint: "Batch hook & angle sets" },
]

function WorkflowMeta({
  workspaceName,
  brandVoiceName,
  packId,
  packTitle,
}: {
  workspaceName: string | null
  brandVoiceName: string | null
  packId: string | null
  packTitle: string | null
}) {
  if (!workspaceName && !brandVoiceName && !packTitle) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {workspaceName ? (
        <span className="rounded-md border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-100/90">
          Project · {workspaceName}
        </span>
      ) : null}
      {brandVoiceName ? (
        <span className="rounded-md border border-fuchsia-500/20 bg-fuchsia-500/10 px-2 py-0.5 text-[11px] text-fuchsia-100/90">
          Style preset · {brandVoiceName}
        </span>
      ) : null}
      {packId && packTitle ? (
        <Link
          href={`/dashboard/content-packs/${packId}`}
          className="rounded-md border border-violet-400/25 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-100/95 hover:border-violet-400/40"
        >
          From pack · {packTitle}
        </Link>
      ) : null}
    </div>
  )
}

/** Creator-readable sentence for provenance (not raw enum strings). */
function lineageCaption(sourceType: string | null, continued: boolean): string | null {
  const raw = (sourceType || "").toUpperCase().replace(/\s+/g, "_")
  if (continued) {
    if (raw.includes("CONTENT_PACK"))
      return "This item continues work that started inside one of your content packs."
    if (raw.includes("GENERATION"))
      return "This item picks up context from an earlier AI output in your account."
    return "This item is intentionally linked to something you already created, so context stays intact."
  }
  if (raw.includes("CONTENT_PACK")) return "Sparked from a saved content pack batch."
  if (raw.includes("GENERATION")) return "Tied back to a previous generation run."
  return null
}

function LineageStrip({
  sourceType,
  sourceGenerationId,
}: {
  sourceType: string | null
  sourceGenerationId: string | null
}) {
  const continued = Boolean(sourceGenerationId)
  const caption = lineageCaption(sourceType, continued)
  if (!caption && !continued && !sourceType?.trim()) return null
  return (
    <div className="mt-2 space-y-1 border-l-2 border-emerald-500/30 pl-2.5">
      {continued ? (
        <span className="inline-flex rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100/95">
          Continued workflow
        </span>
      ) : null}
      {caption ? <p className="text-[11px] leading-relaxed text-white/55">{caption}</p> : null}
    </div>
  )
}

export default function ContentLibraryPage() {
  const searchParams = useSearchParams()
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([])
  const [workspaceFilter, setWorkspaceFilter] = useState("")
  const [activityKind, setActivityKind] = useState<ActivityKind>("all")

  const activityQueryMemo = useMemo(
    () => activityQuery(activityKind, workspaceFilter),
    [activityKind, workspaceFilter]
  )

  const { generations, adJobs, contentPacks, loading, error, refresh } = useActivityRecent(
    true,
    activityQueryMemo
  )

  const [query, setQuery] = useState("")
  const [localItems, setLocalItems] = useState<OutputHistoryItem[]>(() =>
    getSortedOutputHistory()
  )

  useEffect(() => {
    const w = searchParams.get("workspace")
    if (w) setWorkspaceFilter(w)
  }, [searchParams])

  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchWorkspaces()
        setWorkspaces(data.workspaces ?? [])
      } catch {
        setWorkspaces([])
      }
    })()
  }, [])

  const refreshLocal = () => setLocalItems(getSortedOutputHistory())

  const filteredGens = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return generations
    return generations.filter((g) => g.inputPreview.toLowerCase().includes(q))
  }, [generations, query])

  const filteredJobs = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return adJobs
    return adJobs.filter(
      (j) =>
        j.jobId.toLowerCase().includes(q) ||
        j.platform.toLowerCase().includes(q) ||
        (j.failedReason && j.failedReason.toLowerCase().includes(q)) ||
        (j.contentPackTitle && j.contentPackTitle.toLowerCase().includes(q))
    )
  }, [adJobs, query])

  const filteredPacks = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return contentPacks
    return contentPacks.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.topicPreview.toLowerCase().includes(q) ||
        p.platform.toLowerCase().includes(q)
    )
  }, [contentPacks, query])

  const filteredLocal = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return localItems
    return localItems.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.summary && i.summary.toLowerCase().includes(q))
    )
  }, [localItems, query])

  const filtersActive =
    Boolean(workspaceFilter.trim()) || activityKind !== "all" || Boolean(query.trim())

  const visibleRows =
    (activityKind === "all" || activityKind.startsWith("gen_") ? filteredGens.length : 0) +
    (activityKind === "all" || activityKind === "ad_jobs" ? filteredJobs.length : 0) +
    (activityKind === "all" || activityKind === "content_packs" ? filteredPacks.length : 0)

  const hasLocalOnly =
    !loading && visibleRows === 0 && filteredLocal.length > 0 && activityKind === "all" && !filtersActive

  const clearFilters = () => {
    setWorkspaceFilter("")
    setActivityKind("all")
    setQuery("")
  }

  const pinnedLocal = filteredLocal.filter((i) => i.pinned)
  const restLocal = filteredLocal.filter((i) => !i.pinned)

  return (
    <DashboardShell showCommandHero={false} contentWidth="readable">
      <div className="space-y-10 pb-8">
        <header className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/35 via-[#0c1020] to-slate-900/40 p-6 md:p-8">
          <div
            className="pointer-events-none absolute bottom-0 right-0 h-48 w-48 translate-x-1/3 rounded-full bg-emerald-500/10 blur-3xl"
            aria-hidden
          />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/90">
                Reuse &amp; lineage
              </p>
              <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">Content library</h1>
              <p className="max-w-xl text-sm leading-relaxed text-white/60 md:text-base">
                Everything you have shipped from NovaPulseAI on this account—scripts, packs, renders—plus quick
                “continue” shortcuts stored on this device. Filter by workspace to audit one brand lane at a time.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void refresh()
                refreshLocal()
              }}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-white/85 transition hover:bg-white/10"
            >
              <RefreshCw className="h-4 w-4 opacity-80" aria-hidden />
              Sync
            </button>
          </div>
        </header>

        <section
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] md:p-6"
          aria-label="Library filters"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Search className="h-4 w-4 text-emerald-300/90" aria-hidden />
              Find in your archive
            </h2>
            {filtersActive ? (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-medium text-emerald-300/90 hover:text-emerald-200"
              >
                Clear all filters
              </button>
            ) : null}
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
            <div>
              <label className="text-xs font-medium text-white/50">Workspace</label>
              <select
                value={workspaceFilter}
                onChange={(e) => setWorkspaceFilter(e.target.value)}
                className="np-select mt-1.5 w-full"
              >
                <option value="">All workspaces</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-white/50">Show</label>
              <select
                value={activityKind}
                onChange={(e) => setActivityKind(e.target.value as ActivityKind)}
                className="np-select mt-1.5 w-full"
              >
                {KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-white/35">
                {KIND_OPTIONS.find((o) => o.value === activityKind)?.hint}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-white/50">Search loaded rows</label>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Topic, title, job id, platform…"
                className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/35 px-3 py-2.5 text-sm text-white placeholder:text-white/30"
              />
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {error} — tools still work; try sync again.
          </div>
        )}

        {loading ? <LibraryPageSkeleton /> : null}

        {!loading && visibleRows === 0 && hasLocalOnly && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/15 px-4 py-4 text-sm text-white/70">
            <p className="font-medium text-emerald-100/90">No synced runs yet</p>
            <p className="mt-1 text-white/55">
              You have local continue shortcuts below. Generate from tools or packs to populate your cloud archive
              here.
            </p>
          </div>
        )}

        {!loading && visibleRows === 0 && !hasLocalOnly && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-8 text-sm text-white/55">
            {filtersActive ? (
              <>
                <p className="font-medium text-white/85">Nothing matches these filters</p>
                <p className="mt-2 text-white/50">
                  The archive may still have items—this view is just narrowed by workspace, type, or search.
                </p>
                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="inline-flex flex-1 items-center justify-center rounded-full bg-gradient-to-r from-emerald-600 to-cyan-600 px-5 py-2.5 text-center text-xs font-semibold text-white shadow-md shadow-emerald-900/25 sm:flex-none"
                  >
                    Clear filters — show full archive
                  </button>
                  <p className="text-xs text-white/45">
                    <span className="font-medium text-white/60">Secondary:</span> add something new from{" "}
                    <Link href="/dashboard/content-packs" className="text-emerald-300 underline hover:text-white">
                      content packs
                    </Link>{" "}
                    or{" "}
                    <Link href="/dashboard/tools/video" className="text-emerald-300 underline hover:text-white">
                      Video Script
                    </Link>
                    .
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <Archive className="mt-0.5 h-8 w-8 shrink-0 text-emerald-400/50" aria-hidden />
                  <div>
                    <p className="font-medium text-white/85">Your archive is empty</p>
                    <p className="mt-2 text-white/50">
                      <span className="font-medium text-white/70">Recommended next:</span> save one{" "}
                      <Link href="/dashboard/content-packs" className="font-medium text-emerald-300 underline">
                        content pack
                      </Link>{" "}
                      so this archive can show where each line came from. After that, scripts and story videos land
                      here with the same trail.
                    </p>
                    <p className="mt-2 text-xs text-white/40">
                      Prefer going direct? Try a{" "}
                      <Link href="/dashboard/tools/video" className="text-emerald-300/90 underline">
                        video script
                      </Link>{" "}
                      or{" "}
                      <Link href="/dashboard/tools/story-video-maker" className="text-emerald-300/90 underline">
                        story video
                      </Link>
                      .
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {!loading && visibleRows > 0 && (
          <div className="space-y-10">
            {(activityKind === "all" || activityKind.startsWith("gen_")) && (
              <section className="space-y-4" aria-labelledby="lib-gens">
                <h2 id="lib-gens" className="text-sm font-semibold uppercase tracking-wide text-white/45">
                  Generated outputs
                </h2>
                {filteredGens.length === 0 ? (
                  <p className="text-sm text-white/45">
                    {activityKind === "all"
                      ? "No script or story generations in this view yet."
                      : "No items of this type in the current filter."}
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {filteredGens.map((g) => (
                      <li
                        key={g.id}
                        className="rounded-2xl border border-white/10 bg-black/25 p-4 transition hover:border-emerald-500/20 hover:bg-black/35"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <span className="inline-block rounded-md border border-violet-400/25 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200/90">
                              {generationTypeLabel(g.type)}
                            </span>
                            <p className="mt-2 text-sm text-white/88">{g.inputPreview}</p>
                            <WorkflowMeta
                              workspaceName={g.workspaceName}
                              brandVoiceName={g.brandVoiceName}
                              packId={g.contentPackId}
                              packTitle={g.contentPackTitle}
                            />
                            <LineageStrip
                              sourceType={g.sourceType}
                              sourceGenerationId={g.sourceGenerationId}
                            />
                            <p className="mt-2 text-[11px] text-white/35">
                              {new Date(g.createdAt).toLocaleString()} ·{" "}
                              <span className="text-white/45">{formatCompactRelative(g.createdAt)}</span> ·{" "}
                              {g.creditsUsed} credits
                              {g.requestId ? ` · ${g.requestId.slice(0, 8)}…` : ""}
                            </p>
                          </div>
                          <Link
                            href={generationToolHref(g.type)}
                            className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-100/95 hover:bg-emerald-500/20"
                          >
                            Open tool
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {(activityKind === "all" || activityKind === "ad_jobs") && (
              <section className="space-y-4" aria-labelledby="lib-jobs">
                <h2 id="lib-jobs" className="text-sm font-semibold uppercase tracking-wide text-white/45">
                  Story video renders
                </h2>
                {filteredJobs.length === 0 ? (
                  <p className="text-sm text-white/45">No story-video jobs in this view.</p>
                ) : (
                  <ul className="space-y-3">
                    {filteredJobs.map((j) => (
                      <li
                        key={j.id}
                        className="rounded-2xl border border-white/10 bg-black/25 p-4 transition hover:border-cyan-500/20 hover:bg-black/35"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300/90">
                              {j.platform} · {j.status}
                              {j.progress < 100 && j.status.toLowerCase() !== "failed"
                                ? ` · ${j.progress}%`
                                : ""}
                            </span>
                            <p className="mt-2 font-mono text-sm text-white/85">Job {j.jobId}</p>
                            <WorkflowMeta
                              workspaceName={j.workspaceName}
                              brandVoiceName={null}
                              packId={j.contentPackId}
                              packTitle={j.contentPackTitle}
                            />
                            <LineageStrip
                              sourceType={j.sourceType}
                              sourceGenerationId={j.sourceGenerationId}
                            />
                            {j.failedReason ? (
                              <p className="mt-2 text-xs text-red-300/90">{j.failedReason}</p>
                            ) : null}
                            <p className="mt-2 text-[11px] text-white/35">
                              {new Date(j.createdAt).toLocaleString()} ·{" "}
                              <span className="text-white/45">{formatCompactRelative(j.createdAt)}</span>
                            </p>
                          </div>
                          <div className="flex flex-col gap-2">
                            {j.outputUrl ? (
                              <a
                                href={toAbsoluteMediaUrl(j.outputUrl)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-semibold text-emerald-300 underline"
                              >
                                Open video
                              </a>
                            ) : null}
                            <Link
                              href="/dashboard/tools/story-video-maker"
                              className="text-xs text-white/50 underline hover:text-white/75"
                            >
                              New render
                            </Link>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {(activityKind === "all" || activityKind === "content_packs") && (
              <section className="space-y-4" aria-labelledby="lib-packs">
                <h2 id="lib-packs" className="text-sm font-semibold uppercase tracking-wide text-white/45">
                  Content packs
                </h2>
                {filteredPacks.length === 0 ? (
                  <p className="text-sm text-white/45">
                    No packs here.{" "}
                    <Link href="/dashboard/content-packs" className="text-emerald-300 underline">
                      Generate a pack
                    </Link>
                    .
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {filteredPacks.map((p) => (
                      <li
                        key={p.id}
                        className="rounded-2xl border border-white/10 bg-black/25 p-4 transition hover:border-violet-400/25 hover:bg-black/35"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-300/90">
                              Content pack
                            </span>
                            <p className="mt-2 text-sm font-semibold text-white/90">{p.title}</p>
                            <p className="mt-1 text-sm text-white/55">{p.topicPreview}</p>
                            <WorkflowMeta
                              workspaceName={p.workspaceName}
                              brandVoiceName={p.brandVoiceName}
                              packId={p.contentPackId}
                              packTitle={p.contentPackTitle}
                            />
                            <LineageStrip
                              sourceType={p.sourceType ?? null}
                              sourceGenerationId={p.sourceGenerationId ?? null}
                            />
                            <p className="mt-2 text-[11px] text-white/35">
                              {p.platform}
                              {p.audience ? ` · ${p.audience}` : ""} · {p.status} ·{" "}
                              {new Date(p.createdAt).toLocaleString()} ·{" "}
                              <span className="text-white/45">{formatCompactRelative(p.createdAt)}</span>
                            </p>
                          </div>
                          <Link
                            href={`/dashboard/content-packs/${p.id}`}
                            className="shrink-0 rounded-full border border-violet-400/35 bg-violet-500/15 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-500/25"
                          >
                            Open pack
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}

        <section className="space-y-4 rounded-2xl border border-amber-500/15 bg-amber-950/10 p-5 md:p-6" aria-labelledby="lib-local">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 id="lib-local" className="flex items-center gap-2 text-sm font-semibold text-white">
                <BookMarked className="h-4 w-4 text-amber-300/90" aria-hidden />
                This device — continue shortcuts
              </h2>
              <p className="mt-1 text-xs text-white/45">
                Stored locally for fast “pick up where you left off.” Clearing browser data removes this list. Pin
                items you are actively shipping this week.
              </p>
            </div>
          </div>
          {filteredLocal.length === 0 ? (
            <p className="text-sm text-white/45">Nothing here yet — run any tool to create a shortcut.</p>
          ) : (
            <ul className="space-y-3">
              {[...pinnedLocal, ...restLocal].map((item) => (
                <li
                  key={item.id}
                  className={`rounded-2xl border bg-black/25 p-4 transition hover:bg-black/35 ${
                    item.pinned
                      ? "border-amber-400/35 shadow-[inset_3px_0_0_rgba(251,191,36,0.5)]"
                      : "border-white/10"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-white">{item.title}</p>
                        {item.pinned ? (
                          <span className="rounded-full border border-amber-400/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100/90">
                            Pinned
                          </span>
                        ) : null}
                      </div>
                    <p className="mt-1 text-xs text-white/50">{item.summary}</p>
                    <p className="mt-2 text-[11px] text-white/35">
                      {item.tool}
                      <span className="text-white/25"> · </span>
                      <span className="text-amber-200/50">This device only</span>
                    </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.continuePath ? (
                        <Link
                          href={item.continuePath}
                          className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100/95 hover:bg-amber-500/20"
                        >
                          {item.nextAction || "Continue"}
                        </Link>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          setOutputHistoryPinned(item.id, !item.pinned)
                          refreshLocal()
                        }}
                        className="text-xs text-white/50 underline hover:text-white/75"
                      >
                        {item.pinned ? "Unpin" : "Pin for later"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          removeOutputFromHistory(item.id)
                          refreshLocal()
                        }}
                        className="text-xs text-red-300/80 underline hover:text-red-200"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="rounded-xl border border-white/8 bg-emerald-950/15 px-4 py-3 text-xs leading-relaxed text-white/50">
          Organizing by project? Set up{" "}
          <Link href="/dashboard/workspaces" className="text-emerald-300 underline">
            workspaces
          </Link>{" "}
          and{" "}
          <Link href="/dashboard/brand-voices" className="text-emerald-300 underline">
            brand voices
          </Link>{" "}
          so new runs show up here with cleaner tags automatically.
        </aside>
      </div>
    </DashboardShell>
  )
}
