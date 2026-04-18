"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Mic2, Quote, Shield, Wand2 } from "lucide-react"
import DashboardShell from "@/components/dashboard/DashboardShell"
import { useAuth } from "@/context/AuthContext"
import { displayPlanForUser, getWorkflowLimitsForPlan } from "@/lib/plans"
import { ApiError } from "@/lib/api"
import {
  createBrandVoice,
  deleteBrandVoice,
  fetchBrandVoices,
  fetchContentPacks,
  fetchWorkspaces,
  updateBrandVoice,
  type BrandVoiceDto,
  type WorkspaceDto,
} from "@/lib/workflowApi"
import { BrandVoicesListSkeleton } from "@/components/workflow/WorkflowPageSkeletons"

function bannedToText(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw.filter((x) => typeof x === "string").join("\n")
  }
  return ""
}

const EXAMPLE_PRESETS = [
  {
    label: "Bold UGC ad voice",
    name: "Bold UGC — skincare",
    tone: "Confident, punchy, slightly irreverent; short sentences.",
    pacing: "Fast hooks in first 2 seconds; pattern interrupts every ~6s.",
    slangLevel: "Light internet slang; no cringe overload.",
    ctaStyle: "Comment keyword + link in bio; urgency without fake scarcity.",
    audienceSophistication: "Skincare-curious; knows basics, wants proof.",
    bannedText: "guaranteed results\ncures overnight",
    notes: "Use for TikTok/Reels UGC where product demo is hero.",
  },
  {
    label: "Clean educational creator",
    name: "Educational — calm authority",
    tone: "Clear, warm expert; no hype adjectives.",
    pacing: "Measured; one idea per beat; recap at end.",
    slangLevel: "Minimal; professional but approachable.",
    ctaStyle: "Subscribe for part 2; save for later reference.",
    audienceSophistication: "Mixed beginners; define jargon once.",
    bannedText: "you won't believe\nsecret they don't want you to know",
    notes: "Best for explainers, tutorials, newsletter-driven channels.",
  },
  {
    label: "High-energy viral storytelling",
    name: "Story — high retention",
    tone: "Dramatic but believable; vivid sensory details.",
    pacing: "Staccato lines; cliffhangers at scroll points.",
    slangLevel: "Platform-native (TikTok) without dated memes.",
    ctaStyle: "Tease next episode; follow for the ending.",
    audienceSophistication: "General audience; avoid niche in-jokes.",
    bannedText: "part 394729",
    notes: "Faceless history, true crime angles, myth-busting shorts.",
  },
] as const

function workspaceLabel(id: string | null, workspaces: WorkspaceDto[]) {
  if (!id) return "Applies to every project"
  const w = workspaces.find((x) => x.id === id)
  return w ? `Project · ${w.name}` : "Linked to a project"
}

function truncate(s: string, max: number) {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1).trimEnd()}…`
}

function voiceStructuredSummary(b: BrandVoiceDto): string[] {
  const lines: string[] = []
  if (b.audienceSophistication.trim())
    lines.push(`Audience fit: ${truncate(b.audienceSophistication, 100)}`)
  if (b.ctaStyle.trim()) lines.push(`Closes like: ${truncate(b.ctaStyle, 88)}`)
  if (b.slangLevel.trim()) lines.push(`Voice texture: ${truncate(b.slangLevel, 72)}`)
  return lines.length ? lines : ["Add tone, pacing, and audience notes so every run matches your channel."]
}

function voiceReadAloudPreview(b: BrandVoiceDto): string | null {
  const tone = b.tone.trim()
  const pace = b.pacing.trim()
  if (!tone && !pace) return null
  const combined = [tone, pace].filter(Boolean).join(" ")
  if (combined.length < 14) return null
  return truncate(combined, 168)
}

export default function BrandVoicesPage() {
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const [items, setItems] = useState<BrandVoiceDto[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [workspaceId, setWorkspaceId] = useState("")
  const [tone, setTone] = useState("")
  const [pacing, setPacing] = useState("")
  const [slangLevel, setSlangLevel] = useState("")
  const [ctaStyle, setCtaStyle] = useState("")
  const [bannedText, setBannedText] = useState("")
  const [audienceSophistication, setAudienceSophistication] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [nextStepBanner, setNextStepBanner] = useState(false)
  const [lastCreatedVoice, setLastCreatedVoice] = useState<{
    id: string
    workspaceId: string | null
  } | null>(null)
  const [voicePackTouch, setVoicePackTouch] = useState<
    Map<string, { count: number; lastAt: string | null }>
  >(() => new Map())

  const limits = getWorkflowLimitsForPlan(
    displayPlanForUser(user?.plan, user?.role)
  )
  const atCap = items.length >= limits.brandVoices

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [bv, ws] = await Promise.all([fetchBrandVoices(), fetchWorkspaces()])
      setItems(bv.brandVoices ?? [])
      setWorkspaces(ws.workspaces ?? [])
      const m = new Map<string, { count: number; lastAt: string | null }>()
      try {
        const packsRes = await fetchContentPacks()
        for (const p of packsRes.contentPacks ?? []) {
          if (!p.brandVoiceId) continue
          const cur = m.get(p.brandVoiceId) ?? { count: 0, lastAt: null }
          cur.count += 1
          if (!cur.lastAt || new Date(p.updatedAt) > new Date(cur.lastAt)) cur.lastAt = p.updatedAt
          m.set(p.brandVoiceId, cur)
        }
      } catch {
        /* pack tally is optional */
      }
      setVoicePackTouch(m)
    } catch (e) {
      setError((e as ApiError)?.message ?? "Failed to load brand voices.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const w = searchParams.get("workspace")
    if (w && workspaces.some((x) => x.id === w)) {
      setWorkspaceId(w)
    }
  }, [searchParams, workspaces])

  const displayVoices = useMemo(() => {
    return [...items].sort((a, b) => {
      const ta = voicePackTouch.get(a.id)?.count ?? 0
      const tb = voicePackTouch.get(b.id)?.count ?? 0
      if (tb !== ta) return tb - ta
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })
  }, [items, voicePackTouch])

  const suggestedVoiceId = useMemo(() => {
    if (items.length < 2) return null
    let bestId: string | null = null
    let bestN = -1
    for (const b of items) {
      const n = voicePackTouch.get(b.id)?.count ?? 0
      if (n > bestN) {
        bestN = n
        bestId = b.id
      } else if (n === bestN && bestId) {
        const prev = items.find((x) => x.id === bestId)
        if (prev && new Date(b.updatedAt) > new Date(prev.updatedAt)) bestId = b.id
      }
    }
    return bestN > 0 ? bestId : null
  }, [items, voicePackTouch])

  const resetForm = () => {
    setEditingId(null)
    setName("")
    setWorkspaceId("")
    setTone("")
    setPacing("")
    setSlangLevel("")
    setCtaStyle("")
    setBannedText("")
    setAudienceSophistication("")
    setNotes("")
  }

  const startEdit = (b: BrandVoiceDto) => {
    setEditingId(b.id)
    setName(b.name)
    setWorkspaceId(b.workspaceId ?? "")
    setTone(b.tone)
    setPacing(b.pacing)
    setSlangLevel(b.slangLevel)
    setCtaStyle(b.ctaStyle)
    setBannedText(bannedToText(b.bannedPhrases))
    setAudienceSophistication(b.audienceSophistication)
    setNotes(b.notes)
  }

  const applyExample = (ex: (typeof EXAMPLE_PRESETS)[number]) => {
    setEditingId(null)
    setName(ex.name)
    setTone(ex.tone)
    setPacing(ex.pacing)
    setSlangLevel(ex.slangLevel)
    setCtaStyle(ex.ctaStyle)
    setAudienceSophistication(ex.audienceSophistication)
    setBannedText(ex.bannedText)
    setNotes(ex.notes)
    document.getElementById("brand-voice-form")?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || saving) return
    if (!editingId && atCap) return
    setSaving(true)
    setError(null)
    try {
      const bannedPhrases = bannedText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
      const payload = {
        name: name.trim(),
        workspaceId: workspaceId || undefined,
        tone,
        pacing,
        slangLevel,
        ctaStyle,
        bannedPhrases,
        audienceSophistication,
        notes,
      }
      if (editingId) {
        await updateBrandVoice(editingId, {
          ...payload,
          workspaceId: workspaceId || null,
        })
      } else {
        const created = await createBrandVoice(payload)
        setLastCreatedVoice({ id: created.id, workspaceId: created.workspaceId })
        setNextStepBanner(true)
      }
      resetForm()
      await load()
    } catch (err) {
      setError((err as ApiError)?.message ?? "Save failed.")
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (id: string) => {
    if (!confirm("Delete this brand voice?")) return
    try {
      await deleteBrandVoice(id)
      await load()
    } catch (err) {
      setError((err as ApiError)?.message ?? "Delete failed.")
    }
  }

  const fieldClass =
    "mt-1.5 w-full rounded-xl border border-white/12 bg-black/35 px-3 py-2.5 text-sm text-white placeholder:text-white/30"

  return (
    <DashboardShell showCommandHero={false} contentWidth="readable">
      <div className="space-y-12 pb-8">
        <header className="relative overflow-hidden rounded-2xl border border-fuchsia-500/20 bg-gradient-to-br from-fuchsia-950/35 via-[#0c1020] to-amber-950/20 p-6 md:p-8">
          <div
            className="pointer-events-none absolute -left-10 bottom-0 h-40 w-40 rounded-full bg-fuchsia-500/15 blur-3xl"
            aria-hidden
          />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300/90">
                Reusable style presets
              </p>
              <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">Brand voice presets</h1>
              <p className="max-w-xl text-sm leading-relaxed text-white/60 md:text-base">
                Save the tone, pacing, CTA style, and audience sophistication you want every generation to follow—so
                you stop rewriting the same instructions on every script, story, and pack.
              </p>
              <p className="text-sm text-white/45">
                Video Script and Story Maker pull these fields into prompts automatically when you select a voice.
              </p>
              <span className="inline-flex rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/55">
                {items.length} / {limits.brandVoices} voices on your plan
              </span>
            </div>
            <Link
              href="/dashboard"
              className="shrink-0 text-sm font-medium text-fuchsia-200/90 underline-offset-4 hover:text-white hover:underline"
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
          <div className="rounded-xl border border-fuchsia-500/25 bg-fuchsia-950/20 px-4 py-4 text-sm text-fuchsia-50/95">
            <p className="font-medium text-white/90">Style preset saved</p>
            <p className="mt-2 text-white/65">
              Put it to work in a batch so hooks and scripts inherit the same tone—workspace selection stays in sync if
              you scoped this voice to one project.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link
                href={(() => {
                  if (!lastCreatedVoice) return "/dashboard/content-packs"
                  const q = new URLSearchParams()
                  if (lastCreatedVoice.workspaceId) q.set("workspaceId", lastCreatedVoice.workspaceId)
                  q.set("brandVoiceId", lastCreatedVoice.id)
                  return `/dashboard/content-packs?${q.toString()}`
                })()}
                className="inline-flex flex-1 items-center justify-center rounded-full bg-gradient-to-r from-fuchsia-600 to-amber-600 px-5 py-2.5 text-center text-xs font-semibold text-white shadow-md shadow-fuchsia-900/25 sm:flex-none"
              >
                Next: run a content pack with this preset →
              </Link>
              <p className="text-xs text-white/45">
                Prefer a single script? Open{" "}
                <Link href="/dashboard/tools/video" className="text-fuchsia-200 underline hover:text-white">
                  Video Script
                </Link>{" "}
                and pick the same voice from the dropdown.
              </p>
              <button
                type="button"
                onClick={() => {
                  setNextStepBanner(false)
                  setLastCreatedVoice(null)
                }}
                className="text-xs text-white/45 underline hover:text-white/70 sm:ml-auto"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:grid-cols-[1fr_minmax(0,280px)] md:items-start md:p-6">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Wand2 className="h-4 w-4 text-fuchsia-300/90" aria-hidden />
              Inspiration — tap to load the form
            </h2>
            <p className="mt-1 text-xs text-white/45">
              Starting points only; rename and edit before saving so they match your channel.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLE_PRESETS.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  onClick={() => applyExample(ex)}
                  className="rounded-full border border-fuchsia-500/25 bg-fuchsia-500/10 px-3 py-1.5 text-xs font-medium text-fuchsia-100/95 transition hover:bg-fuchsia-500/20"
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>
          <aside className="rounded-xl border border-white/10 bg-black/30 p-4 text-xs leading-relaxed text-white/50">
            <p className="font-semibold text-white/70">How this voice is used</p>
            <p className="mt-2">
              Attached voices travel into AI prompts as structured constraints—stronger than pasting “be fun” into a
              text box each time.
            </p>
          </aside>
        </div>

        {loading ? (
          <BrandVoicesListSkeleton />
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-fuchsia-500/25 bg-gradient-to-b from-fuchsia-950/15 to-transparent p-8 text-center md:p-10">
            <Mic2 className="mx-auto h-10 w-10 text-fuchsia-300/70" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold text-white">No presets yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-white/55">
              Create one voice for how you sound on camera, and another for faceless or client work. Consistency is
              what makes batch content feel premium instead of generic.
            </p>
            <p className="mx-auto mt-5 max-w-md text-xs font-medium text-fuchsia-200/90">
              Next:{" "}
              <Link href="/dashboard/workspaces" className="underline hover:text-white">
                set up a project
              </Link>{" "}
              if you have not yet, then save a preset scoped to that lane.
            </p>
          </div>
        ) : (
          <section aria-labelledby="saved-voices">
            <h2 id="saved-voices" className="text-lg font-semibold text-white">
              Saved voices
            </h2>
            <ul className="mt-4 grid gap-3">
              {displayVoices.map((b) => (
                <li
                  key={b.id}
                  className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/25 p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-white">{b.name}</p>
                      {b.id === suggestedVoiceId ? (
                        <span
                          className="rounded-full border border-fuchsia-500/25 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-100/90"
                          title="Referenced by the most saved packs"
                        >
                          Most used
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-fuchsia-200/70">{workspaceLabel(b.workspaceId, workspaces)}</p>
                    {(() => {
                      const t = voicePackTouch.get(b.id)
                      if (t && t.count > 0) {
                        return (
                          <p className="mt-1.5 text-[11px] text-fuchsia-200/65">
                            Signals · used in {t.count} saved pack{t.count === 1 ? "" : "s"}
                            {t.lastAt
                              ? ` · last pack touch ${new Date(t.lastAt).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                })}`
                              : ""}
                          </p>
                        )
                      }
                      return (
                        <p className="mt-1.5 text-[11px] text-white/35">
                          Signals · not referenced by a saved pack yet—pick this preset in the pack generator to stamp
                          batches.
                        </p>
                      )
                    })()}
                    {voiceReadAloudPreview(b) ? (
                      <div className="mt-3 border-l-2 border-fuchsia-500/35 bg-fuchsia-950/20 py-2 pl-3 pr-2">
                        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-200/85">
                          <Quote className="h-3 w-3 shrink-0" aria-hidden />
                          How it reads
                        </p>
                        <p className="mt-1.5 text-sm italic leading-relaxed text-white/70">
                          &ldquo;{voiceReadAloudPreview(b)}&rdquo;
                        </p>
                      </div>
                    ) : null}
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {voiceStructuredSummary(b)
                        .slice(0, 2)
                        .map((line) => {
                          const colon = line.indexOf(":")
                          const hasLabel = colon >= 0
                          const labelPart = hasLabel ? line.slice(0, colon).trim() : ""
                          const bodyPart = hasLabel ? line.slice(colon + 1).trim() : line
                          return (
                            <p
                              key={line}
                              className={`rounded-lg border border-white/8 bg-black/20 px-2.5 py-2 text-[11px] leading-snug text-white/60 ${
                                line.startsWith("Add ") ? "sm:col-span-2" : ""
                              }`}
                            >
                              {line.startsWith("Add ") ? (
                                line
                              ) : hasLabel && labelPart ? (
                                <>
                                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-white/35">
                                    {labelPart}
                                  </span>
                                  <span className="mt-0.5 block text-white/65">{bodyPart || line}</span>
                                </>
                              ) : (
                                <span className="block text-white/65">{bodyPart}</span>
                              )}
                            </p>
                          )
                        })}
                    </div>
                    <p className="mt-3 text-[11px] text-white/35">
                      Updated {new Date(b.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(b)}
                      className="rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-white/85 hover:bg-white/5"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDelete(b.id)}
                      className="rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section
          id="brand-voice-form"
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 md:p-8"
        >
          <div className="border-b border-white/10 pb-5">
            <h2 className="text-base font-semibold text-white">
              {editingId ? "Edit brand voice" : "New brand voice"}
            </h2>
            <p className="mt-1 text-xs text-white/45">
              Grouped the same way you think about a shoot: identity, delivery, audience, CTAs, guardrails.
            </p>
          </div>

          <form className="mt-6 space-y-8" onSubmit={onSubmit}>
            <fieldset className="space-y-4 rounded-xl border border-white/8 bg-black/20 p-4 md:p-5">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-white/50">
                Identity
              </legend>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-white/55">Preset name *</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={fieldClass}
                    placeholder="e.g. Main channel · TikTok energy"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-white/55">Workspace (optional)</label>
                  <select
                    value={workspaceId}
                    onChange={(e) => setWorkspaceId(e.target.value)}
                    className="np-select mt-1.5 w-full"
                  >
                    <option value="">Global — use across all workspaces</option>
                    {workspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-white/35">Scope to one client or lane, or keep global.</p>
                </div>
              </div>
            </fieldset>

            <fieldset className="space-y-4 rounded-xl border border-white/8 bg-black/20 p-4 md:p-5">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-white/50">
                Tone &amp; pacing
              </legend>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-white/55">Tone</label>
                  <input
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    className={fieldClass}
                    placeholder="e.g. Warm expert, hype creator, deadpan humor…"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-white/55">Pacing</label>
                  <input
                    value={pacing}
                    onChange={(e) => setPacing(e.target.value)}
                    className={fieldClass}
                    placeholder="e.g. Hook in 1s, staccato lines, slow build + payoff"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-medium text-white/55">Slang &amp; internet voice</label>
                  <input
                    value={slangLevel}
                    onChange={(e) => setSlangLevel(e.target.value)}
                    className={fieldClass}
                    placeholder="e.g. Light Gen-Z phrasing, zero slang, corporate polish…"
                  />
                </div>
              </div>
            </fieldset>

            <fieldset className="space-y-4 rounded-xl border border-white/8 bg-black/20 p-4 md:p-5">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-white/50">
                Audience fit
              </legend>
              <div>
                <label className="text-xs font-medium text-white/55">Audience sophistication</label>
                <input
                  value={audienceSophistication}
                  onChange={(e) => setAudienceSophistication(e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. Total beginners · pros who want shortcuts · mixed mainstream"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-white/55">Creator notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className={fieldClass}
                  placeholder="Anything else the model should remember (formatting quirks, sign-off, series name)…"
                />
              </div>
            </fieldset>

            <fieldset className="space-y-4 rounded-xl border border-white/8 bg-black/20 p-4 md:p-5">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-white/50">
                CTA style
              </legend>
              <div>
                <label className="text-xs font-medium text-white/55">How you like to close</label>
                <input
                  value={ctaStyle}
                  onChange={(e) => setCtaStyle(e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. Soft save + follow, hard pitch + link, question to drive comments…"
                />
              </div>
            </fieldset>

            <fieldset className="space-y-4 rounded-xl border border-amber-500/15 bg-amber-950/10 p-4 md:p-5">
              <legend className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-amber-200/80">
                <Shield className="h-3.5 w-3.5" aria-hidden />
                Guardrails
              </legend>
              <div>
                <label className="text-xs font-medium text-white/55">Banned phrases (one per line)</label>
                <textarea
                  value={bannedText}
                  onChange={(e) => setBannedText(e.target.value)}
                  rows={4}
                  className={fieldClass}
                  placeholder={"medical claims you won't say\ncompetitor names\nwords your brand avoids"}
                />
                <p className="mt-1 text-[11px] text-white/35">
                  Model will steer around these; combine with your own compliance review for regulated niches.
                </p>
              </div>
            </fieldset>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={saving || (!editingId && atCap)}
                className="rounded-full bg-gradient-to-r from-fuchsia-600 to-amber-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {saving ? "Saving…" : editingId ? "Save changes" : "Create brand voice"}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-full border border-white/15 px-6 py-2.5 text-sm text-white/75 hover:bg-white/5"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
          {atCap && !editingId && (
            <p className="mt-4 text-xs text-amber-200/90">
              Voice limit reached — see{" "}
              <Link href="/pricing" className="font-medium underline">
                Pricing
              </Link>
              .
            </p>
          )}
        </section>

        <aside className="rounded-xl border border-white/8 bg-fuchsia-950/15 px-4 py-3 text-xs leading-relaxed text-white/50">
          <span className="font-medium text-fuchsia-200/90">Recommended flow:</span> pair each workspace with at least
          one voice, then pick both when you run a{" "}
          <Link href="/dashboard/content-packs" className="text-fuchsia-300 underline">
            content pack
          </Link>
          .
        </aside>
      </div>
    </DashboardShell>
  )
}
