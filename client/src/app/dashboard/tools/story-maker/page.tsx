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
import {
  ToolErrorPanel,
  ToolInputSection,
  ToolLoadingPanel,
  ToolPrimaryCta,
  ToolUpgradeHint,
} from "@/components/tools/ToolWorkspace"
import { tools } from "@/config/tools"
import { useAuth } from "@/context/AuthContext"
import { displayPlanForUser } from "@/lib/plans"
import { useEntitlementSnapshot, formatBlockedReason } from "@/hooks/useEntitlementSnapshot"
import { normalizeToolOperation } from "@/lib/tool-operation"
import UpgradeModal from "@/components/growth/UpgradeModal"
import CreatorWorkflowSelectors from "@/components/workflow/CreatorWorkflowSelectors"
import { incrementToolUsage, pushOutputHistory, recordEmailReadyEvent } from "@/lib/growth"
import {
  improveStoryScript,
  type ImproveScriptMode,
} from "@/lib/local-script-improve"

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
  const { user, refreshUser, isAdmin } = useAuth()
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
  const [improveUses, setImproveUses] = useState(0)

  const storyToolMeta = tools.find((t) => t.id === "story-maker")

  const [loadingStep, setLoadingStep] = useState(0)
  useEffect(() => {
    if (!loading) {
      setLoadingStep(0)
      return
    }
    setLoadingStep(0)
    const id = window.setInterval(() => {
      setLoadingStep((s) => Math.min(2, s + 1))
    }, 2800)
    return () => window.clearInterval(id)
  }, [loading])

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
      displayPlanForUser(user?.plan, user?.role) === "PRO" &&
      result
    ) {
      return "You’re using PRO trial. Keep your outputs after trial ends by upgrading now."
    }
    return null
  }, [repeatUsageCount, user?.subscriptionStatus, user?.plan, user?.role, result])

  /* ==============================
     Generate
  ============================== */
  const generate = useCallback(async () => {
    if (!canGenerate) return

    setLoading(true)
    setError("")
    setResult(null)
    setImproveUses(0)

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
        {
          signal: abortRef.current.signal,
          timeout: 120000,
          retry: 0,
          idempotencyKey: `story-maker:${crypto.randomUUID()}`,
        }
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
        continuePath: "/dashboard/tools/ai-ad-generator",
        nextAction: "Use this as a creative brief for Story Video.",
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

  const applyStoryImprove = useCallback(
    (mode: ImproveScriptMode) => {
      if (!result) return
      const cap = entitlement?.improveActionsLimit ?? 0
      if (cap <= 0 || improveUses >= cap) return
      setResult((prev) => (prev ? improveStoryScript(prev, mode) : prev))
      setImproveUses((u) => u + 1)
    },
    [result, entitlement?.improveActionsLimit, improveUses]
  )

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
      outcome={storyToolMeta?.outcome}
      subtitle="AI builds your ads — no filming required. Hook, build, payoff, and CTA with caption and tags."
      guidance="Works best with a specific situation, tension, or twist — not a one-word topic."
      statusLabel={
        entitlementBlockedMessage
          ? entitlementBlockedMessage
          : `Ready to generate${typeof user?.credits === "number" ? ` • ${user.credits} credits remaining` : ""}`
      }
      statusTone={entitlementBlockedMessage ? "warning" : "success"}
    >
    <div className="mx-auto max-w-6xl space-y-6 pb-24">

      <ToolInputSection
        title="Brand context"
        description="Optional — connects this story to your workspace and voice."
      >
        <CreatorWorkflowSelectors
          workspaceId={workspaceId}
          brandVoiceId={brandVoiceId}
          onWorkspaceChange={setWorkspaceId}
          onBrandVoiceChange={setBrandVoiceId}
          disabled={loading}
        />
      </ToolInputSection>

      <ToolInputSection
        title="Your story idea"
        description={pacingPreview}
      >
        <textarea
          ref={textareaRef}
          maxLength={MAX_CHAR}
          value={topic}
          onChange={(e) => {
            setTopic(e.target.value)
            if (error) setError("")
          }}
          placeholder="e.g. The day I found out my co-founder was running a second company using our list…"
          className="mb-2 w-full resize-none rounded-xl border border-white/10 bg-white/5 p-4 text-sm outline-none ring-purple-400/0 transition focus:border-purple-400/35 focus:ring-2 focus:ring-purple-400/25"
        />
        <div className="flex justify-end text-xs text-white/45">
          <span className={topic.length > MAX_CHAR - 50 ? "text-red-400" : ""}>
            {topic.length}/{MAX_CHAR}
          </span>
        </div>
      </ToolInputSection>

      <ToolInputSection
        title="Format & pacing"
        description="Pick a narrative shape and how hard the pacing hits. You can change this anytime."
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-white/55">Story format</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="np-select w-full"
            >
              <option>Reddit Confession</option>
              <option>POV Immersive</option>
              <option>Two Character Dialogue</option>
              <option>Dark Secret</option>
              <option>Fake Podcast Clip</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-white/55">Ending</span>
            <select
              value={ending}
              onChange={(e) => setEnding(e.target.value)}
              className="np-select w-full"
              aria-label="Story ending style"
            >
              <option value="CLIFFHANGER">Cliffhanger</option>
              <option value="TWIST">Twist reveal</option>
              <option value="FULL_CIRCLE">Full circle</option>
              <option value="CALLBACK">Callback to hook</option>
            </select>
          </label>

          <div className="md:col-span-2">
            <span className="text-xs font-medium text-white/55">Pacing ({intensityLabel})</span>
            <input
              type="range"
              min="1"
              max="10"
              value={intensity}
              onChange={(e) => setIntensity(Number(e.target.value))}
              className="mt-2 w-full accent-purple-500"
            />
            <div className="mt-1 flex justify-between text-xs text-white/45">
              <span>Calmer</span>
              <span className="text-purple-300">{intensity}/10</span>
              <span>Faster tension</span>
            </div>
          </div>
        </div>
      </ToolInputSection>

      <ToolPrimaryCta
        onClick={() => void generate()}
        disabled={!canGenerate}
        loading={loading}
        loadingLabel="Writing your story script…"
        helperText="Uses credits per run. Pro unlocks Story Maker if you’re on Starter or Free."
      >
        Generate story script
      </ToolPrimaryCta>
      {loading ? (
        <button
          type="button"
          onClick={() => abortRef.current?.abort()}
          className="w-full rounded-full border border-white/15 bg-white/5 py-2 text-xs text-white/70 hover:bg-white/10"
        >
          Cancel wait (generation may still finish on the server)
        </button>
      ) : null}

      {loading ? (
        <ToolLoadingPanel
          steps={[
            "Framing hook and emotional arc",
            "Writing script, caption, and hashtags",
            "Adding pacing notes you can shoot from",
          ]}
          activeStepIndex={loadingStep}
        />
      ) : null}

      {error ? (
        <ToolErrorPanel
          message={error}
          onRetry={() => void generate()}
          diagnostic={isAdmin ? lastFailureRequestId : null}
        />
      ) : null}

      {contextualNudge ? <ToolUpgradeHint message={contextualNudge} cta="See plans" /> : null}

      {result ? (
        <div ref={resultRef}>
          <StoryMakerResultPanel
            result={result}
            improveActionsLimit={entitlement?.improveActionsLimit ?? 0}
            improveUses={improveUses}
            onImprove={applyStoryImprove}
          />
        </div>
      ) : null}
      <UpgradeModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        message="You’ve reached your current limit for story generation."
        currentPlan={displayPlanForUser(user?.plan, user?.role)}
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