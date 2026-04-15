"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Boxes, Coins, Sparkles, Wand2 } from "lucide-react"
import DashboardShell from "@/components/dashboard/DashboardShell"
import { useAuth } from "@/context/AuthContext"
import { displayPlanForUser, getWorkflowLimitsForPlan } from "@/lib/plans"
import { ApiError } from "@/lib/api"
import CreatorWorkflowSelectors from "@/components/workflow/CreatorWorkflowSelectors"
import {
  fetchBrandVoices,
  fetchContentPacks,
  fetchWorkspaces,
  generateContentPack,
  type BrandVoiceDto,
  type ContentPackDto,
  type WorkspaceDto,
} from "@/lib/workflowApi"
import { buildToolHandoffUrl } from "@/lib/tool-handoff"
import {
  countPackPayloadLines,
  formatPackCountsChips,
  isPackPayloadLinesEmpty,
  packCardPreviewLabel,
  packCardPreviewLine,
  packSparseCardHint,
} from "@/lib/contentPackPayload"
import { bestPackCandidateId, sortPacksForDisplay } from "@/lib/workflowSignals"
import { ContentPacksSavedGridSkeleton } from "@/components/workflow/WorkflowPageSkeletons"

const CREDITS_PER_PACK = 2

const EXAMPLE_TOPICS = [
  "Promote a hydration serum for TikTok — before/after texture, ingredient callouts, soft CTA to shop",
  "Faceless history shorts about Roman emperors — dramatic hooks, comment-bait cliffhangers",
  "Motivational fitness content for beginner men — gym anxiety, simple habits, 30-day arc",
] as const

function statusBadgeClass(status: string) {
  const s = status.toLowerCase()
  if (s.includes("fail") || s.includes("error")) return "border-red-400/30 bg-red-500/10 text-red-200/90"
  if (s.includes("complete") || s.includes("ready")) return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200/90"
  return "border-amber-400/25 bg-amber-500/10 text-amber-100/90"
}

export default function ContentPacksPage() {
  const searchParams = useSearchParams()
  const { user, refreshUser } = useAuth()
  const [items, setItems] = useState<ContentPackDto[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([])
  const [voices, setVoices] = useState<BrandVoiceDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [topic, setTopic] = useState("")
  const [platform, setPlatform] = useState("TikTok")
  const [audience, setAudience] = useState("")
  const [workspaceId, setWorkspaceId] = useState("")
  const [brandVoiceId, setBrandVoiceId] = useState("")
  const [generating, setGenerating] = useState(false)
  const [postGenerate, setPostGenerate] = useState<{ id: string; title: string } | null>(null)

  const limits = getWorkflowLimitsForPlan(
    displayPlanForUser(user?.plan, user?.role)
  )
  const atCap = items.length >= limits.contentPacks

  const wsName = useMemo(() => {
    const m = new Map(workspaces.map((w) => [w.id, w.name]))
    return (id: string | null) => (id ? m.get(id) ?? null : null)
  }, [workspaces])

  const bvName = useMemo(() => {
    const m = new Map(voices.map((v) => [v.id, v.name]))
    return (id: string | null) => (id ? m.get(id) ?? null : null)
  }, [voices])

  const displayPacks = useMemo(() => sortPacksForDisplay(items), [items])
  const suggestedPackId = useMemo(() => bestPackCandidateId(items), [items])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [packs, ws, bv] = await Promise.all([
        fetchContentPacks(),
        fetchWorkspaces(),
        fetchBrandVoices(),
      ])
      setItems(packs.contentPacks ?? [])
      setWorkspaces(ws.workspaces ?? [])
      setVoices(bv.brandVoices ?? [])
    } catch (e) {
      setError((e as ApiError)?.message ?? "Failed to load packs.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const t = searchParams.get("prefillTopic")
    if (t?.trim()) setTopic(t)
    const p = searchParams.get("prefillPlatform")
    if (p?.trim()) setPlatform(p)
    const a = searchParams.get("prefillAudience")
    if (a !== null) setAudience(a)
    const w = searchParams.get("workspaceId")
    if (w) setWorkspaceId(w)
    const bv = searchParams.get("brandVoiceId")
    if (bv) setBrandVoiceId(bv)
  }, [searchParams])

  const onGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!topic.trim() || generating || atCap) return
    setGenerating(true)
    setError(null)
    try {
      const saved = await generateContentPack({
        topic: topic.trim(),
        platform,
        audience: audience.trim(),
        workspaceId: workspaceId || undefined,
        brandVoiceId: brandVoiceId || undefined,
      })
      setTopic("")
      setPostGenerate({ id: saved.id, title: saved.title })
      await load()
      await refreshUser({ silent: true })
    } catch (err) {
      const ae = err as ApiError
      setError(ae?.message ?? "Generation failed.")
    } finally {
      setGenerating(false)
    }
  }

  const fieldClass =
    "mt-1.5 w-full rounded-xl border border-white/12 bg-black/40 px-3 py-2.5 text-sm text-white placeholder:text-white/30"

  return (
    <DashboardShell showCommandHero={false} contentWidth="readable">
      <div className="space-y-12 pb-8">
        <header className="relative overflow-hidden rounded-2xl border border-violet-400/25 bg-gradient-to-br from-violet-600/25 via-[#0a0c18] to-amber-500/15 p-6 md:p-8">
          <div
            className="pointer-events-none absolute right-0 top-0 h-64 w-64 translate-x-1/4 -translate-y-1/4 rounded-full bg-amber-400/10 blur-3xl"
            aria-hidden
          />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-200/90">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Flagship workflow
              </p>
              <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">Content packs</h1>
              <p className="text-sm leading-relaxed text-white/65 md:text-base">
                Generate a reusable content pack from one idea: hooks, scripts, titles, captions, CTAs, and clip
                angles—ready to open in tools, hand off to editors, or post in batches.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-white/50">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/35 px-3 py-1">
                  <Coins className="h-3.5 w-3.5 text-amber-300/90" aria-hidden />
                  Uses {CREDITS_PER_PACK} credits per pack
                </span>
                <span className="rounded-full border border-white/10 bg-black/35 px-3 py-1">
                  Saved {items.length} / {limits.contentPacks} on your plan
                </span>
              </div>
            </div>
            <Link
              href="/dashboard"
              className="shrink-0 text-sm font-medium text-violet-200 underline-offset-4 hover:text-white hover:underline"
            >
              ← Studio home
            </Link>
          </div>
        </header>

        {workspaceId || brandVoiceId ? (
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/20 px-4 py-3 text-xs leading-relaxed text-cyan-100/85">
            <span className="font-semibold text-white/90">Workflow context · </span>
            {workspaceId && wsName(workspaceId) ? (
              <span>
                Project <span className="font-medium text-white">{wsName(workspaceId)}</span>
              </span>
            ) : (
              <span className="text-white/50">No project selected</span>
            )}
            <span className="text-white/35"> · </span>
            {brandVoiceId && bvName(brandVoiceId) ? (
              <span>
                Style preset <span className="font-medium text-white">{bvName(brandVoiceId)}</span>
              </span>
            ) : (
              <span className="text-white/50">No style preset</span>
            )}
            <span className="mt-1 block text-[11px] text-white/40">
              Carries into this pack so the library can show what lane this batch belonged to.
            </span>
          </div>
        ) : null}

        {error && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {error}
          </div>
        )}

        {postGenerate && (
          <div className="rounded-xl border border-violet-400/30 bg-violet-950/25 px-4 py-4 text-sm text-violet-50/95">
            <p>
              <span className="font-semibold text-white">{postGenerate.title}</span> is saved. Your next step is to
              open the pack and send lines into tools—NovaPulseAI keeps the thread so the library stays honest.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link
                href={`/dashboard/content-packs/${encodeURIComponent(postGenerate.id)}`}
                className="inline-flex flex-1 items-center justify-center rounded-full bg-gradient-to-r from-amber-500 to-violet-600 px-5 py-2.5 text-center text-xs font-semibold text-white shadow-lg shadow-violet-900/25 sm:flex-none"
              >
                Open pack — use lines in tools
              </Link>
              <p className="text-xs text-white/45 sm:ml-2">
                Then check{" "}
                <Link href="/dashboard/library" className="text-violet-200 underline hover:text-white">
                  library
                </Link>{" "}
                to confirm everything landed with the right project tags.
              </p>
              <button
                type="button"
                onClick={() => setPostGenerate(null)}
                className="text-xs text-white/45 underline hover:text-white/70 sm:ml-auto"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <section
          className={`relative overflow-hidden rounded-2xl border border-violet-500/20 bg-gradient-to-b from-violet-950/30 to-black/40 p-6 shadow-[0_24px_80px_-24px_rgba(124,58,237,0.35)] transition-opacity md:p-8 ${
            loading ? "pointer-events-none opacity-60" : ""
          }`}
          aria-busy={loading}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-400/40 to-transparent" />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <Wand2 className="h-5 w-5 text-violet-300" aria-hidden />
              Pack generator
            </h2>
            <p className="text-xs text-white/45">Best starting point when you have a topic and a platform in mind.</p>
          </div>
          <p className="mt-3 max-w-2xl text-sm text-white/55">
            One run produces a structured bundle you can drill into on the pack page and route into Video Script,
            Story Maker, or Clipper. Choosing a workspace and brand voice here materially improves coherence—same as
            briefing a human writer.
          </p>

          <div className="mt-5 rounded-xl border border-white/10 bg-black/25 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-white/45">Try an example angle</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {EXAMPLE_TOPICS.map((ex) => (
                <button
                  key={ex.slice(0, 28)}
                  type="button"
                  onClick={() => setTopic(ex)}
                  className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-xs leading-snug text-white/70 transition hover:border-violet-400/35 hover:text-white"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-white/45">Context (recommended)</p>
            <CreatorWorkflowSelectors
              workspaceId={workspaceId}
              brandVoiceId={brandVoiceId}
              onWorkspaceChange={setWorkspaceId}
              onBrandVoiceChange={setBrandVoiceId}
              disabled={generating || atCap}
            />
          </div>

          <form className="mt-5 grid gap-5 md:grid-cols-2" onSubmit={onGenerate}>
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-white/55">Topic *</label>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                rows={4}
                className={fieldClass}
                placeholder="What is this batch about? Add angle, offer, or story beat…"
                disabled={generating || atCap}
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/55">Platform</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className={`${fieldClass} text-white`}
                disabled={generating || atCap}
              >
                <option>TikTok</option>
                <option>Instagram Reels</option>
                <option>YouTube Shorts</option>
                <option>X / Twitter</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-white/55">Audience</label>
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                className={fieldClass}
                placeholder="Who is this batch speaking to?"
                disabled={generating || atCap}
              />
            </div>
            <div className="md:col-span-2 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={generating || atCap || !topic.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-amber-500 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 disabled:opacity-40"
              >
                {generating ? (
                  "Generating pack…"
                ) : (
                  <>
                    <Boxes className="h-4 w-4" aria-hidden />
                    Generate &amp; save pack
                  </>
                )}
              </button>
              {atCap && (
                <p className="text-xs text-amber-200/90">
                  Pack limit reached —{" "}
                  <Link href="/pricing" className="font-medium underline">
                    upgrade
                  </Link>
                </p>
              )}
            </div>
          </form>
        </section>

        <section aria-labelledby="saved-packs-heading">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="saved-packs-heading" className="text-lg font-semibold text-white">
                Saved packs
              </h2>
              <p className="mt-1 max-w-xl text-sm text-white/50">
                Open any pack to launch tools with one click, copy lines, or regenerate a similar batch.
              </p>
            </div>
          </div>

          {loading ? (
            <ContentPacksSavedGridSkeleton />
          ) : items.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-violet-400/25 bg-violet-950/10 p-8 text-center">
              <p className="font-medium text-white/85">No packs yet</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-white/50">
                {workspaceId && wsName(workspaceId) ? (
                  <>
                    You are scoped to <span className="font-medium text-white/75">{wsName(workspaceId)}</span>. Add
                    one strong topic above and generate—workspace + voice travel into the pack automatically.
                  </>
                ) : (
                  <>
                    Your first pack becomes the hub for that idea—hooks through CTAs in one place. Pick a workspace and
                    voice above if you want everything tagged to a project lane.
                  </>
                )}
              </p>
              <p className="mx-auto mt-5 max-w-sm text-xs font-medium text-violet-200/90">
                Next: describe one batch in the generator, then open the pack to push lines into Video Script or
                Story Maker.
              </p>
            </div>
          ) : (
            <ul className="mt-6 grid gap-4 sm:grid-cols-2">
              {displayPacks.map((p) => {
                const wn = wsName(p.workspaceId)
                const vn = bvName(p.brandVoiceId)
                const reuseHref = buildToolHandoffUrl("/dashboard/content-packs", {
                  prefillTopic: p.topic,
                  prefillPlatform: p.platform,
                  prefillAudience: p.audience?.trim() || undefined,
                  workspaceId: p.workspaceId ?? undefined,
                  brandVoiceId: p.brandVoiceId ?? undefined,
                })
                const counts = countPackPayloadLines(p.payload)
                const chips = formatPackCountsChips(counts)
                const previewLine = packCardPreviewLine(p.payload, p.topic, 108)
                const previewLabel = packCardPreviewLabel(p.payload, p.topic)
                const sparseLines = isPackPayloadLinesEmpty(p.payload)
                return (
                  <li
                    key={p.id}
                    className="flex flex-col rounded-2xl border border-white/10 bg-black/30 p-5 transition hover:border-violet-400/25 hover:bg-black/40"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(p.status)}`}
                      >
                        {p.status}
                      </span>
                      {p.id === suggestedPackId ? (
                        <span
                          className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100/90"
                          title="Most lines + context on this list"
                        >
                          Best bet
                        </span>
                      ) : null}
                      <span className="text-[11px] text-white/35">
                        {new Date(p.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <Link
                      href={`/dashboard/content-packs/${p.id}`}
                      className="mt-3 block text-base font-semibold leading-snug text-white transition hover:text-violet-200"
                    >
                      {p.title}
                    </Link>
                    <p className="mt-2 line-clamp-3 text-sm text-white/55">{p.topic}</p>
                    {chips.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {chips.slice(0, 6).map((c) => (
                          <span
                            key={c}
                            className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/55"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-[11px] leading-relaxed text-white/45">{packSparseCardHint(p.topic)}</p>
                    )}
                    <p className="mt-2 border-l-2 border-violet-500/35 bg-violet-950/10 py-2 pl-3 pr-2 text-xs leading-snug text-white/60">
                      <span className="font-medium text-violet-200/90">{previewLabel} · </span>
                      <span className={sparseLines ? "text-white/55" : "italic text-white/55"}>{previewLine}</span>
                    </p>
                    <p className="mt-3 text-xs text-white/45">
                      <span className="text-white/60">{p.platform}</span>
                      {p.audience ? (
                        <>
                          {" "}
                          · <span className="text-white/55">{p.audience}</span>
                        </>
                      ) : null}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {wn ? (
                        <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-0.5 text-[11px] text-cyan-100/90">
                          {wn}
                        </span>
                      ) : (
                        <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] text-white/35">
                          No project tag
                        </span>
                      )}
                      {vn ? (
                        <span className="rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 px-2.5 py-0.5 text-[11px] text-fuchsia-100/90">
                          {vn}
                        </span>
                      ) : (
                        <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] text-white/35">
                          No style preset
                        </span>
                      )}
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2 border-t border-white/10 pt-4">
                      <Link
                        href={reuseHref}
                        className="inline-flex flex-1 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] px-4 py-2 text-center text-xs font-medium text-white/85 min-[400px]:flex-none"
                      >
                        Reuse settings
                      </Link>
                      <Link
                        href={`/dashboard/content-packs/${p.id}`}
                        className="inline-flex flex-1 items-center justify-center rounded-full border border-violet-400/40 bg-violet-500/15 px-4 py-2 text-center text-xs font-semibold text-violet-100 min-[400px]:flex-none"
                      >
                        Open detail
                      </Link>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <aside className="rounded-xl border border-white/8 bg-violet-950/20 px-4 py-3 text-xs leading-relaxed text-white/50">
          After a pack lands, ship lines into{" "}
          <Link href="/dashboard/tools/video" className="text-violet-300 underline">
            Video Script
          </Link>{" "}
          or{" "}
          <Link href="/dashboard/tools/story-maker" className="text-violet-300 underline">
            Story Maker
          </Link>{" "}
          from the pack detail page—your{" "}
          <Link href="/dashboard/library" className="text-violet-300 underline">
            library
          </Link>{" "}
          will track the thread.
        </aside>
      </div>
    </DashboardShell>
  )
}
