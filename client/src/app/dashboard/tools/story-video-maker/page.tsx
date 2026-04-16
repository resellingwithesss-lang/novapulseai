"use client"

import dynamic from "next/dynamic"
import { useEffect, useMemo, useState } from "react"
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
  const [repeatUsageCount, setRepeatUsageCount] = useState(0)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [workspaceId, setWorkspaceId] = useState("")
  const [videoBrief, setVideoBrief] = useState("")
  const [sourceContentPackId, setSourceContentPackId] = useState("")
  const [sourceGenerationId, setSourceGenerationId] = useState("")
  const [sourceType, setSourceType] = useState<
    "" | "CONTENT_PACK" | "GENERATION" | "MANUAL"
  >("")

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
    if (p < 41) return "Generating voiceover..."
    if (p < 52) return "Capturing site (browser — often the longest step)..."
    if (p < 57) return "Building cinematic timeline (encode)..."
    if (p < 71) return "Color grading & audio mix..."
    if (p < 100) return "Final video render..."
    return "Completed"
  }

  const polling = useAdsJobPolling({
    storageKey: "vf:story-video-maker:job",
    normalizeOutputUrl: (url) => toAbsoluteMediaUrl(url),
    stageFromProgress,
    cancelPath: (jobId) => `/ads/${jobId}/cancel`,
  })

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
      title: "Story video generated",
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
      title="Story Video Generator"
      subtitle="Generate platform-ready ad videos from your website in one guided flow."
      guidance="Best results come from pages with clear headline, offer, and CTA sections."
      statusLabel={blockedMessage ?? (polling.state.loading ? "Rendering in progress" : "Ready to generate")}
      statusTone={blockedMessage || polling.state.loading ? "warning" : "success"}
      ctaHref="/dashboard/tools/story-maker"
      ctaLabel="Open Story Maker"
    >
      <div className="rounded-2xl border border-white/10 bg-[#111827] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
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
            <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">Website URL</label>
            <input
              type="text"
              placeholder="https://your-site.com"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              disabled={polling.state.loading}
              className="w-full rounded-lg border border-white/15 bg-black/30 p-3"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">Tone</label>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              disabled={polling.state.loading}
              className="w-full rounded-lg border border-white/15 bg-black/30 p-3"
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
              className="w-full rounded-lg border border-white/15 bg-black/30 p-3"
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
              className="w-full rounded-lg border border-white/15 bg-black/30 p-3"
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
              className="w-full rounded-lg border border-white/15 bg-black/30 p-3"
            >
              <option value="premium">Premium</option>
              <option value="auto">Auto</option>
              <option value="website">Website Demo</option>
              <option value="desk">Desk Setup</option>
              <option value="aggressive">Viral Fast</option>
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
          Enable ultra quality render
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
              className="w-full rounded-lg border border-white/15 bg-black/30 p-3"
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
              className="w-full rounded-lg border border-white/15 bg-black/30 p-3"
            >
              <option value={1}>Top 1 variant</option>
              <option value={2}>Top 2 variants (compare)</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
              Voice
            </label>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value as AdsVoice)}
              disabled={polling.state.loading}
              className="w-full rounded-lg border border-white/15 bg-black/30 p-3"
            >
              <option value="alloy">Alloy</option>
              <option value="ash">Ash</option>
              <option value="ballad">Ballad</option>
              <option value="coral">Coral</option>
              <option value="echo">Echo</option>
              <option value="sage">Sage</option>
              <option value="shimmer">Shimmer</option>
              <option value="verse">Verse</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={generate}
          disabled={!canGenerate}
          className="mt-6 w-full rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 py-3.5 text-sm font-semibold disabled:opacity-50"
        >
          {polling.state.loading ? "Generating video..." : "Generate Story Video"}
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
            <p className="mt-2 text-sm text-white/65">{polling.state.stageText} ({polling.state.progress}%)</p>
          </div>
        )}
        {polling.state.error && <p className="mt-4 text-sm text-red-400">{polling.state.error}</p>}
        {repeatUsageCount >= 3 && (
          <p className="mt-3 text-sm text-purple-200">
            Heavy Story Video usage detected. Elite is optimized for maximum output and automation loops.
          </p>
        )}
      </div>

      {polling.state.videoUrl && <AdsResultPanel videoUrl={polling.state.videoUrl} />}
      {!polling.state.videoUrl && (
        <ToolResultLayout
          title="Story Video Output"
          state={polling.state.loading ? "loading" : polling.state.error ? "error" : "empty"}
          statusLabel={polling.state.loading ? "Rendering" : polling.state.error ? "Blocked" : "Waiting"}
          loadingMessage={`${polling.state.stageText} (${polling.state.progress}%)`}
          errorMessage={polling.state.error ?? undefined}
          emptyMessage="No video generated yet. Submit a website URL and packaging settings to start."
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
            { label: "Generate Script", href: "/dashboard/tools/video" },
            { label: "Open Clipper", href: "/dashboard/tools/clipper" },
            { label: "Open Billing", href: "/dashboard/billing" },
          ]}
        />
      )}
      <UpgradeModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        message="You’ve reached a plan limit for this workflow."
        currentPlan={entitlement?.normalizedPlan}
        requiredPlan={entitlement?.featureAccess.ads.minimumPlan ?? "ELITE"}
        benefits={[
          "Full script-to-video automation",
          "Elite-only production workflows",
          "Higher monthly output capacity",
        ]}
      />
    </ToolPageShell>
  )
}