"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { api, LONG_REQUEST_TIMEOUT_MS } from "@/lib/api"
import PackagingPresetPicker from "@/components/ad-studio/PackagingPresetPicker"
import {
  STUDIO_CREATIVE_MODE_OPTIONS,
  STUDIO_QUICK_PICK_MODE_IDS,
  VIDEO_PACKAGING_PRESETS,
} from "@/lib/ad-studio-presets"
import { normalizeToolOperation } from "@/lib/tool-operation"
import { useAdsJobPolling } from "@/hooks/useAdsJobPolling"
import AdsAdminJobsList from "./_components/AdsAdminJobsList"

/* ====================================================== */

type GenerateResponse = {
  success: boolean
  jobId: string
}

/* ====================================================== */

const AdsJobReviewPanel = dynamic(
  () => import("./_components/AdsJobReviewPanel"),
  {
    loading: () => (
      <div className="mt-12 rounded-xl border border-white/10 bg-white/[0.04] p-6 text-sm text-white/60">
        Loading review…
      </div>
    ),
  }
)

/* ====================================================== */

export default function AdsPage() {
  const router = useRouter()

  const [siteUrl, setSiteUrl] = useState("")
  const [tone, setTone] = useState("clean")
  const [duration, setDuration] = useState(30)
  const [platform, setPlatform] = useState("tiktok")
  const [editingStyle, setEditingStyle] = useState("auto")
  const [ultra, setUltra] = useState(true)
  const [creativeMode, setCreativeMode] = useState<"cinematic" | "ugc_social">(
    "cinematic"
  )
  const [renderTopVariants, setRenderTopVariants] = useState<1 | 2>(1)
  const [fastPreviewGenerate, setFastPreviewGenerate] = useState(false)
  const [operatorBrief, setOperatorBrief] = useState("")
  const [studioCreativeMode, setStudioCreativeMode] = useState("")
  const [videoPackaging, setVideoPackaging] = useState("")
  const [voiceMode, setVoiceMode] = useState<"ai_openai_tts" | "silent_music_only">(
    "ai_openai_tts"
  )
  const [captionAccentHex, setCaptionAccentHex] = useState("")

  const normalizeUrl = (url: string) => {
    const trimmed = url.trim()
    if (!trimmed) return ""
    if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`
    return trimmed
  }

  const validUrl = (url: string) => {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  }

  const stageFromProgress = (p: number) => {
    if (p < 18) return "Analyzing website structure"
    if (p < 20) return "Extracting product insights"
    if (p < 30) return "Writing viral ad script"
    if (p < 41) return "Preparing audio & timing"
    if (p < 52) return "Capturing website (browser — often the longest step)"
    if (p < 57) return "Building cinematic timeline (video encode)"
    if (p < 71) return "Color grading & audio mix"
    if (p < 100) return "Final video render"
    return "Finishing render"
  }

  const eta = () => {
    if (duration <= 15) return "1-3 min"
    if (duration <= 30) return "2-5 min"
    if (duration <= 45) return "3-7 min"
    return "4-10 min"
  }

  const normalizeOutputUrl = (url: string) => {
    if (url.startsWith("http")) return url
    const rawBase = process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:5000"
    const base = rawBase.endsWith("/api") ? rawBase.slice(0, -4) : rawBase
    return `${base.replace(/\/$/, "")}${url}`
  }

  const job = useAdsJobPolling({
    storageKey: "vf:admin-ads:job",
    normalizeOutputUrl,
    stageFromProgress,
    cancelPath: jobId => `/ads/${jobId}/cancel`,
  })

  const openJobById = useCallback(
    async (jid: string) => {
      router.replace(`/admin/ads?job=${encodeURIComponent(jid)}`, {
        scroll: false,
      })
      await job.loadJobForReview(jid)
    },
    [job, router]
  )

  const [adJobsListTick, setAdJobsListTick] = useState(0)

  const studioHint = useMemo(() => {
    const id = studioCreativeMode.trim()
    if (!id) {
      return "Presets steer hook, pacing, and on-screen treatment. Skip this if you only want a balanced pass."
    }
    return (
      STUDIO_CREATIVE_MODE_OPTIONS.find(m => m.id === id)?.hint ??
      "Shapes script beats and default packaging on the server."
    )
  }, [studioCreativeMode])

  useEffect(() => {
    if (job.state.jobId) setAdJobsListTick(t => t + 1)
  }, [job.state.jobId])

  const generateAd = async () => {
    if (job.state.loading) return

    const url = normalizeUrl(siteUrl)

    if (!validUrl(url)) {
      job.setError("Enter a valid website URL")
      return
    }

    job.resetForNewRun()

    try {
      const accent = captionAccentHex.trim()
      const res = await api.post<GenerateResponse>(
        "/ads/generate",
        {
          siteUrl: url,
          tone,
          duration,
          platform,
          editingStyle,
          ultra,
          creativeMode,
          renderTopVariants,
          ...(operatorBrief.trim()
            ? { operatorBrief: operatorBrief.trim().slice(0, 4000) }
            : {}),
          ...(studioCreativeMode.trim()
            ? { studioCreativeMode: studioCreativeMode.trim() }
            : {}),
          ...(videoPackaging.trim() ? { videoPackaging: videoPackaging.trim() } : {}),
          voiceMode,
          ...(accent && /^[0-9A-Fa-f]{6}$/.test(accent) ? { captionAccentHex: accent } : {}),
          ...(fastPreviewGenerate ? { previewMode: "fast" as const } : {}),
        },
        {
          timeout: LONG_REQUEST_TIMEOUT_MS,
          retry: 0,
          idempotencyKey: `admin-ads-generate:${crypto.randomUUID()}`,
        }
      )
      const operation = normalizeToolOperation(res)

      if (!operation.success || !operation.jobId)
        throw new Error(operation.message || "Invalid response")

      job.begin(operation.jobId, operation.requestId)
      router.replace(`/admin/ads?job=${encodeURIComponent(operation.jobId)}`, {
        scroll: false,
      })
    } catch (e: unknown) {
      job.setError(
        (e as { data?: { message?: string } })?.data?.message ||
          (e instanceof Error ? e.message : null) ||
          "Ad generation failed"
      )
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return
    const q = new URLSearchParams(window.location.search).get("job")
    if (q) {
      void job.loadJobForReview(q)
      return
    }
    void job.resume()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resumeUrlSyncedRef = useRef(false)
  useEffect(() => {
    if (typeof window === "undefined" || resumeUrlSyncedRef.current) return
    const q = new URLSearchParams(window.location.search).get("job")
    if (q) {
      resumeUrlSyncedRef.current = true
      return
    }
    if (job.state.jobId) {
      resumeUrlSyncedRef.current = true
      router.replace(`/admin/ads?job=${encodeURIComponent(job.state.jobId)}`, {
        scroll: false,
      })
    }
  }, [job.state.jobId, router])

  return (
    <div className="min-h-screen bg-[#0B0F19] px-6 py-12 text-white">
      <div className="mx-auto max-w-3xl space-y-10">
        <header className="space-y-3">
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200/85">
              Internal · AI Ads Operator Console
            </p>
            <p className="mt-2 text-sm leading-relaxed text-white/65">
              Full pipeline controls, fast preview, packaging, dual renders, diagnostics, and review. The
              customer-facing tool is{" "}
              <span className="text-white/85">Dashboard → AI Ad Generator</span>{" "}
              <span className="text-white/55">(/dashboard/tools/ai-ad-generator)</span>.
            </p>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-white">AI Ads Operator Console</h1>
          <p className="text-sm leading-relaxed text-white/55">
            Drop in a URL, steer creative and caption packaging, then generate. Use{" "}
            <span className="text-white/75">Advanced</span> for capture tuning, render count, fast preview,
            and operator handoff notes — not exposed to end creators.
          </p>
        </header>

        <div className="space-y-8">
          <input
            type="text"
            placeholder="https://example.com"
            value={siteUrl}
            onChange={e => setSiteUrl(e.target.value)}
            disabled={job.state.loading}
            className="w-full rounded-2xl border border-white/[0.14] bg-white/[0.06] px-5 py-4 text-base text-white shadow-[0_20px_50px_-28px_rgba(0,0,0,0.85)] outline-none transition placeholder:text-white/35 focus:border-purple-400/40 focus:ring-2 focus:ring-purple-500/25"
          />

          <div className="space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
              Creative direction
            </span>
            <select
              value={studioCreativeMode}
              onChange={e => setStudioCreativeMode(e.target.value)}
              disabled={job.state.loading}
              className="np-select w-full"
            >
              <option value="">Balanced · no preset</option>
              {STUDIO_CREATIVE_MODE_OPTIONS.map(opt => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs leading-relaxed text-white/45">{studioHint}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {STUDIO_QUICK_PICK_MODE_IDS.map(id => {
                const opt = STUDIO_CREATIVE_MODE_OPTIONS.find(o => o.id === id)
                if (!opt) return null
                const active = studioCreativeMode === id
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={job.state.loading}
                    onClick={() => setStudioCreativeMode(active ? "" : id)}
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition disabled:opacity-50 ${
                      active
                        ? "border-purple-400/50 bg-purple-500/20 text-white shadow-sm"
                        : "border-white/12 bg-white/[0.04] text-white/55 hover:border-white/22 hover:text-white/80"
                    }`}
                    title={opt.hint}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                Sound
              </span>
              <div className="flex rounded-xl border border-white/[0.12] bg-black/25 p-1">
                {(
                  [
                    { id: "ai_openai_tts" as const, label: "Narration" },
                    { id: "silent_music_only" as const, label: "Music only" },
                  ] as const
                ).map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={job.state.loading}
                    onClick={() => setVoiceMode(opt.id)}
                    className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                      voiceMode === opt.id
                        ? "bg-white/[0.14] text-white shadow-sm"
                        : "text-white/50 hover:text-white/80"
                    } disabled:opacity-50`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] leading-relaxed text-white/38">
                Narration is <span className="text-white/55">synthetic speech</span> (OpenAI TTS) — not voice cloning
                or a human recording. Music-only removes VO while keeping the score bed.
              </p>
            </div>

            <div className="space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                Base format
              </span>
              <div className="flex rounded-xl border border-white/[0.12] bg-black/25 p-1">
                {(
                  [
                    { id: "cinematic" as const, label: "Polished" },
                    { id: "ugc_social" as const, label: "Native social" },
                  ] as const
                ).map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={job.state.loading}
                    onClick={() => setCreativeMode(opt.id)}
                    className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                      creativeMode === opt.id
                        ? "bg-white/[0.14] text-white shadow-sm"
                        : "text-white/50 hover:text-white/80"
                    } disabled:opacity-50`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-white/38">
                Default commercial vs short-form feel when the preset allows.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <select
              value={tone}
              onChange={e => setTone(e.target.value)}
              disabled={job.state.loading}
              className="np-select w-full"
              title="Overall read tone"
            >
              <option value="clean">Clean</option>
              <option value="emotional">Emotional</option>
              <option value="cinematic">Cinematic</option>
              <option value="aggressive">Bold</option>
            </select>

            <select
              value={platform}
              onChange={e => setPlatform(e.target.value)}
              disabled={job.state.loading}
              className="np-select w-full"
            >
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
              <option value="youtube">YouTube</option>
            </select>

            <select
              value={duration}
              onChange={e => setDuration(Number(e.target.value))}
              disabled={job.state.loading}
              className="np-select w-full"
            >
              <option value={15}>15s</option>
              <option value={30}>30s</option>
              <option value={45}>45s</option>
              <option value={60}>60s</option>
            </select>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
            <input
              type="checkbox"
              checked={ultra}
              disabled={job.state.loading}
              onChange={() => setUltra(!ultra)}
              className="rounded border-white/30 bg-white/10"
            />
            <span className="text-sm text-white/75">Higher quality render (recommended)</span>
          </label>

          <details className="group rounded-2xl border border-white/[0.1] bg-white/[0.02] px-5 py-4 open:bg-white/[0.03]">
            <summary className="cursor-pointer list-none text-sm font-medium text-white/70 outline-none marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span>Advanced</span>
                <span className="text-xs font-normal text-white/40">
                  Capture, variants, captions, notes
                </span>
              </span>
            </summary>

            <div className="mt-5 space-y-5 border-t border-white/[0.08] pt-5">
              <label className="block space-y-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                  Operator notes · handoff
                </span>
                <textarea
                  value={operatorBrief}
                  onChange={e => setOperatorBrief(e.target.value)}
                  disabled={job.state.loading}
                  maxLength={4000}
                  rows={3}
                  placeholder="Internal context — saved on the job for review and Story Video handoff."
                  className="w-full resize-y rounded-xl border border-white/[0.12] bg-black/30 px-4 py-3 text-sm text-white placeholder:text-white/35"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                  Capture style
                </span>
                <select
                  value={editingStyle}
                  onChange={e => setEditingStyle(e.target.value)}
                  disabled={job.state.loading}
                  className="np-select w-full"
                >
                  <option value="auto">Smart auto</option>
                  <option value="website">Website demo</option>
                  <option value="desk">Desk setup</option>
                  <option value="aggressive">Fast viral cut</option>
                  <option value="premium">Premium cinematic</option>
                </select>
              </label>

              <label className="block space-y-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                  Variants to render
                </span>
                <select
                  value={renderTopVariants === 2 ? "2" : "1"}
                  onChange={e => setRenderTopVariants(e.target.value === "2" ? 2 : 1)}
                  disabled={job.state.loading}
                  className="np-select w-full"
                >
                  <option value="1">Winner only</option>
                  <option value="2">Winner + runner-up (compare)</option>
                </select>
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
                <input
                  type="checkbox"
                  checked={fastPreviewGenerate}
                  disabled={job.state.loading}
                  onChange={() => setFastPreviewGenerate(v => !v)}
                  className="mt-1 rounded border-amber-400/40"
                />
                <span className="text-sm">
                  <span className="font-medium text-amber-100/95">Fast preview</span>
                  <span className="mt-0.5 block text-xs font-normal text-white/55">
                    Lighter capture and encodes for iteration. Labeled in review.
                    {ultra && fastPreviewGenerate ? (
                      <span className="mt-1 block text-amber-200/75">
                        Ultra has limited effect while this is on.
                      </span>
                    ) : null}
                  </span>
                </span>
              </label>

              <div className="space-y-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                  Caption packaging override
                </span>
                <PackagingPresetPicker
                  value={videoPackaging}
                  onChange={setVideoPackaging}
                  disabled={job.state.loading}
                  presets={VIDEO_PACKAGING_PRESETS}
                />
              </div>

              <label className="block space-y-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                  Caption accent (hex, optional)
                </span>
                <input
                  type="text"
                  value={captionAccentHex}
                  onChange={e =>
                    setCaptionAccentHex(e.target.value.replace(/[^0-9A-Fa-f]/g, "").slice(0, 6))
                  }
                  disabled={job.state.loading}
                  placeholder="RRGGBB"
                  maxLength={6}
                  className="w-full rounded-xl border border-white/[0.12] bg-black/30 px-4 py-3 font-mono text-sm placeholder:text-white/35"
                />
                {captionAccentHex.length === 6 && /^[0-9A-Fa-f]{6}$/.test(captionAccentHex) ? (
                  <div className="flex items-center gap-2.5 pt-1">
                    <span
                      className="h-8 w-8 shrink-0 rounded-full border border-white/15 shadow-inner"
                      style={{ backgroundColor: `#${captionAccentHex}` }}
                      aria-hidden
                    />
                    <span className="text-[11px] leading-relaxed text-white/42">
                      Streamer-style presets use this accent for keyword highlights when the renderer applies accent
                      color.
                    </span>
                  </div>
                ) : (
                  <p className="text-[11px] leading-relaxed text-white/38">
                    Six hex characters, no #. Leave blank for renderer default contrast.
                  </p>
                )}
              </label>
            </div>
          </details>
        </div>

        <button
          onClick={generateAd}
          disabled={job.state.loading}
          className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 py-4 text-lg font-semibold disabled:opacity-60"
        >
          {job.state.loading ? "Generating…" : "Generate"}
        </button>
        {job.state.loading && (
          <button
            type="button"
            onClick={() => void job.cancel()}
            className="w-full rounded-xl border border-white/15 bg-white/5 py-2 text-xs text-white/70 hover:bg-white/10"
          >
            Cancel
          </button>
        )}
        {(job.state.jobId || job.state.requestId) && (
          <p className="text-xs text-white/45">
            {job.state.jobId ? `Job ID: ${job.state.jobId}` : ""}
            {job.state.requestId
              ? `${job.state.jobId ? " · " : ""}Request ID: ${job.state.requestId}`
              : ""}
          </p>
        )}

        {job.state.loading && (
          <div className="mt-2">
            <div className="h-3 w-full rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                style={{ width: `${job.state.progress}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-white/60">
              {job.state.stageText} · {job.state.progress}% · ETA {eta()}
            </p>
            {!fastPreviewGenerate && job.state.progress >= 41 && job.state.progress < 57 && (
              <p className="mt-2 text-xs text-amber-200/75">
                Recording the site in a real browser — progress can move in small steps. For quicker iteration,
                enable <span className="font-medium text-amber-100/90">Fast preview</span> under Advanced.
              </p>
            )}
          </div>
        )}

        {job.state.error && (
          <div className="rounded-xl border border-red-500/25 bg-red-500/[0.08] px-4 py-3">
            <p className="text-sm text-red-200/95">{job.state.error}</p>
            <button
              type="button"
              onClick={() => job.setError(null)}
              className="mt-2 text-xs font-medium text-white/55 underline decoration-white/30 hover:text-white/80"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      <div className="mx-auto mt-16 max-w-5xl space-y-10">
        <AdsAdminJobsList
          refreshKey={adJobsListTick}
          currentJobId={job.state.jobId}
          onOpenJob={openJobById}
        />

        {job.state.jobId &&
          (job.state.loading || job.state.jobRecord || job.state.videoUrl) && (
            <AdsJobReviewPanel
              key={job.state.jobId}
              jobId={job.state.jobId}
              jobRecord={job.state.jobRecord}
              videoUrl={job.state.videoUrl}
              normalizeOutputUrl={normalizeOutputUrl}
              loading={job.state.loading}
              onOpenJob={openJobById}
              onOperatorReviewChange={() => {
                if (job.state.jobId) void job.loadJobForReview(job.state.jobId)
                setAdJobsListTick(t => t + 1)
              }}
            />
          )}
      </div>
    </div>
  )
}
