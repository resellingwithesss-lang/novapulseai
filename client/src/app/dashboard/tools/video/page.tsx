"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import { api, ApiError } from "@/lib/api"
import { normalizeToolOperation } from "@/lib/tool-operation"
import { useAuth } from "@/context/AuthContext"
import { displayPlanForUser } from "@/lib/plans"
import ToolPageShell from "@/components/tools/ToolPageShell"
import CreatorWorkflowSelectors from "@/components/workflow/CreatorWorkflowSelectors"
import UpgradeModal from "@/components/growth/UpgradeModal"
import { incrementToolUsage, pushOutputHistory, recordEmailReadyEvent } from "@/lib/growth"
import {
  formatBlockedReason,
  useEntitlementSnapshot,
} from "@/hooks/useEntitlementSnapshot"

/* =====================================================
TYPES
===================================================== */

type ScriptOutput = {
  hook: string
  openLoop: string
  body: string
  cta: string
  caption: string
  hashtags: string[]
}

type GenerationResponse = {
  success: boolean
  requestId: string
  durationMs: number
  output: ScriptOutput[]
  score?: number
}

const TOPIC_MAX = 500

function clampTopic(t: string) {
  const s = t.trim()
  return s.length <= TOPIC_MAX ? s : `${s.slice(0, TOPIC_MAX - 1).trimEnd()}…`
}

const VideoScriptResults = dynamic(
  () => import("./_components/VideoScriptResults"),
  {
    loading: () => (
      <div className="mt-14 rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-sm text-white/60">
        Loading generated scripts...
      </div>
    ),
  }
)

/* =====================================================
MAIN PAGE
===================================================== */

export default function VideoScriptPage() {
  const searchParams = useSearchParams()
  const { user, refreshUser } = useAuth()
  const { entitlement } = useEntitlementSnapshot()

  const [mode, setMode] = useState<"video" | "story">("video")

  const [topic, setTopic] = useState("")
  const [tone, setTone] = useState("Educational")
  const [platform, setPlatform] = useState("TikTok")
  const [audience, setAudience] = useState("Content Creators")
  const [experience, setExperience] = useState("Beginner")
  const [goal, setGoal] = useState("Views")
  const [psychology, setPsychology] = useState("Curiosity Gap")

  const [intensity, setIntensity] = useState(6)
  const [controversy, setControversy] = useState(3)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [result, setResult] = useState<ScriptOutput[] | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [lastFailureRequestId, setLastFailureRequestId] = useState<string | null>(null)
  const [repeatUsageCount, setRepeatUsageCount] = useState(0)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [workspaceId, setWorkspaceId] = useState("")
  const [brandVoiceId, setBrandVoiceId] = useState("")
  const [sourceContentPackId, setSourceContentPackId] = useState("")
  const [sourceGenerationId, setSourceGenerationId] = useState("")
  const [sourceType, setSourceType] = useState<
    "" | "CONTENT_PACK" | "GENERATION" | "MANUAL"
  >("")

  useEffect(() => {
    const handoffTopic = searchParams.get("topic")
    if (handoffTopic && !topic.trim()) {
      setTopic(clampTopic(handoffTopic))
    }
    const m = searchParams.get("mode")
    if (m === "story" || m === "video") {
      setMode(m)
    }
    const pf = searchParams.get("platform")
    if (pf?.trim()) {
      setPlatform(pf.trim())
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

  /* =====================================================
  COMPUTED
  ===================================================== */

  const canGenerate = useMemo(() => {
    if (entitlement) {
      return entitlement.featureAccess.generation.allowed && topic.trim().length >= 3
    }
    const hasCredits = !!user && user.credits > 0
    return hasCredits && topic.trim().length >= 3
  }, [user, topic, entitlement])

  const entitlementBlockedMessage = useMemo(() => {
    if (!entitlement) return null
    return formatBlockedReason(
      entitlement.featureAccess.generation.blockedReason,
      entitlement.featureAccess.generation.minimumPlan
    )
  }, [entitlement])
  const contextualNudge = useMemo(() => {
    if (repeatUsageCount >= 3) {
      return "You’re using this tool heavily. Upgrade for higher limits and smoother high-volume output."
    }
    if (
      user?.subscriptionStatus === "TRIALING" &&
      displayPlanForUser(user?.plan, user?.role) === "PRO" &&
      result
    ) {
      return "You’re using PRO trial. Keep your outputs and avoid interruptions by upgrading before trial ends."
    }
    return null
  }, [repeatUsageCount, user?.subscriptionStatus, user?.plan, user?.role, result])

  /* =====================================================
  GENERATE
  ===================================================== */

  const generate = useCallback(async () => {

    if (!canGenerate || loading) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {

      const response = await api.post<GenerationResponse>("/generation", {
        input: topic.trim(),
        type: mode === "video" ? "VIDEO" : "STORY",
        tone,
        platform,
        audience,
        experience,
        goal,
        psychology,
        format: "Standard",
        pov: "Second Person",
        emotion: "Curiosity",
        intensity,
        controversy,
        ...(workspaceId ? { workspaceId } : {}),
        ...(brandVoiceId ? { brandVoiceId } : {}),
        ...(sourceContentPackId ? { sourceContentPackId } : {}),
        ...(sourceGenerationId ? { sourceGenerationId } : {}),
        ...(sourceType ? { sourceType } : {}),
      }, {
        timeout: 120000,
        retry: 0,
      })
      const operation = normalizeToolOperation<ScriptOutput[]>(response, {
        resultKey: "result",
      })

      const output = operation.result
      if (!operation.success || !Array.isArray(output) || output.length === 0) {
        throw new Error(operation.message || "Invalid server response")
      }

      setResult(output)
      setRequestId(operation.requestId ?? response.requestId)
      setDuration(response.durationMs)
      setLastFailureRequestId(null)
      const usageCount = incrementToolUsage("video")
      setRepeatUsageCount(usageCount)
      pushOutputHistory({
        tool: "video",
        title: output[0]?.hook ? `Video scripts: ${output[0].hook.slice(0, 48)}` : "Video script output",
        summary: `Generated ${output.length} script variation(s).`,
        continuePath: "/dashboard/tools/story-video-maker",
        nextAction: "Turn this script into a full video.",
      })
      recordEmailReadyEvent("OUTPUT_CREATED", `output:video:${Date.now()}`, {
        tool: "video",
        requestId: operation.requestId ?? response.requestId,
      })

      await refreshUser()

    } catch (err) {
      const apiError = err as ApiError
      setLastFailureRequestId(apiError.requestId ?? null)
      if (apiError?.status === 408) {
        setError("Generation timed out. Please try again with a simpler topic.")
      } else if (apiError?.status === 429) {
        const retryAfterMs = Number(apiError?.data?.retryAfterMs ?? 0)
        const retryAfterSec = retryAfterMs > 0 ? Math.max(1, Math.ceil(retryAfterMs / 1000)) : 0
        setError(
          retryAfterSec > 0
            ? `Cooldown active. Please wait ${retryAfterSec}s and try again.`
            : "Cooldown active. Please wait and try again."
        )
      } else if (apiError?.status === 403) {
        setError(apiError.message || "No credits remaining.")
        setShowUpgradeModal(true)
      } else {
        setError(apiError?.message || "Generation failed")
      }

      await refreshUser()

    } finally {

      setLoading(false)

    }

  }, [
    canGenerate,
    loading,
    topic,
    mode,
    tone,
    platform,
    audience,
    experience,
    goal,
    psychology,
    intensity,
    controversy,
    workspaceId,
    brandVoiceId,
    sourceContentPackId,
    sourceGenerationId,
    sourceType,
    refreshUser
  ])

  /* =====================================================
  COPY ALL
  ===================================================== */

  const copyAll = useCallback(() => {

    if (!result) return

    const text = result.map((r, i) => `
Variation ${i + 1}

Hook:
${r.hook}

Open Loop:
${r.openLoop}

Body:
${r.body}

CTA:
${r.cta}

Caption:
${r.caption}

Hashtags:
${r.hashtags.join(" ")}
`).join("\n\n========================\n\n")

    navigator.clipboard.writeText(text).catch(() => {
      setError("Clipboard access failed. Copy each variation manually.")
    })

  }, [result])

  /* =====================================================
  UI
  ===================================================== */

  return (
    <ToolPageShell
      toolId="video-script"
      title="Video Script Engine"
      subtitle="Generate retention-focused scripts you can post directly or hand off into your next production step."
      guidance="Use a concrete topic. Strong topic quality improves hooks, pacing, and CTA quality."
      statusLabel={entitlementBlockedMessage ? entitlementBlockedMessage : "Generation available"}
      statusTone={entitlementBlockedMessage ? "warning" : "success"}
      ctaHref="/dashboard/tools/clipper"
      ctaLabel="Open Clipper Engine"
    >
      <div className="max-w-6xl mx-auto pb-24">

      <ModeSwitch
        mode={mode}
        setMode={setMode}
      />

      <div className="mb-6">
        <CreatorWorkflowSelectors
          workspaceId={workspaceId}
          brandVoiceId={brandVoiceId}
          onWorkspaceChange={setWorkspaceId}
          onBrandVoiceChange={setBrandVoiceId}
          disabled={loading}
        />
      </div>

      {(sourceContentPackId || sourceType) && (
        <p
          data-testid="npai-lineage-hint"
          className="mb-4 rounded-xl border border-violet-500/25 bg-violet-500/10 px-4 py-2 text-xs text-violet-100/95"
        >
          <span className="font-medium text-violet-200">Lineage</span>
          {sourceType ? ` · ${sourceType}` : ""}
          {sourceContentPackId ? ` · pack ${sourceContentPackId}` : ""}
          {workspaceId ? ` · workspace ${workspaceId}` : ""}
          {brandVoiceId ? ` · brand voice ${brandVoiceId}` : ""}
        </p>
      )}

      <textarea
        value={topic}
        maxLength={500}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="Enter your viral topic..."
        className="w-full p-4 rounded-xl bg-white/5 border border-white/10 mb-2"
      />

      <div className="text-xs text-right text-white/40 mb-6">
        {topic.length}/500 characters
      </div>

      <SettingsGrid
        tone={tone}
        setTone={setTone}
        platform={platform}
        setPlatform={setPlatform}
        audience={audience}
        setAudience={setAudience}
        experience={experience}
        setExperience={setExperience}
        goal={goal}
        setGoal={setGoal}
        psychology={psychology}
        setPsychology={setPsychology}
      />

      <Slider
        label="Scroll Stop Intensity"
        value={intensity}
        onChange={setIntensity}
      />

      <Slider
        label="Controversy Level"
        value={controversy}
        onChange={setControversy}
      />

      <button
        onClick={generate}
        disabled={!canGenerate || loading}
        className="w-full mt-8 py-4 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 disabled:opacity-50"
      >
        {loading ? "Generating..." : "Generate Script (-1 Credit)"}
      </button>

      {error && (
        <p className="text-red-400 mt-4">
          {error}
          {lastFailureRequestId ? ` (Request ID: ${lastFailureRequestId})` : ""}
        </p>
      )}
      {contextualNudge && (
        <div className="mt-4 rounded-xl border border-purple-500/30 bg-purple-500/10 px-4 py-3 text-sm text-purple-100">
          {contextualNudge}
          <a href="/pricing" className="ml-2 underline">Compare plans</a>
        </div>
      )}

      {requestId && (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/50">
          Request ID: {requestId} | Runtime: {duration}ms
        </div>
      )}

      {result && (
        <VideoScriptResults
          result={result}
          onCopyAll={copyAll}
        />
      )}

      </div>
      <UpgradeModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        message="You’ve reached your current limit during generation."
        currentPlan={displayPlanForUser(user?.plan, user?.role)}
        requiredPlan="PRO"
        benefits={[
          "Higher monthly credits",
          "Expanded tool access",
          "Better throughput for repeat generation",
        ]}
      />
    </ToolPageShell>
  )
}

/* =====================================================
COMPONENTS
===================================================== */

type HeaderProps = {
  mode: "video" | "story"
  setMode: (nextMode: "video" | "story") => void
}

function ModeSwitch({ mode, setMode }: HeaderProps) {

  return (
    <div className="mb-6 flex justify-end">
      <div className="flex gap-2">
        <ToggleButton
          label="Video"
          active={mode === "video"}
          onClick={() => setMode("video")}
        />
        <ToggleButton
          label="Story"
          active={mode === "story"}
          onClick={() => setMode("story")}
        />
      </div>
    </div>
  )
}

type ToggleButtonProps = {
  label: string
  active: boolean
  onClick: () => void
}

function ToggleButton({ label, active, onClick }: ToggleButtonProps) {

  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-full ${
        active ? "bg-purple-600" : "bg-white/5"
      }`}
    >
      {label}
    </button>
  )
}

type SliderProps = {
  label: string
  value: number
  onChange: (next: number) => void
}

function Slider({ label, value, onChange }: SliderProps) {

  return (
    <div className="mb-6">

      <div className="flex justify-between text-sm mb-2">
        <span>{label}</span>
        <span>{value}/10</span>
      </div>

      <input
        type="range"
        min="1"
        max="10"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-purple-500"
      />

    </div>
  )
}

type SettingsGridProps = {
  tone: string
  setTone: (value: string) => void
  platform: string
  setPlatform: (value: string) => void
  audience: string
  setAudience: (value: string) => void
  experience: string
  setExperience: (value: string) => void
  goal: string
  setGoal: (value: string) => void
  psychology: string
  setPsychology: (value: string) => void
}

function SettingsGrid(props: SettingsGridProps) {

  return (
    <div className="grid grid-cols-2 gap-6 mb-8">

      <SelectBox label="Tone" value={props.tone} onChange={props.setTone}
        options={["Educational","Bold","Emotional","Contrarian","Luxury"]} />

      <SelectBox label="Platform" value={props.platform} onChange={props.setPlatform}
        options={["TikTok","Instagram Reels","YouTube Shorts"]} />

      <SelectBox label="Target Audience" value={props.audience} onChange={props.setAudience}
        options={["Content Creators","Entrepreneurs","Students","General Audience"]} />

      <SelectBox label="Experience Level" value={props.experience} onChange={props.setExperience}
        options={["Beginner","Intermediate","Advanced"]} />

      <SelectBox label="Primary Goal" value={props.goal} onChange={props.setGoal}
        options={["Views","Followers","Sales","Authority"]} />

      <SelectBox label="Psychological Trigger" value={props.psychology} onChange={props.setPsychology}
        options={["Curiosity Gap","Fear of Missing Out","Authority Trigger","Contrarian Angle","Social Proof"]} />

    </div>
  )
}

type SelectBoxProps = {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
}

function SelectBox({ label, value, onChange, options }: SelectBoxProps) {

  return (
    <div>

      <p className="text-xs text-gray-400 mb-2">{label}</p>

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-3 rounded-xl bg-[#0f172a] border border-white/10"
      >
        {options.map((opt: string) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>

    </div>
  )
}
