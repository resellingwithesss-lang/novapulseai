"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import ToolPageShell from "@/components/tools/ToolPageShell"
import ToolResultLayout from "@/components/tools/results/ToolResultLayout"
import UserAdVideoOutput from "@/components/ai-ad-generator/UserAdVideoOutput"
import UserAdCtaSuggestions from "@/components/ai-ad-generator/UserAdCtaSuggestions"
import AdVariantIntelligencePanel from "@/components/ad-studio/AdVariantIntelligencePanel"
import { api, ApiError, LONG_REQUEST_TIMEOUT_MS } from "@/lib/api"
import { formatAdsErrorForUserDisplay } from "@/lib/ads-user-messages"
import { formatBlockedReason, useEntitlementSnapshot } from "@/hooks/useEntitlementSnapshot"
import { normalizeToolOperation } from "@/lib/tool-operation"
import { useAdsJobPolling } from "@/hooks/useAdsJobPolling"
import { incrementToolUsage, pushOutputHistory, recordEmailReadyEvent } from "@/lib/growth"
import UpgradeModal from "@/components/growth/UpgradeModal"
import { toAbsoluteMediaUrl } from "@/lib/mediaOrigin"
import { useAuth } from "@/context/AuthContext"
import { tools } from "@/config/tools"

type GenerateResponse = {
  success: boolean
  jobId?: string
  requestId?: string
  message?: string
}

const STYLE_PRESETS = [
  {
    id: "polished",
    label: "Polished & cinematic",
    description: "Premium brand spot — smooth pacing and confident VO.",
    tone: "cinematic" as const,
    editingStyle: "premium" as const,
    creativeMode: "cinematic" as const,
  },
  {
    id: "bold",
    label: "Bold & direct",
    description: "High-energy cuts that feel native to short-form feeds.",
    tone: "aggressive" as const,
    editingStyle: "aggressive" as const,
    creativeMode: "ugc_social" as const,
  },
  {
    id: "minimal",
    label: "Clean & minimal",
    description: "Clear message, lots of breathing room, modern typography.",
    tone: "clean" as const,
    editingStyle: "auto" as const,
    creativeMode: "cinematic" as const,
  },
  {
    id: "warm",
    label: "Warm & story-driven",
    description: "Emotional hook with a human, trustworthy tone.",
    tone: "emotional" as const,
    editingStyle: "premium" as const,
    creativeMode: "cinematic" as const,
  },
  {
    id: "walkthrough",
    label: "Product page walkthrough",
    description: "Lets the landing page carry the story — great for SaaS and ecommerce.",
    tone: "clean" as const,
    editingStyle: "website" as const,
    creativeMode: "cinematic" as const,
  },
]

/** Canonical AI Ad Generator — `/dashboard/tools/ai-ad-generator` */
export default function AiAdGeneratorPage() {
  const searchParams = useSearchParams()
  const { entitlement } = useEntitlementSnapshot()
  const { isAdmin } = useAuth()

  const [siteUrl, setSiteUrl] = useState("")
  const [stylePresetId, setStylePresetId] = useState(STYLE_PRESETS[0].id)
  const [duration, setDuration] = useState(30)
  const [platform, setPlatform] = useState("tiktok")
  const [audienceNotes, setAudienceNotes] = useState("")
  const [repeatUsageCount, setRepeatUsageCount] = useState(0)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [workspaceId, setWorkspaceId] = useState("")
  const [sourceContentPackId, setSourceContentPackId] = useState("")
  const [sourceGenerationId, setSourceGenerationId] = useState("")
  const [sourceType, setSourceType] = useState<"" | "CONTENT_PACK" | "GENERATION" | "MANUAL">("")

  const videoOutputRef = useRef<HTMLDivElement | null>(null)
  const eliteAds = Boolean(entitlement?.featureAccess.ads.allowed)
  const renderVariantCount = useMemo(() => {
    if (!entitlement) return 1
    return Math.min(2, Math.max(1, entitlement.adVariantCount || 1))
  }, [entitlement])

  const activePreset = useMemo(
    () => STYLE_PRESETS.find((p) => p.id === stylePresetId) ?? STYLE_PRESETS[0],
    [stylePresetId]
  )

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
    if (vb) setAudienceNotes(vb)
    else if (topic) {
      setAudienceNotes(contextId ? `${topic}\n\nContext: ${contextId}` : topic)
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
    if (p < 32) return "Understanding your product page…"
    if (p < 58) return "Writing the script and voiceover…"
    return "Assembling your finished ad…"
  }

  const eta = () => {
    if (duration <= 15) return "about 1–3 minutes"
    if (duration <= 30) return "about 2–5 minutes"
    if (duration <= 45) return "about 3–7 minutes"
    return "about 4–10 minutes"
  }

  const adsToolMeta = tools.find((t) => t.id === "story-video-maker")

  const polling = useAdsJobPolling({
    // Keep legacy key so in-flight jobs survive the /story-video-maker → /ai-ad-generator rename.
    storageKey: "vf:story-video-maker:job",
    normalizeOutputUrl: (url) => toAbsoluteMediaUrl(url),
    stageFromProgress,
    cancelPath: (jobId) => `/ads/${jobId}/cancel`,
    audience: "creator",
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
      new URL(normalizedUrl)
    } catch {
      polling.setError("Enter a valid link, e.g. https://yourbrand.com/product")
      return
    }

    try {
      polling.resetForNewRun()
      polling.clearOutput()

      const response = await api.post<GenerateResponse>(
        "/ads/generate",
        {
          siteUrl: normalizedUrl,
          tone: activePreset.tone,
          duration,
          platform,
          editingStyle: activePreset.editingStyle,
          ultra: true,
          creativeMode: activePreset.creativeMode,
          renderTopVariants: renderVariantCount,
          voice: "alloy",
          voiceMode: "ai_openai_tts",
          ...(audienceNotes.trim()
            ? { operatorBrief: audienceNotes.trim().slice(0, 4000) }
            : {}),
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
      if (apiError.status === 403) {
        setShowUpgradeModal(true)
      }
      const raw = apiError.message || "Failed to start generation"
      polling.setError(formatAdsErrorForUserDisplay(raw) ?? "We couldn't start your ad. Please try again.")
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

  const errorDisplay = polling.state.error
    ? formatAdsErrorForUserDisplay(polling.state.error) ?? polling.state.error
    : null

  return (
    <ToolPageShell
      toolId="story-video-maker"
      title="AI Ad Generator"
      outcome={adsToolMeta?.outcome}
      subtitle="Paste a URL + optional notes — we return your best ad, extra variants (by plan), and CTA ideas. No filming or timeline work."
      guidance="Strong pages (clear headline, proof, CTA) produce stronger ads. Defaults work; open Fine-tune only if you want a different length or platform."
      statusLabel={
        blockedMessage ??
        (polling.state.loading ? "Creating your ad" : "Ready — one tap to generate")
      }
      statusTone={blockedMessage || polling.state.loading ? "warning" : "success"}
      ctaHref="/dashboard"
      ctaLabel="Back to dashboard"
    >
      <div
        id="ad-studio-input"
        className="rounded-2xl border border-white/10 bg-[#111827] p-7 shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
      >
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
            <li className={workflowStep === 1 ? "text-violet-200/95" : ""}>① Brief</li>
            <span aria-hidden className="text-white/20">
              →
            </span>
            <li className={workflowStep === 2 ? "text-violet-200/95" : ""}>② AI builds</li>
            <span aria-hidden className="text-white/20">
              →
            </span>
            <li className={workflowStep === 3 ? "text-violet-200/95" : ""}>③ Your ad</li>
          </ol>
          {isAdmin ? (
            <Link
              href="/admin/ads"
              className="text-xs font-medium text-violet-200/90 underline-offset-4 hover:text-white hover:underline"
            >
              Team: open AI Ads Operator Console →
            </Link>
          ) : null}
        </div>

        <div className="mb-6 rounded-xl border border-white/[0.07] bg-gradient-to-br from-violet-500/[0.08] to-transparent p-5">
          <h2 className="text-base font-semibold text-white/[0.96]">What you need</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-white/55">
            A public product or landing page URL. Optional notes help the AI emphasize the right offer,
            audience, or promo — you stay behind the camera.
          </p>
        </div>

        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-white/60">
              Product or landing page URL
            </label>
            <input
              type="text"
              placeholder="https://your-site.com/your-product"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              disabled={polling.state.loading}
              className="np-select w-full"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-white/60">
              Goal, audience, or product details{" "}
              <span className="font-normal normal-case text-white/38">(optional)</span>
            </label>
            <textarea
              value={audienceNotes}
              onChange={(e) => setAudienceNotes(e.target.value)}
              disabled={polling.state.loading}
              rows={3}
              placeholder="e.g. 20% off first order, busy parents 25–40, lead with trust and speed…"
              className="np-select w-full resize-y text-sm leading-relaxed"
            />
          </div>

          <details className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <summary className="cursor-pointer list-none text-sm font-semibold text-white/85 [&::-webkit-details-marker]:hidden">
              Fine-tune look &amp; length{" "}
              <span className="text-xs font-normal text-white/40">(optional)</span>
            </summary>
            <div className="mt-4 space-y-5">
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-white/60">
                    Platform
                  </label>
                  <select
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                    disabled={polling.state.loading}
                    className="np-select w-full"
                  >
                    <option value="tiktok">TikTok · vertical 9:16</option>
                    <option value="instagram">Instagram · square 1:1</option>
                    <option value="youtube">YouTube · horizontal 16:9</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-white/60">
                    Length
                  </label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    disabled={polling.state.loading}
                    className="np-select w-full"
                  >
                    <option value={15}>15 seconds · snappy</option>
                    <option value={30}>30 seconds · balanced</option>
                    <option value={45}>45 seconds · more story</option>
                    <option value={60}>60 seconds · deeper pitch</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-white/60">
                  Style &amp; tone
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {STYLE_PRESETS.map((p) => {
                    const active = stylePresetId === p.id
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={polling.state.loading}
                        onClick={() => setStylePresetId(p.id)}
                        className={`rounded-xl border px-4 py-3 text-left transition disabled:opacity-50 ${
                          active
                            ? "border-violet-400/45 bg-violet-500/[0.15] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                            : "border-white/[0.1] bg-white/[0.03] hover:border-white/[0.18]"
                        }`}
                      >
                        <span className="block text-sm font-semibold text-white/90">{p.label}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-white/45">
                          {p.description}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </details>
        </div>

        {eliteAds && entitlement && entitlement.adVariantCount < 2 ? (
          <p className="mt-4 text-center text-xs text-amber-200/90">
            Unlock more high-performing variants with Pro/Elite — your current tier includes one hero render per run.
          </p>
        ) : null}

        <button
          type="button"
          onClick={generate}
          disabled={!canGenerate}
          className="mt-8 w-full rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-purple-900/30 disabled:opacity-50"
        >
          {polling.state.loading ? "Creating your ad…" : "Generate my ad"}
        </button>
        {polling.state.loading ? (
          <button
            type="button"
            onClick={() => void polling.cancel()}
            className="mt-2 w-full rounded-xl border border-white/15 bg-white/5 py-2 text-xs text-white/70 hover:bg-white/10"
          >
            Stop this run
          </button>
        ) : null}

        {polling.state.loading ? (
          <div className="mt-5">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-2.5 bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                style={{ width: `${polling.state.progress}%` }}
              />
            </div>
            <p className="mt-3 text-sm font-medium text-white/85">{polling.state.stageText}</p>
            <p className="mt-1 text-xs leading-relaxed text-white/45">
              This usually takes {eta()}. You can leave this tab open — we save your run so you can retry
              if anything interrupts.
            </p>
          </div>
        ) : null}

        {errorDisplay ? (
          <div className="mt-5 rounded-xl border border-red-500/25 bg-red-500/[0.07] px-4 py-3 text-sm leading-relaxed text-red-100/95 whitespace-pre-line">
            {errorDisplay}
          </div>
        ) : null}

        {repeatUsageCount >= 3 ? (
          <p className="mt-4 text-sm text-violet-200/90">
            You&apos;re on a roll — Elite is built for steady AI ad output and testing.
          </p>
        ) : null}
      </div>

      {polling.state.videoUrl ? (
        <div ref={videoOutputRef} className="mt-10 space-y-2">
          <UserAdVideoOutput
            videoUrl={polling.state.videoUrl}
            platform={platform}
            extraActions={[
              {
                label: "Create another ad",
                tone: "secondary",
                onClick: () =>
                  document
                    .getElementById("ad-studio-input")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" }),
              },
            ]}
          />
          <UserAdCtaSuggestions jobRecord={polling.state.jobRecord} />
          <AdVariantIntelligencePanel
            jobRecord={polling.state.jobRecord}
            eliteAccess={eliteAds}
            audience="creator"
            onUseVariant={() =>
              videoOutputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          />
          {!eliteAds ? (
            <p className="text-center text-xs text-violet-200/85">
              Want more scored angles and dual renders per run?{" "}
              <Link href="/dashboard/billing" className="font-medium text-white underline-offset-2 hover:underline">
                Elite unlocks the full AI ad pipeline
              </Link>
              .
            </p>
          ) : null}
        </div>
      ) : null}

      {!polling.state.videoUrl ? (
        <ToolResultLayout
          title="Your AI ad"
          state={polling.state.loading ? "loading" : polling.state.error ? "error" : "empty"}
          statusLabel={
            polling.state.loading ? "Working" : polling.state.error ? "Needs attention" : "Waiting"
          }
          loadingMessage={`${polling.state.stageText} — thanks for your patience.`}
          errorMessage={errorDisplay ?? undefined}
          emptyMessage="No ad yet. Add your product link, pick a platform and style, then generate — the AI handles script, VO, edit, and captions."
          actions={
            polling.state.error
              ? [{ label: "Try again", onClick: generate }]
              : []
          }
          recoveryActions={
            polling.state.error
              ? [
                  {
                    label: "Clear saved progress",
                    onClick: () => {
                      polling.clearPersisted()
                      polling.setError(null)
                    },
                  },
                ]
              : []
          }
          nextSteps={[
            { label: "Video scripts", href: "/dashboard/tools/video" },
            { label: "Clip repurposing", href: "/dashboard/tools/clipper" },
            { label: "Plan & billing", href: "/dashboard/billing" },
          ]}
        />
      ) : null}

      <UpgradeModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        message="AI Ad Generator is included on Elite — unlock automatic video ads with voiceover from any product page."
        currentPlan={entitlement?.normalizedPlan}
        requiredPlan={entitlement?.featureAccess.ads.minimumPlan ?? "ELITE"}
        benefits={[
          "Full AI video ads — no recording or timeline editing",
          "Platform-ready aspect ratios and download",
          "Built for ongoing testing and fresh creative",
        ]}
      />
    </ToolPageShell>
  )
}
