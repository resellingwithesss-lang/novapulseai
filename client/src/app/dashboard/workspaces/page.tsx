"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowRight,
  FolderKanban,
  Layers,
  Library,
  Sparkles,
  Target,
} from "lucide-react"
import DashboardShell from "@/components/dashboard/DashboardShell"
import { useAuth } from "@/context/AuthContext"
import { displayPlanForUser, getWorkflowLimitsForPlan } from "@/lib/plans"
import {
  createWorkspace,
  deleteWorkspace,
  emptyWorkspaceUsage,
  fetchWorkspaces,
  updateWorkspace,
  type WorkspaceDto,
} from "@/lib/workflowApi"
import { ApiError } from "@/lib/api"
import { buildToolHandoffUrl } from "@/lib/tool-handoff"
import { WorkspacesListSkeleton } from "@/components/workflow/WorkflowPageSkeletons"

const WHY_CARDS = [
  {
    icon: Layers,
    title: "Separate niches or clients",
    body: "Keep skincare UGC, coaching offers, and faceless channels from bleeding into each other’s context.",
  },
  {
    icon: Target,
    title: "Consistent brand context",
    body: "When you pick a workspace in tools and packs, NovaPulseAI carries audience, platforms, and goals forward.",
  },
  {
    icon: Sparkles,
    title: "Organized outputs & history",
    body: "Tie generations, packs, and jobs to a project so your library stays scannable when volume grows.",
  },
] as const

const EXAMPLE_WORKSPACES = [
  {
    name: "Skincare UGC",
    niche: "Beauty · skincare routines",
    targetAudience: "Women 22–40 researching ingredients before buying",
    platformsStr: "TikTok, Instagram Reels",
    goalsStr: "Trust, saves, link-in-bio clicks",
    ctaStyle: "Soft testimonial + “shop my routine”",
  },
  {
    name: "Faceless History Shorts",
    niche: "History storytelling · faceless",
    targetAudience: "Casual scrollers who binge 45s explainers",
    platformsStr: "YouTube Shorts, TikTok",
    goalsStr: "Watch time, subs, comment debates",
    ctaStyle: "Cliffhanger + part 2 tease",
  },
  {
    name: "Fitness Coaching Brand",
    niche: "Online coaching · transformation content",
    targetAudience: "Busy professionals wanting sustainable fat loss",
    platformsStr: "Instagram Reels, YouTube Shorts",
    goalsStr: "DMs, consult calls, app waitlist",
    ctaStyle: "Direct CTA to free audit / calendar",
  },
] as const

export default function WorkspacesPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<WorkspaceDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [niche, setNiche] = useState("")
  const [targetAudience, setTargetAudience] = useState("")
  const [platformsStr, setPlatformsStr] = useState("")
  const [goalsStr, setGoalsStr] = useState("")
  const [ctaStyle, setCtaStyle] = useState("")
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [nextStepBanner, setNextStepBanner] = useState<"created" | "updated" | null>(null)
  const [lastCreatedWorkspaceId, setLastCreatedWorkspaceId] = useState<string | null>(null)

  const limits = getWorkflowLimitsForPlan(
    displayPlanForUser(user?.plan, user?.role)
  )
  const atCap = items.length >= limits.workspaces

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchWorkspaces()
      setItems(data.workspaces ?? [])
    } catch (e) {
      setError((e as ApiError)?.message ?? "Failed to load workspaces.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** First row after server sort — subtle hint only when another lane exists. */
  const suggestedPrimaryId = useMemo(() => {
    if (items.length < 2) return null
    const u = items[0].usage ?? emptyWorkspaceUsage()
    return u.linkedTotal > 0 ? items[0].id : null
  }, [items])

  const parseList = (raw: string) =>
    raw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || atCap || saving) return
    setSaving(true)
    setError(null)
    try {
      const created = await createWorkspace({
        name: name.trim(),
        niche,
        targetAudience,
        primaryPlatforms: parseList(platformsStr),
        contentGoals: parseList(goalsStr),
        defaultCtaStyle: ctaStyle,
      })
      setLastCreatedWorkspaceId(created.id)
      setName("")
      setNiche("")
      setTargetAudience("")
      setPlatformsStr("")
      setGoalsStr("")
      setCtaStyle("")
      setNextStepBanner("created")
      await load()
    } catch (err) {
      const ae = err as ApiError
      setError(ae?.message ?? "Could not create workspace.")
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (id: string) => {
    if (!confirm("Delete this workspace? Linked items keep outputs; workspace tag is removed.")) return
    try {
      await deleteWorkspace(id)
      await load()
    } catch (err) {
      setError((err as ApiError)?.message ?? "Delete failed.")
    }
  }

  const startEdit = (w: WorkspaceDto) => {
    setEditingId(w.id)
    setName(w.name)
    setNiche(w.niche)
    setTargetAudience(w.targetAudience)
    setPlatformsStr(w.primaryPlatforms.join(", "))
    setGoalsStr(w.contentGoals.join(", "))
    setCtaStyle(w.defaultCtaStyle)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setName("")
    setNiche("")
    setTargetAudience("")
    setPlatformsStr("")
    setGoalsStr("")
    setCtaStyle("")
  }

  const onUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId || !name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await updateWorkspace(editingId, {
        name: name.trim(),
        niche,
        targetAudience,
        primaryPlatforms: parseList(platformsStr),
        contentGoals: parseList(goalsStr),
        defaultCtaStyle: ctaStyle,
      })
      cancelEdit()
      setNextStepBanner("updated")
      await load()
    } catch (err) {
      setError((err as ApiError)?.message ?? "Update failed.")
    } finally {
      setSaving(false)
    }
  }

  const applyExample = (ex: (typeof EXAMPLE_WORKSPACES)[number]) => {
    setName(ex.name)
    setNiche(ex.niche)
    setTargetAudience(ex.targetAudience)
    setPlatformsStr(ex.platformsStr)
    setGoalsStr(ex.goalsStr)
    setCtaStyle(ex.ctaStyle)
    setEditingId(null)
    document.getElementById("workspace-form")?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <DashboardShell showCommandHero={false} contentWidth="readable">
      <div className="space-y-12 pb-8">
        <header className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-950/40 via-[#0c1020] to-violet-950/30 p-6 md:p-8">
          <div
            className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cyan-500/15 blur-3xl"
            aria-hidden
          />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/90">
                Creator projects
              </p>
              <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">Workspaces</h1>
              <p className="max-w-xl text-sm leading-relaxed text-white/60 md:text-base">
                Organize everything by brand, niche, client, or channel. Each workspace keeps scripts, content
                packs, clips, and jobs in one coherent context—so you spend less time re-explaining who you are
                posting for.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/55">
                  {items.length} / {limits.workspaces} on your plan
                </span>
              </div>
            </div>
            <Link
              href="/dashboard"
              className="shrink-0 text-sm font-medium text-cyan-200/90 underline-offset-4 hover:text-white hover:underline"
            >
              ← Studio home
            </Link>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {error}
          </div>
        )}

        {nextStepBanner && (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/25 px-4 py-4 text-sm text-emerald-50/95">
            <p className="font-medium text-white/90">
              {nextStepBanner === "created" ? "Project saved" : "Project updated"}
            </p>
            <p className="mt-2 text-white/65">
              {nextStepBanner === "created"
                ? "Give this lane a voice next so scripts and packs stop sounding generic."
                : "Run a fresh content pack or review what this project already shipped in the library."}
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link
                href={
                  lastCreatedWorkspaceId
                    ? `/dashboard/brand-voices?workspace=${encodeURIComponent(lastCreatedWorkspaceId)}`
                    : "/dashboard/brand-voices"
                }
                className="inline-flex flex-1 items-center justify-center rounded-full bg-gradient-to-r from-emerald-600 to-cyan-600 px-5 py-2.5 text-center text-xs font-semibold text-white shadow-md shadow-emerald-900/20 sm:flex-none"
              >
                Next: add a style preset for this project →
              </Link>
              <p className="text-xs text-white/45">
                After that,{" "}
                <Link
                  href={
                    lastCreatedWorkspaceId
                      ? `/dashboard/content-packs?workspaceId=${encodeURIComponent(lastCreatedWorkspaceId)}`
                      : "/dashboard/content-packs"
                  }
                  className="text-emerald-200 underline hover:text-white"
                >
                  generate a content pack
                </Link>{" "}
                with the same project selected so everything stays linked.
              </p>
              <button
                type="button"
                onClick={() => {
                  setNextStepBanner(null)
                  setLastCreatedWorkspaceId(null)
                }}
                className="text-xs text-white/45 underline hover:text-white/70 sm:ml-auto"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <section aria-labelledby="why-workspaces">
          <h2 id="why-workspaces" className="text-sm font-semibold uppercase tracking-wide text-white/45">
            Why use workspaces?
          </h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-3">
            {WHY_CARDS.map(({ icon: Icon, title, body }) => (
              <li
                key={title}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/25 bg-cyan-500/10">
                  <Icon className="h-5 w-5 text-cyan-200/90" aria-hidden />
                </div>
                <h3 className="mt-3 text-sm font-semibold text-white">{title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-white/50">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        {loading ? (
          <WorkspacesListSkeleton />
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-gradient-to-b from-white/[0.04] to-transparent p-8 text-center md:p-10">
            <FolderKanban className="mx-auto h-10 w-10 text-cyan-300/70" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold text-white">Create your first workspace</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-white/55">
              One workspace = one lane of content. Add a name and a few defaults below, then use it when you generate
              packs or scripts so outputs stay on-brand.
            </p>
            <p className="mt-4 text-xs text-white/40">
              Tip: try an example chip below to pre-fill the form, then tweak for your channel.
            </p>
            <p className="mx-auto mt-5 max-w-md text-xs font-medium text-cyan-200/90">
              Next: create the workspace, then add a matching style preset so packs and scripts inherit the same
              context.
            </p>
          </div>
        ) : (
          <section aria-labelledby="your-workspaces">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <h2 id="your-workspaces" className="text-lg font-semibold text-white">
                Your workspaces
              </h2>
              <button
                type="button"
                onClick={() => document.getElementById("workspace-form")?.scrollIntoView({ behavior: "smooth" })}
                className="text-sm font-medium text-cyan-300 hover:text-cyan-200"
              >
                + Create workspace
              </button>
            </div>
            <ul className="mt-4 grid gap-4">
              {items.map((w) => (
                <li
                  key={w.id}
                  className="group rounded-2xl border border-white/10 bg-black/25 p-5 transition hover:border-cyan-500/25 hover:bg-black/35"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-white">{w.name}</h3>
                        {w.id === suggestedPrimaryId ? (
                          <span
                            className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-100/90"
                            title="Most artifacts and recent touches in your account"
                          >
                            Active lane
                          </span>
                        ) : null}
                        <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/45">
                          Meta updated {new Date(w.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-sm text-white/65">{w.niche || "Add a niche so tools stay focused"}</p>
                      {w.targetAudience ? (
                        <p className="text-xs text-white/45">
                          <span className="font-medium text-white/55">Audience:</span> {w.targetAudience}
                        </p>
                      ) : null}
                      <p className="text-xs text-white/40">
                        {w.primaryPlatforms.length > 0 ? (
                          <>
                            <span className="font-medium text-white/50">Platforms:</span>{" "}
                            {w.primaryPlatforms.join(" · ")}
                          </>
                        ) : (
                          "No platforms listed — add them when you edit."
                        )}
                      </p>
                      {w.contentGoals.length > 0 ? (
                        <p className="text-xs text-white/40">
                          <span className="font-medium text-white/50">Goals:</span> {w.contentGoals.join(" · ")}
                        </p>
                      ) : null}
                      {w.defaultCtaStyle ? (
                        <p className="text-xs text-white/40">
                          <span className="font-medium text-white/50">CTA style:</span> {w.defaultCtaStyle}
                        </p>
                      ) : null}
                      {(() => {
                        const u = w.usage ?? emptyWorkspaceUsage()
                        if (u.linkedTotal === 0) {
                          return (
                            <p className="text-[11px] text-white/40">
                              <span className="font-medium text-white/55">Signals · </span>
                              No voices, packs, scripts, or renders are tagged to this project yet. Pick it in the pack
                              generator or a tool so the library can roll up work here.
                            </p>
                          )
                        }
                        const parts = [
                          u.voiceCount
                            ? `${u.voiceCount} style preset${u.voiceCount === 1 ? "" : "s"}`
                            : null,
                          u.contentPackCount
                            ? `${u.contentPackCount} content pack${u.contentPackCount === 1 ? "" : "s"}`
                            : null,
                          u.generationCount
                            ? `${u.generationCount} script / story save${u.generationCount === 1 ? "" : "s"}`
                            : null,
                          u.adJobCount
                            ? `${u.adJobCount} story-video job${u.adJobCount === 1 ? "" : "s"}`
                            : null,
                        ].filter(Boolean)
                        return (
                          <p className="text-[11px] text-cyan-200/80">
                            <span className="font-medium text-cyan-100/95">Signals · </span>
                            {parts.join(" · ")} · Last artifact{" "}
                            {u.lastArtifactAt
                              ? new Date(u.lastArtifactAt).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                })
                              : "—"}
                          </p>
                        )
                      })()}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:flex-col lg:items-stretch">
                      <Link
                        href={buildToolHandoffUrl("/dashboard/content-packs", { workspaceId: w.id })}
                        className="inline-flex items-center justify-center gap-1.5 rounded-full border border-violet-400/35 bg-violet-500/15 px-4 py-2 text-center text-xs font-semibold text-violet-100 transition hover:bg-violet-500/25"
                      >
                        Use in content pack
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                      <Link
                        href={`/dashboard/library?workspace=${encodeURIComponent(w.id)}`}
                        className="inline-flex items-center justify-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-center text-xs font-medium text-white/80 transition hover:bg-white/[0.08]"
                      >
                        <Library className="h-3.5 w-3.5 opacity-80" aria-hidden />
                        Open library
                      </Link>
                      <Link
                        href={`/dashboard/brand-voices?workspace=${encodeURIComponent(w.id)}`}
                        className="inline-flex items-center justify-center rounded-full border border-fuchsia-500/25 bg-fuchsia-500/10 px-4 py-2 text-center text-xs font-medium text-fuchsia-100/95 transition hover:bg-fuchsia-500/20"
                      >
                        Add brand voice
                      </Link>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(w)}
                          className="flex-1 rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-white/85 hover:bg-white/5"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDelete(w.id)}
                          className="rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section
          id="workspace-form"
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset] md:p-8"
        >
          <div className="flex flex-col gap-2 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">
                {editingId ? "Edit workspace" : "Create workspace"}
              </h2>
              <p className="mt-1 text-xs text-white/45">
                Primary action — name is required; everything else powers smarter defaults in packs and tools.
              </p>
            </div>
            {!editingId && !atCap ? (
              <span className="text-xs font-medium uppercase tracking-wide text-cyan-300/80">Recommended</span>
            ) : null}
          </div>

          <p className="mt-5 text-xs font-medium uppercase tracking-wide text-white/40">Start from an example</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {EXAMPLE_WORKSPACES.map((ex) => (
              <button
                key={ex.name}
                type="button"
                onClick={() => applyExample(ex)}
                className="rounded-full border border-white/12 bg-black/30 px-3 py-1.5 text-left text-xs text-white/75 transition hover:border-cyan-500/30 hover:text-white"
              >
                {ex.name}
              </button>
            ))}
          </div>

          <form className="mt-6 grid gap-5 md:grid-cols-2" onSubmit={editingId ? onUpdate : onCreate}>
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-white/55">Workspace name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/35 px-3 py-2.5 text-sm text-white placeholder:text-white/30"
                placeholder="e.g. Skincare UGC"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/55">Niche / lane</label>
              <input
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/35 px-3 py-2.5 text-sm text-white placeholder:text-white/30"
                placeholder="What is this project about?"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/55">Target audience</label>
              <input
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/35 px-3 py-2.5 text-sm text-white placeholder:text-white/30"
                placeholder="Who should the writing sound like it is for?"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/55">Platforms</label>
              <input
                value={platformsStr}
                onChange={(e) => setPlatformsStr(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/35 px-3 py-2.5 text-sm text-white placeholder:text-white/30"
                placeholder="TikTok, Instagram Reels, YouTube Shorts"
              />
              <p className="mt-1 text-[11px] text-white/35">Comma-separated is fine.</p>
            </div>
            <div>
              <label className="text-xs font-medium text-white/55">Content goals</label>
              <input
                value={goalsStr}
                onChange={(e) => setGoalsStr(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/35 px-3 py-2.5 text-sm text-white placeholder:text-white/30"
                placeholder="Leads, subscribers, sales, brand awareness…"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-white/55">Default CTA style</label>
              <input
                value={ctaStyle}
                onChange={(e) => setCtaStyle(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/12 bg-black/35 px-3 py-2.5 text-sm text-white placeholder:text-white/30"
                placeholder="e.g. soft save + link in bio, or punchy ‘comment 1 for the guide’"
              />
            </div>
            <div className="flex flex-wrap gap-3 md:col-span-2">
              <button
                type="submit"
                disabled={saving || (!editingId && atCap)}
                className="rounded-full bg-gradient-to-r from-cyan-600 to-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-900/20 disabled:opacity-40"
              >
                {saving ? "Saving…" : editingId ? "Save changes" : "Create workspace"}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded-full border border-white/15 px-6 py-2.5 text-sm text-white/75 hover:bg-white/5"
                >
                  Cancel edit
                </button>
              )}
            </div>
          </form>
          {atCap && !editingId && (
            <p className="mt-4 text-xs text-amber-200/90">
              Workspace limit reached — upgrade on{" "}
              <Link href="/pricing" className="font-medium underline">
                Pricing
              </Link>{" "}
              for more slots.
            </p>
          )}
        </section>

        <aside className="rounded-xl border border-white/8 bg-violet-950/20 px-4 py-3 text-xs leading-relaxed text-white/50">
          <span className="font-medium text-violet-200/90">Next in your workflow:</span> add a{" "}
          <Link href="/dashboard/brand-voices" className="text-violet-300 underline">
            brand voice
          </Link>{" "}
          for this lane, then batch ideas in{" "}
          <Link href="/dashboard/content-packs" className="text-violet-300 underline">
            content packs
          </Link>
          .
        </aside>
      </div>
    </DashboardShell>
  )
}
