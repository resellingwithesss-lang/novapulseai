"use client"

import dynamic from "next/dynamic"
import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import ToolPageShell from "@/components/tools/ToolPageShell"
import ToolResultLayout from "@/components/tools/results/ToolResultLayout"
import { api, ApiError, LONG_REQUEST_TIMEOUT_MS } from "@/lib/api"
import { formatBlockedReason, useEntitlementSnapshot } from "@/hooks/useEntitlementSnapshot"
import { normalizeToolOperation } from "@/lib/tool-operation"
import { useAdsJobPolling } from "@/hooks/useAdsJobPolling"
import { incrementToolUsage, pushOutputHistory, recordEmailReadyEvent } from "@/lib/growth"
import UpgradeModal from "@/components/growth/UpgradeModal"
import { toAbsoluteMediaUrl } from "@/lib/mediaOrigin"
import CreatorWorkflowSelectors from "@/components/workflow/CreatorWorkflowSelectors"
import PackagingPresetPicker from "@/components/ad-studio/PackagingPresetPicker"
import {
  ADS_TTS_VOICE_OPTIONS,
  STUDIO_CREATIVE_MODE_OPTIONS,
  STUDIO_QUICK_PICK_MODE_IDS,
  VIDEO_PACKAGING_PRESETS,
} from "@/lib/ad-studio-presets"
import AdVariantIntelligencePanel from "@/components/ad-studio/AdVariantIntelligencePanel"

const AdsResultPanel = dynamic(
  () => import("@/app/admin/ads/_components/AdsResultPanel"),
  {
    loading: () => (
      <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/60">
        Loading video result...
      </div>
    ),
  }
)

type GenerateResponse = {
  success: boolean
  jobId?: string
  requestId?: string
  message?: string
}

type AdsVoice =
  | "alloy"
  | "ash"
  | "ballad"
  | "coral"
  | "echo"
  | "sage"
  | "shimmer"
  | "verse"

export default function StoryVideoMakerPage() {
  const searchParams = useSearchParams()
  const { entitlement } = useEntitlementSnapshot()

  const [siteUrl, setSiteUrl] = useState("")
  const [tone, setTone] = useState("cinematic")
  const [duration, setDuration] = useState(30)
  const [platform, setPlatform] = useState("tiktok")
  const [editingStyle, setEditingStyle] = useState("premium")
  const [ultra, setUltra] = useState(true)
  const [creativeMode, setCreativeMode] = useState<"cinematic" | "ugc_social">(
    "cinematic"
  )
  const [renderTopVariants, setRenderTopVariants] = useState<1 | 2>(1)
  const [voice, setVoice] = useState<AdsVoice>("alloy")
  const [voiceMode, setVoiceMode] = useState<"ai_openai_tts" | "silent_music_only">("ai_openai_tts")
  const [studioCreativeMode, setStudioCreativeMode] = useState("")
  const [videoPackaging, setVideoPackaging] = useState("")
  const [captionAccentHex, setCaptionAccentHex] = useState("")
  const [repeatUsageCount, setRepeatUsageCount] = useState(0)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [workspaceId, setWorkspaceId] = useState("")
  const [videoBrief, setVideoBrief] = useState("")
  const [sourceContentPackId, setSourceContentPackId] = useState("")
  const [sourceGenerationId, setSourceGenerationId] = useState("")
  const [sourceType, setSourceType] = useState<
    "" | "CONTENT_PACK" | "GENERATION" | "MANUAL"
  >("")

  /** AI Video Ad = default hero layout; Script focus = variants + copy first, video in disclosure. */
  const [adType, setAdType] = useState<"ai_video" | "script_only">("ai_video")
  const videoOutputRef = useRef<HTMLDivElement | null>(null)
  const eliteAds = Boolean(entitlement?.featureAccess.ads.allowed)

  useEffect(() => {
    const u = searchParams.get("siteUrl")
    if (u?.trim()) {
      let normalized = u.trim()
      if (!/^https?:\/\//i.test(normalized)) {
        normalized = `https://${normalized}`
      }
      try {
        new URL(normalized)
        setSiteUrl(normalized)
      } catch {
        setSiteUrl(u.trim())
      }
    }
    const w = searchParams.get("workspaceId")
    if (w) setWorkspaceId(w)
    const vb = searchParams.get("videoBrief")
    const topic = searchParams.get("topic")
    const contextId = searchParams.get("contextId")
    if (vb) setVideoBrief(vb)
    else if (topic) {
      setVideoBrief(contextId ? `${topic}\n\nContext: ${contextId}` : topic)
    }
    const platformParam = searchParams.get("platform")
    if (platformParam === "tiktok" || platformParam === "instagram" || platformParam === "youtube") {
      setPlatform(platformParam)
    }
    const p = searchParams.get("sourceContentPackId")
    if (p) setSourceContentPackId(p)
    const g = searchParams.get("sourceGenerationId")
    if (g) setSourceGenerationId(g)
    const st = searchParams.get("sourceType")
    if (st === "CONTENT_PACK" || st === "GENERATION" || st === "MANUAL") {
      setSourceType(st)
    }
  }, [searchParams])

  const blockedMessage = useMemo(() => {
    if (!entitlement) return null
    return formatBlockedReason(
      entitlement.featureAccess.ads.blockedReason,
      entitlement.featureAccess.ads.minimumPlan
    )
  }, [entitlement])

  const stageFromProgress = (p: number) => {
    if (p < 18) return "Analyzing website structure..."
    if (p < 30) return "Building ad script and scenes..."
    if (p < 41) return "Preparing audio & timing..."
    if (p < 52) return "Capturing site (browser — often the longest step)..."
    if (p < 57) return "Building cinematic timeline (encode)..."
    if (p < 71) return "Color grading & audio mix..."
    if (p < 100) return "Final video render..."
    return "Completed"
  }

  const friendlyStageFromProgress = (p: number) => {
    if (p < 35) return "Writing your ad script…"
    if (p < 55) return "Generating AI voiceover…"
    return "Assembling your video ad…"
  }

  const polling = useAdsJobPolling({
    storageKey: "vf:story-video-maker:job",
    normalizeOutputUrl: (url) => toAbsoluteMediaUrl(url),
    stageFromProgress,
    cancelPath: (jobId) => `/ads/${jobId}/cancel`,
  })

  const workflowStep = useMemo(() => {
    if (polling.state.videoUrl) return 3 as const
    if (polling.state.loading) return 2 as const
    return 1 as const
  }, [polling.state.loading, polling.state.videoUrl])

  const canGenerate = !polling.state.loading && !blockedMessage

  const generate = async () => {
    if (!canGenerate) {
      setShowUpgradeModal(true)
      return
    }

    let normalizedUrl = siteUrl.trim()
    if (normalizedUrl && !/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`
    }
    try {
      // Validate URL format client-side for immediate UX feedback.
      new URL(normalizedUrl)
    } catch {
      polling.setError("Enter a valid website URL, e.g. https://example.com")
      return
    }

    try {
      polling.resetForNewRun()
      polling.clearOutput()

      const accent = captionAccentHex.trim()
      const response = await api.post<GenerateResponse>(
        "/ads/generate",
        {
          siteUrl: normalizedUrl,
          tone,
          duration,
          platform,
          editingStyle,
          ultra,
          creativeMode,
          renderTopVariants,
          voice,
          voiceMode,
          ...(studioCreativeMode.trim() ? { studioCreativeMode: studioCreativeMode.trim() } : {}),
          ...(videoPackaging.trim() ? { videoPackaging: videoPackaging.trim() } : {}),
          ...(accent && /^[0-9A-Fa-f]{6}$/.test(accent) ? { captionAccentHex: accent } : {}),
          ...(workspaceId ? { workspaceId } : {}),
          ...(sourceContentPackId ? { sourceContentPackId } : {}),
          ...(sourceGenerationId ? { sourceGenerationId } : {}),
          ...(sourceType ? { sourceType } : {}),
        },
        {
          timeout: LONG_REQUEST_TIMEOUT_MS,
          retry: 0,
          idempotencyKey: `ads-generate:${crypto.randomUUID()}`,
        }
      )
      const operation = normalizeToolOperation(response)

      if (!operation.success || !operation.jobId) {
        throw new Error(operation.message || "Invalid generation response")
      }

      polling.begin(operation.jobId, operation.requestId)
    } catch (err) {
      const apiError = err as ApiError
      const requestHint = apiError.requestId ? ` Request ID: ${apiError.requestId}` : ""
      if (apiError.status === 403) {
        setShowUpgradeModal(true)
      }
      polling.setError(
        `${apiError.message || "Failed to start generation"}${requestHint}`
      )
    }
  }

  useEffect(() => {
    void polling.resume()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!polling.state.videoUrl) return
    const usageCount = incrementToolUsage("story-video-maker")
    setRepeatUsageCount(usageCount)
    pushOutputHistory({
      tool: "story-video-maker",
      title: "AI video ad generated",
      summary: polling.state.videoUrl,
      continuePath: "/dashboard/tools/clipper",
      nextAction: "Extract clips from this output for repurposing.",
    })
    recordEmailReadyEvent("OUTPUT_CREATED", `output:story-video-maker:${Date.now()}`, {
      tool: "story-video-maker",
      jobId: polling.state.jobId,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling.state.videoUrl])

  return (
    <ToolPageShell
      toolId="story-video-maker"
      title="AI Ad Generator"
      subtitle="AI creates high-performing video ads for you — script, voiceover, on-screen visuals, and subtitles from a product URL. No filming or manual editing required."
      guidance="Use a tight offer page: headline, proof, and CTA above the fold. Same Elite pipeline for both modes below — Script focus just surfaces angles and copy before the video."
      statusLabel={
        blockedMessage ??
        (polling.state.loading ? "Generating your ad" : "Ready — press to generate")
      }
      statusTone={blockedMessage || polling.state.loading ? "warning" : "success"}
      ctaHref="/dashboard"
      ctaLabel="Back to dashboard"
    >
      <div
        id="ad-studio-input"
        className="rounded-2xl border border-white/10 bg-[#111827] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
      >
        <ol className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
          <li className={workflowStep === 1 ? "text-violet-200/95" : ""}>① Input</li>
          <span aria-hidden className="text-white/20">
            →
          </span>
          <li className={workflowStep === 2 ? "text-violet-200/95" : ""}>② Generating</li>
          <span aria-hidden className="text-white/20">
            →
          </span>
          <li className={workflowStep === 3 ? "text-violet-200/95" : ""}>③ Output</li>
        </ol>

        <div className="mb-6 rounded-xl border border-white/[0.07] bg-black/20 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/55">Ad type</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={polling.state.loading}
              onClick={() => setAdType("ai_video")}
              className={`rounded-full border px-4 py-2 text-xs font-semibold transition disabled:opacity-50 ${
                adType === "ai_video"
                  ? "border-violet-400/45 bg-violet-500/20 text-white"
                  : "border-white/12 bg-white/[0.04] text-white/60 hover:border-white/20"
              }`}
            >
              AI Video Ad
            </button>
            <button
              type="button"
              disabled={polling.state.loading}
              onClick={() => setAdType("script_only")}
              className={`rounded-full border px-4 py-2 text-xs font-semibold transition disabled:opacity-50 ${
                adType === "script_only"
                  ? "border-violet-400/45 bg-violet-500/20 text-white"
                  : "border-white/12 bg-white/[0.04] text-white/60 hover:border-white/20"
              }`}
            >
              Script focus
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-white/42">
            Default <span className="text-white/55">AI Video Ad</span> puts the finished spot first.{" "}
            <span className="text-white/55">Script focus</span> shows scored angles and copy first — the
            same full auto-render is still produced.
          </p>
        </div>

        <div className="mb-5">
          <CreatorWorkflowSelectors
            workspaceOnly
            workspaceId={workspaceId}
            brandVoiceId=""
            onWorkspaceChange={setWorkspaceId}
            onBrandVoiceChange={() => {}}
            disabled={polling.state.loading}
          />
        </div>
        {videoBrief.trim() && (
          <div className="mb-5 rounded-xl border border-violet-500/25 bg-violet-500/10 px-4 py-3 text-sm text-white/80">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-200/90">
              Creative brief (from handoff)
            </p>
            <p className="mt-2 whitespace-pre-wrap text-white/70">{videoBrief}</p>
            <p className="mt-2 text-xs text-white/45">
              Use this as operator guidance while choosing page URL and render settings.
            </p>
          </div>
        )}
        <div className="grid gap-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
              Product page URL
            </label>
            <input
              type="text"
              placeholder="https://your-site.com"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              disabled={polling.state.loading}
              className="np-select w-full"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">Tone</label>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              disabled={polling.state.loading}
              className="np-select w-full"
            >
              <option value="cinematic">Cinematic</option>
              <option value="emotional">Emotional</option>
              <option value="clean">Clean</option>
              <option value="aggressive">Aggressive</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">Platform</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              disabled={polling.state.loading}
              className="np-select w-full"
            >
              <option value="tiktok">TikTok (9:16)</option>
              <option value="instagram">Instagram (1:1)</option>
              <option value="youtube">YouTube (16:9)</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">Duration</label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              disabled={polling.state.loading}
              className="np-select w-full"
            >
              <option value={15}>15 seconds</option>
              <option value={30}>30 seconds</option>
              <option value={45}>45 seconds</option>
              <option value={60}>60 seconds</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">Edit Style</label>
            <select
              value={editingStyle}
              onChange={(e) => setEditingStyle(e.target.value)}
              disabled={polling.state.loading}
              className="np-select w-full"
            >
              <option value="premium">Premium cinematic</option>
              <option value="auto">Smart auto (balanced)</option>
              <option value="website">Website walkthrough</option>
              <option value="desk">Desk / creator setup</option>
              <option value="aggressive">Fast viral cut</option>
            </select>
          </div>
        </div>

        <label className="mt-5 inline-flex items-center gap-3 text-sm text-white/70">
          <input
            type="checkbox"
            checked={ultra}
            disabled={polling.state.loading}
            onChange={() => setUltra((prev) => !prev)}
          />
          Higher-quality encode (recommended when not using admin fast preview)
        </label>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
              Creative mode
            </label>
            <select
              value={creativeMode}
              onChange={(e) =>
                setCreativeMode(e.target.value as "cinematic" | "ugc_social")
              }
              disabled={polling.state.loading}
              className="np-select w-full"
            >
              <option value="cinematic">Cinematic (polished commercial)</option>
              <option value="ugc_social">UGC / native short-form</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
              Renders per run
            </label>
            <select
              value={renderTopVariants}
              onChange={(e) =>
                setRenderTopVariants(Number(e.target.value) as 1 | 2)
              }
              disabled={polling.state.loading}
              className="np-select w-full"
            >
              <option value={1}>Top 1 variant</option>
              <option value={2}>Top 2 variants (compare)</option>
            </select>
            <p className="mt-1.5 text-[11px] leading-relaxed text-white/42">
              Elite can render two top-scored angles in one run for side-by-side tests. More variants and
              scores mean faster creative decisions — core to high-performing AI ads.
            </p>
          </div>
        </div>

        <details className="group mt-5 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 open:bg-white/[0.04]">
          <summary className="cursor-pointer list-none text-sm font-medium text-white/75 outline-none marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
              <span>Look, captions &amp; sound</span>
              <span className="text-xs font-normal text-white/40">Creative preset · packaging · optional accent</span>
            </span>
          </summary>
          <div className="mt-4 space-y-5 border-t border-white/10 pt-4">
            <div>
              <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
                Ad Studio creative preset
              </label>
              <select
                value={studioCreativeMode}
                onChange={(e) => setStudioCreativeMode(e.target.value)}
                disabled={polling.state.loading}
                className="np-select w-full"
              >
                <option value="">Balanced (no preset)</option>
                {STUDIO_CREATIVE_MODE_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs leading-relaxed text-white/45">
                {studioCreativeMode
                  ? STUDIO_CREATIVE_MODE_OPTIONS.find((o) => o.id === studioCreativeMode)?.hint ??
                    "Shapes script beats and default packaging on the server."
                  : "Optional: steers hook energy and default caption packaging when you do not override packaging below."}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {STUDIO_QUICK_PICK_MODE_IDS.map((id) => {
                  const opt = STUDIO_CREATIVE_MODE_OPTIONS.find((o) => o.id === id)
                  if (!opt) return null
                  const active = studioCreativeMode === id
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={polling.state.loading}
                      title={opt.hint}
                      onClick={() => setStudioCreativeMode(active ? "" : id)}
                      className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition disabled:opacity-50 ${
                        active
                          ? "border-purple-400/50 bg-purple-500/20 text-white"
                          : "border-white/12 bg-black/25 text-white/55 hover:border-white/22 hover:text-white/80"
                      }`}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <span className="mb-2 block text-xs uppercase tracking-wide text-white/60">
                Caption packaging
              </span>
              <PackagingPresetPicker
                value={videoPackaging}
                onChange={setVideoPackaging}
                disabled={polling.state.loading}
                presets={VIDEO_PACKAGING_PRESETS}
              />
            </div>

            <label className="block space-y-2">
              <span className="text-xs uppercase tracking-wide text-white/60">Caption accent (optional hex)</span>
              <input
                type="text"
                value={captionAccentHex}
                onChange={(e) =>
                  setCaptionAccentHex(e.target.value.replace(/[^0-9A-Fa-f]/g, "").slice(0, 6))
                }
                disabled={polling.state.loading}
                placeholder="RRGGBB without #"
                maxLength={6}
                className="np-select w-full font-mono text-sm"
              />
              {captionAccentHex.length === 6 && /^[0-9A-Fa-f]{6}$/.test(captionAccentHex) ? (
                <div className="flex items-center gap-2.5">
                  <span
                    className="h-7 w-7 shrink-0 rounded-full border border-white/15"
                    style={{ backgroundColor: `#${captionAccentHex}` }}
                    aria-hidden
                  />
                  <span className="text-[11px] text-white/42">
                    Applied on streamer-style highlights when the renderer uses accent color.
                  </span>
                </div>
              ) : (
                <p className="text-[11px] text-white/38">Leave blank for default contrast from the packaging preset.</p>
              )}
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className="mb-2 block text-xs uppercase tracking-wide text-white/60">Sound</span>
                <div className="flex rounded-xl border border-white/12 bg-black/25 p-1">
                  {(
                    [
                      { id: "ai_openai_tts" as const, label: "Narration" },
                      { id: "silent_music_only" as const, label: "Music only" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={polling.state.loading}
                      onClick={() => setVoiceMode(opt.id)}
                      className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium transition ${
                        voiceMode === opt.id
                          ? "bg-white/15 text-white shadow-sm"
                          : "text-white/50 hover:text-white/78"
                      } disabled:opacity-50`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-white/40">
                  Narration uses OpenAI TTS (synthetic). Music-only skips VO.
                </p>
              </div>
              <div>
                <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
                  TTS voice (narration mode)
                </label>
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value as AdsVoice)}
                  disabled={polling.state.loading || voiceMode !== "ai_openai_tts"}
                  className="np-select w-full"
                >
                  {ADS_TTS_VOICE_OPTIONS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[11px] leading-relaxed text-white/45">
                  {ADS_TTS_VOICE_OPTIONS.find((v) => v.id === voice)?.character}
                </p>
              </div>
            </div>
          </div>
        </details>

        <button
          type="button"
          onClick={generate}
          disabled={!canGenerate}
          className="mt-6 w-full rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 py-3.5 text-sm font-semibold disabled:opacity-50"
        >
          {polling.state.loading ? "Generating your ad…" : "Generate my AI video ad"}
        </button>
        {polling.state.loading && (
          <button
            type="button"
            onClick={() => void polling.cancel()}
            className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 py-2 text-xs text-white/70 hover:bg-white/10"
          >
            Cancel Generation
          </button>
        )}

        {(polling.state.jobId || polling.state.requestId) && (
          <p className="mt-3 text-xs text-white/45">
            {polling.state.jobId ? `Job ID: ${polling.state.jobId}` : ""}
            {polling.state.requestId ? `${polling.state.jobId ? " • " : ""}Request ID: ${polling.state.requestId}` : ""}
          </p>
        )}
        {polling.state.loading && (
          <div className="mt-4">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-2.5 bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                style={{ width: `${polling.state.progress}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-white/80">
              {friendlyStageFromProgress(polling.state.progress)}
            </p>
            <p className="mt-1 text-xs text-white/45">
              {polling.state.stageText} · {polling.state.progress}%
            </p>
          </div>
        )}
        {polling.state.error && <p className="mt-4 text-sm text-red-400">{polling.state.error}</p>}
        {repeatUsageCount >= 3 && (
          <p className="mt-3 text-sm text-purple-200">
            Heavy AI Ad Generator usage — Elite is built for sustained auto-ad output and testing cadence.
          </p>
        )}
      </div>

      {polling.state.videoUrl && (
        <>
          {adType === "script_only" ? (
            <>
              <AdVariantIntelligencePanel
                jobRecord={polling.state.jobRecord}
                eliteAccess={eliteAds}
                onUseVariant={() =>
                  videoOutputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              />
              <details
                className="group mt-8 rounded-2xl border border-white/10 bg-white/[0.03] open:border-white/[0.12]"
                open
              >
                <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-white/85 outline-none marker:content-none [&::-webkit-details-marker]:hidden">
                  Auto-generated video ad (download & share)
                </summary>
                <div
                  ref={videoOutputRef}
                  className="border-t border-white/10 px-4 pb-5 pt-3"
                >
                  <AdsResultPanel
                    videoUrl={polling.state.videoUrl}
                    platform={platform}
                    extraActions={[
                      {
                        label: "Generate more variants",
                        tone: "secondary",
                        onClick: () =>
                          document
                            .getElementById("ad-studio-input")
                            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                      },
                    ]}
                  />
                </div>
              </details>
            </>
          ) : (
            <>
              <div ref={videoOutputRef}>
                <AdsResultPanel
                  videoUrl={polling.state.videoUrl}
                  platform={platform}
                  extraActions={[
                    {
                      label: "Generate more variants",
                      tone: "secondary",
                      onClick: () =>
                        document
                          .getElementById("ad-studio-input")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                    },
                  ]}
                />
              </div>
              <AdVariantIntelligencePanel
                jobRecord={polling.state.jobRecord}
                eliteAccess={eliteAds}
                onUseVariant={() =>
                  videoOutputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              />
            </>
          )}
        </>
      )}
      {!polling.state.videoUrl && (
        <ToolResultLayout
          title="AI ad output"
          state={polling.state.loading ? "loading" : polling.state.error ? "error" : "empty"}
          statusLabel={polling.state.loading ? "Rendering" : polling.state.error ? "Blocked" : "Waiting"}
          loadingMessage={`${friendlyStageFromProgress(polling.state.progress)} · ${polling.state.progress}%`}
          errorMessage={polling.state.error ?? undefined}
          emptyMessage="No AI ad yet. Add your product URL and generate — script, voiceover, edit, and captions are produced automatically."
          actions={
            polling.state.error
              ? [{ label: "Retry Generation", onClick: generate }]
              : []
          }
          recoveryActions={
            polling.state.error
              ? [
                  {
                    label: "Restart Job Flow",
                    onClick: () => {
                      polling.clearPersisted()
                      polling.setError(null)
                    },
                  },
                ]
              : []
          }
          nextSteps={[
            { label: "Supporting scripts", href: "/dashboard/tools/video" },
            { label: "Repurpose clips", href: "/dashboard/tools/clipper" },
            { label: "Billing & plan", href: "/dashboard/billing" },
          ]}
        />
      )}
      <UpgradeModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        message="AI Ad Generator is on Elite — upgrade to unlock auto video ads with voiceover and variants."
        currentPlan={entitlement?.normalizedPlan}
        requiredPlan={entitlement?.featureAccess.ads.minimumPlan ?? "ELITE"}
        benefits={[
          "Full AI video ads — no recording or editing on your side",
          "Scored multi-variant scripts and optional dual renders",
          "Higher monthly output for always-on ad testing",
        ]}
      />
    </ToolPageShell>
  )
}