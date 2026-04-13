"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import { api, ApiError } from "@/lib/api"
import ToolPageShell from "@/components/tools/ToolPageShell"
import { useAuth } from "@/context/AuthContext"
import { normalizePlan } from "@/lib/plans"
import { useEntitlementSnapshot, formatBlockedReason } from "@/hooks/useEntitlementSnapshot"
import { normalizeToolOperation } from "@/lib/tool-operation"
import UpgradeModal from "@/components/growth/UpgradeModal"
import CreatorWorkflowSelectors from "@/components/workflow/CreatorWorkflowSelectors"
import { incrementToolUsage, pushOutputHistory, recordEmailReadyEvent } from "@/lib/growth"

type StoryOutput = {
  title: string
  hook: string
  script: string
  caption: string
  hashtags: string[]
  retentionBreakdown?: {
    hookType: string
    escalationMoments: string
    emotionalSpike: string
    endingMechanism: string
  }
  pinComment?: string
  productionNotes?: string
}

const MAX_CHAR = 600

const StoryMakerResultPanel = dynamic(
  () => import("./_components/StoryMakerResultPanel"),
  {
    loading: () => (
      <div className="mt-14 rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-sm text-white/60">
        Loading generated script...
      </div>
    ),
  }
)

export default function StoryMakerPage() {
  const searchParams = useSearchParams()
  const { user, refreshUser } = useAuth()
  const { entitlement } = useEntitlementSnapshot()
  const [topic, setTopic] = useState("")
  const [format, setFormat] = useState("Reddit Confession")
  const [ending, setEnding] = useState("CLIFFHANGER")
  const [intensity, setIntensity] = useState(8)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [lastFailureRequestId, setLastFailureRequestId] = useState<string | null>(null)
  const [result, setResult] = useState<StoryOutput | null>(null)
  const [repeatUsageCount, setRepeatUsageCount] = useState(0)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [workspaceId, setWorkspaceId] = useState("")
  const [brandVoiceId, setBrandVoiceId] = useState("")
  const [sourceContentPackId, setSourceContentPackId] = useState("")
  const [sourceGenerationId, setSourceGenerationId] = useState("")
  const [sourceType, setSourceType] = useState<
    "" | "CONTENT_PACK" | "GENERATION" | "MANUAL"
  >("")

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const resultRef = useRef<HTMLDivElement | null>(null)

  /* ==============================
     Auto Focus + Auto Resize
  ============================== */
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const handoffTopic = searchParams.get("topic")
    if (handoffTopic && !topic.trim()) {
      const t = handoffTopic.trim()
      setTopic(t.length <= MAX_CHAR ? t : `${t.slice(0, MAX_CHAR - 1).trimEnd()}…`)
    }
  }, [searchParams, topic])

  useEffect(() => {
    const w = searchParams.get("workspaceId")
    if (w) setWorkspaceId(w)
    const bv = searchParams.get("brandVoiceId")
    if (bv) setBrandVoiceId(bv)
    const p = searchParams.get("sourceContentPackId")
    if (p) setSourceContentPackId(p)
    const g = searchParams.get("sourceGenerationId")
    if (g) setSourceGenerationId(g)
    const st = searchParams.get("sourceType")
    if (st === "CONTENT_PACK" || st === "GENERATION" || st === "MANUAL") {
      setSourceType(st)
    }
  }, [searchParams])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = el.scrollHeight + "px"
  }, [topic])

  /* ==============================
     Intensity Intelligence
  ============================== */
  const intensityLabel = useMemo(() => {
    if (intensity <= 3) return "Slow Burn"
    if (intensity <= 6) return "Emotional Build"
    if (intensity <= 8) return "High Tension"
    return "Chaos Mode"
  }, [intensity])

  const pacingPreview = useMemo(() => {
    if (intensity <= 3) return "Gradual escalation. Soft tension."
    if (intensity <= 6) return "Moderate emotional spikes."
    if (intensity <= 8) return "Frequent tension spikes."
    return "Aggressive hooks. Fast escalation."
  }, [intensity])

  const entitlementBlockedMessage = useMemo(() => {
    if (!entitlement) return null
    return formatBlockedReason(
      entitlement.featureAccess.storyMaker.blockedReason,
      entitlement.featureAccess.storyMaker.minimumPlan
    )
  }, [entitlement])

  const canGenerate = useMemo(() => {
    const validTopic = topic.trim().length > 0 && !loading
    if (!validTopic) return false
    if (!entitlement) return true
    return entitlement.featureAccess.storyMaker.allowed
  }, [topic, loading, entitlement])
  const contextualNudge = useMemo(() => {
    if (repeatUsageCount >= 3) {
      return "You’ve used Story Maker repeatedly. Upgrade for higher limits and full pipeline access."
    }
    if (
      user?.subscriptionStatus === "TRIALING" &&
      normalizePlan(user?.plan) === "PRO" &&
      result
    ) {
      return "You’re using PRO trial. Keep your outputs after trial ends by upgrading now."
    }
    return null
  }, [repeatUsageCount, user?.subscriptionStatus, user?.plan, result])

  /* ==============================
     Generate
  ============================== */
  const generate = useCallback(async () => {
    if (!canGenerate) return

    setLoading(true)
    setError("")
    setResult(null)

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    try {
      const data = await api.post<{ output: StoryOutput; result?: StoryOutput }>(
        "/story-maker",
        {
          topic: topic.trim(),
          format,
          intensity,
          ending,
          ...(workspaceId ? { workspaceId } : {}),
          ...(brandVoiceId ? { brandVoiceId } : {}),
          ...(sourceContentPackId ? { sourceContentPackId } : {}),
          ...(sourceGenerationId ? { sourceGenerationId } : {}),
          ...(sourceType ? { sourceType } : {}),
        },
        { signal: abortRef.current.signal, timeout: 120000 }
      )
      const operation = normalizeToolOperation<StoryOutput>(data, {
        resultKey: "result",
      })
      const output = operation.result
      if (!operation.success || !output) {
        throw new Error(operation.message || "No output returned")
      }
      setResult(output)
      setLastFailureRequestId(null)
      const usageCount = incrementToolUsage("story-maker")
      setRepeatUsageCount(usageCount)
      pushOutputHistory({
        tool: "story-maker",
        title: output.title || "Story output",
        summary: output.hook,
        continuePath: "/dashboard/tools/story-video-maker",
        nextAction: "Turn this story into a full video.",
      })
      recordEmailReadyEvent("OUTPUT_CREATED", `output:story-maker:${Date.now()}`, {
        tool: "story-maker",
      })
      await refreshUser({ silent: true })
    } catch (err: unknown) {
      const apiError = err as ApiError
      if (apiError.name !== "AbortError") {
        setLastFailureRequestId(apiError.requestId ?? null)
        if (apiError.status === 401) {
          setError("Session expired. Please login again.")
          return
        }
        if (apiError.status === 403) {
          setShowUpgradeModal(true)
        }
        setError(apiError?.message || "Something went wrong")
      }
    } finally {
      setLoading(false)
    }
  }, [
    topic,
    format,
    ending,
    intensity,
    workspaceId,
    brandVoiceId,
    sourceContentPackId,
    sourceGenerationId,
    sourceType,
    canGenerate,
    refreshUser,
  ])

  /* ==============================
     Scroll to Result
  ============================== */
  useEffect(() => {
    if (result && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [result])

  /* ==============================
     Copy
  ============================== */
  return (
    <ToolPageShell
      toolId="story-maker"
      title="Story Maker"
      subtitle="Turn a raw idea into a structured story script with hook, pacing, caption, and distribution tags."
      guidance="Use this for narrative-led posts, storytelling shorts, and serialized content concepts."
      statusLabel={
        entitlementBlockedMessage
          ? entitlementBlockedMessage
          : `Ready to generate${typeof user?.credits === "number" ? ` • ${user.credits} credits remaining` : ""}`
      }
      statusTone={entitlementBlockedMessage ? "warning" : "success"}
    >
    <div className="max-w-6xl mx-auto pb-24">

      <div className="mb-6">
        <CreatorWorkflowSelectors
          workspaceId={workspaceId}
          brandVoiceId={brandVoiceId}
          onWorkspaceChange={setWorkspaceId}
          onBrandVoiceChange={setBrandVoiceId}
          disabled={loading}
        />
      </div>

      {/* TEXTAREA */}
      <textarea
        ref={textareaRef}
        maxLength={MAX_CHAR}
        value={topic}
        onChange={(e) => {
          setTopic(e.target.value)
          if (error) setError("")
        }}
        placeholder="Describe your viral story idea..."
        className="w-full p-4 rounded-xl bg-white/5 border border-white/10 mb-2 resize-none"
      />

      <div className="flex justify-between text-xs mb-6">
        <span className="text-gray-500">
          {pacingPreview}
        </span>
        <span
          className={
            topic.length > MAX_CHAR - 50
              ? "text-red-400"
              : "text-gray-500"
          }
        >
          {topic.length}/{MAX_CHAR}
        </span>
      </div>

      {/* CONTROLS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className="p-3 rounded-xl bg-[#0f172a] border border-white/10"
        >
          <option>Reddit Confession</option>
          <option>POV Immersive</option>
          <option>Two Character Dialogue</option>
          <option>Dark Secret</option>
          <option>Fake Podcast Clip</option>
        </select>

        <select
          value={ending}
          onChange={(e) => setEnding(e.target.value)}
          className="p-3 rounded-xl bg-[#0f172a] border border-white/10"
          aria-label="Story ending style"
        >
          <option value="CLIFFHANGER">Ending: Cliffhanger</option>
          <option value="TWIST">Ending: Twist reveal</option>
          <option value="FULL_CIRCLE">Ending: Full circle</option>
          <option value="CALLBACK">Ending: Callback to hook</option>
        </select>

        <div className="md:col-span-2">
          <input
            type="range"
            min="1"
            max="10"
            value={intensity}
            onChange={(e) => setIntensity(Number(e.target.value))}
            className="accent-purple-500 w-full"
          />
          <div className="flex justify-between text-xs mt-1">
            <span>Intensity {intensity}/10</span>
            <span className="text-purple-300">
              {intensityLabel}
            </span>
          </div>
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={generate}
        disabled={!canGenerate}
        className="w-full py-4 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 font-semibold disabled:opacity-50 hover:scale-[1.01] transition"
      >
        {loading ? "Engineering Viral Script..." : "Generate Viral Script"}
      </button>
      {loading && (
        <button
          type="button"
          onClick={() => abortRef.current?.abort()}
          className="mt-2 w-full rounded-full border border-white/15 bg-white/5 py-2 text-xs text-white/70 hover:bg-white/10"
        >
          Cancel current generation
        </button>
      )}

      {error && (
        <div className="mt-4 text-red-400 text-sm flex justify-between">
          <span>
            {error}
            {lastFailureRequestId ? ` (Request ID: ${lastFailureRequestId})` : ""}
          </span>
          <button onClick={generate} className="underline">
            Retry
          </button>
        </div>
      )}
      {contextualNudge && (
        <div className="mt-4 rounded-xl border border-purple-500/30 bg-purple-500/10 px-4 py-3 text-sm text-purple-100">
          {contextualNudge}
          <a href="/pricing" className="ml-2 underline">See upgrade options</a>
        </div>
      )}

      {/* RESULT */}
      {result && (
        <div ref={resultRef}>
          <StoryMakerResultPanel
            result={result}
          />
        </div>
      )}
      <UpgradeModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        message="You’ve reached your current limit for story generation."
        currentPlan={user?.plan}
        requiredPlan={entitlement?.featureAccess.storyMaker.minimumPlan ?? "PRO"}
        benefits={[
          "Expanded story workflow tools",
          "Higher usage limits",
          "Better continuity into video production",
        ]}
      />
    </div>
    </ToolPageShell>
  )
}