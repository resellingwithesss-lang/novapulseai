"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import {
  Captions,
  Clapperboard,
  Palette,
  ShieldAlert,
  Sparkles,
  Upload,
} from "lucide-react"
import { api, ApiError } from "@/lib/api"
import ToolPageShell from "@/components/tools/ToolPageShell"
import { formatBlockedReason, useEntitlementSnapshot } from "@/hooks/useEntitlementSnapshot"
import { incrementToolUsage, pushOutputHistory, recordEmailReadyEvent } from "@/lib/growth"
import UpgradeModal from "@/components/growth/UpgradeModal"

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

const ClipperResultsPanel = dynamic(
  () => import("./_components/ClipperResultsPanel"),
  {
    loading: () => (
      <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/60">
        Loading generated clips...
      </div>
    ),
  }
)

export type ClipCaptionStatus =
  | "burned_in"
  | "srt_only"
  | "skipped_disabled"
  | "skipped_empty"
  | "failed"

export type ClipCaptionSource =
  | "youtube_transcript"
  | "whisper"
  | "none"
  | "unavailable"

export type ClipItem = {
  index: number
  startSec: number
  endSec: number
  durationSec: number
  platform: "tiktok" | "instagram" | "youtube"
  subtitleStyle: "clean" | "bold" | "viral" | "minimal"
  score: number
  reasonLabels: string[]
  publicPath: string
  sourceType?: "upload" | "youtube"
  targetClipDurationSec?: number
  title?: string
  summary?: string
  timestampRangeLabel?: string
  captionsEnabled?: boolean
  captionStatus?: ClipCaptionStatus
  captionSource?: ClipCaptionSource
  captionNote?: string
  subtitlePublicPath?: string
}

type CreateClipJobResponse = {
  success: boolean
  jobId?: string
  requestId?: string
  message?: string
  clipJobStage?: string
}

type ClipJobPollResponse = {
  success: boolean
  jobId: string
  status: string
  clipJobStage: string
  progress: number
  message: string
  result?: {
    clipItems: ClipItem[]
    partial: boolean
    requestedClips: number
    generatedClips: number
    targetClipDurationSec: number
    qualitySignals: string[]
  }
  error?: { code: string; message: string; httpStatus?: number }
  requestId?: string
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Safer UI copy for YouTube ingest failures (never show raw stderr or env var names). */
const CLIP_UI_YOUTUBE_BLOCKED =
  "YouTube is blocking automated download from our servers for this link. Upload the video file, try another public URL, or ask your workspace operator to enable a signed-in YouTube session for this deployment."

const CLIP_UI_YOUTUBE_COOKIES_UNCONFIGURED =
  "This link needs a signed-in YouTube session on our servers, and that is not configured on this deployment yet. Upload the video file for a guaranteed path, or ask your operator to add a valid browser cookies export."

const CLIP_UI_YOUTUBE_COOKIES_BAD =
  "The server-side YouTube session file is missing, expired, or invalid. Ask your operator to refresh the browser cookies export, or upload the video file."

const CLIP_UI_YOUTUBE_JS =
  "This YouTube link cannot be processed automatically in our cloud environment. Upload the video file directly for the most dependable run."

function clipperErrorIsYoutubeCookiesIssueCategory(message: string): boolean {
  if (!message) return false
  return message === CLIP_UI_YOUTUBE_COOKIES_BAD || message === CLIP_UI_YOUTUBE_COOKIES_UNCONFIGURED
}

function clipperErrorIsYoutubeBlockedCategory(message: string): boolean {
  if (!message) return false
  if (message === CLIP_UI_YOUTUBE_BLOCKED) return true
  const t = message.toLowerCase()
  return (
    t.includes("blocked for server-side") ||
    t.includes("not a bot") ||
    t.includes("download failed: youtube did not return") ||
    t.includes("configure server-side youtube cookies")
  )
}

function clipperErrorIsYoutubeJsCategory(message: string): boolean {
  if (!message) return false
  if (message === CLIP_UI_YOUTUBE_JS) return true
  const t = message.toLowerCase()
  return (
    t.includes("javascript runtime") ||
    t.includes("cannot be downloaded automatically from our servers") ||
    t.includes("cannot be processed automatically")
  )
}

function clipperErrorIsYoutubePremiumFailure(message: string): boolean {
  return (
    clipperErrorIsYoutubeJsCategory(message) ||
    clipperErrorIsYoutubeBlockedCategory(message) ||
    clipperErrorIsYoutubeCookiesIssueCategory(message)
  )
}

function formatClipperJobErrorForUi(raw: string, sourceWasYoutube: boolean): string {
  if (!sourceWasYoutube) return raw
  const t = raw.toLowerCase()
  if (
    t.includes("cookies file is present but invalid") ||
    t.includes("invalid, empty, or expired") ||
    t.includes("session file is missing, expired, or invalid")
  ) {
    return CLIP_UI_YOUTUBE_COOKIES_BAD
  }
  if (t.includes("no valid cookies file is configured")) {
    return CLIP_UI_YOUTUBE_COOKIES_UNCONFIGURED
  }
  if (
    t.includes("javascript runtime") ||
    t.includes("cannot be downloaded automatically from our servers") ||
    t.includes("cannot be processed automatically")
  ) {
    return CLIP_UI_YOUTUBE_JS
  }
  if (
    t.includes("blocked for server-side") ||
    t.includes("not a bot") ||
    t.includes("youtube blocked") ||
    t.includes("download failed: youtube did not return") ||
    t.includes("configure server-side youtube cookies")
  ) {
    return CLIP_UI_YOUTUBE_BLOCKED
  }
  if (t.includes("use --cookies") || (t.includes("authentication") && t.includes("cookie"))) {
    return CLIP_UI_YOUTUBE_COOKIES_UNCONFIGURED
  }
  return raw
}

const CLIP_STAGE_LABELS: Record<string, string> = {
  queued: "Queued — waiting for a worker…",
  ingesting: "Ingesting source (upload or YouTube)…",
  analyzing: "Analyzing scenes and motion…",
  selecting_moments: "Selecting the strongest moments…",
  trimming: "Trimming and encoding vertical clips…",
  captioning: "Building captions (transcript or speech-to-text)…",
  finalizing: "Packaging files and metadata…",
  completed: "Done.",
  failed: "Failed.",
}

export default function ClipperPage() {
  type SubtitleStyle = "clean" | "bold" | "viral" | "minimal"
  type LengthPreset = "15" | "30" | "45" | "60" | "custom"
  type ClipLayoutPreset =
    | "clean"
    | "stream_overlay"
    | "reaction_style"
    | "podcast_clip"
    | "gaming_style"
  type ClipTypePreset = "viral" | "streamer" | "talking" | "podcast" | "promo"
  type StreamPlatform = "kick" | "twitch" | "youtube"
  type CaptionStylePreset =
    | "clean_minimal"
    | "bold_viral"
    | "highlight_words"
    | "subtitle_style"
    | "high_contrast"
  type CaptionColorTheme = "white" | "yellow" | "green" | "purple" | "custom"
  type ClipTypeOption = {
    value: ClipTypePreset
    label: string
    useCase: string
  }
  type CaptionOption = {
    value: CaptionStylePreset
    label: string
    visualSample: string
  }

  const searchParams = useSearchParams()
  const { entitlement } = useEntitlementSnapshot()
  const [sourceMode, setSourceMode] = useState<"upload" | "youtube">("upload")
  const [video, setVideo] = useState<File | null>(null)
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const [clips, setClips] = useState(5)
  const [platform, setPlatform] = useState<"tiktok" | "instagram" | "youtube">("tiktok")
  const [clipTypePreset, setClipTypePreset] = useState<ClipTypePreset>("viral")
  const [clipLayoutPreset, setClipLayoutPreset] = useState<ClipLayoutPreset>("clean")
  const [streamerName, setStreamerName] = useState("")
  const [streamPlatform, setStreamPlatform] = useState<StreamPlatform>("twitch")
  const [captionStylePreset, setCaptionStylePreset] = useState<CaptionStylePreset>("clean_minimal")
  const [captionColorTheme, setCaptionColorTheme] = useState<CaptionColorTheme>("white")
  const [captionCustomColor, setCaptionCustomColor] = useState("#FFFFFF")
  const [styleCustomized, setStyleCustomized] = useState(false)
  const [captionMode, setCaptionMode] = useState<"burn" | "srt" | "both">("both")
  const [clipLengthPreset, setClipLengthPreset] = useState<LengthPreset>("30")
  const [customClipLengthSec, setCustomClipLengthSec] = useState(30)
  const [captionsEnabled, setCaptionsEnabled] = useState(true)
  const [showTimestamps, setShowTimestamps] = useState(true)
  const [loading, setLoading] = useState(false)
  const [jobProgress, setJobProgress] = useState(0)
  const [results, setResults] = useState<ClipItem[]>([])
  const [error, setError] = useState("")
  const [infoMessage, setInfoMessage] = useState("")
  const [stageLabel, setStageLabel] = useState("")
  const [jobSummary, setJobSummary] = useState<{
    partial: boolean
    requestedClips: number
    generatedClips: number
    targetClipDurationSec: number
  } | null>(null)
  const pollAbortRef = useRef(false)
  const [validationHint, setValidationHint] = useState("")
  const [requestContextId, setRequestContextId] = useState("")
  const [workspaceId, setWorkspaceId] = useState("")
  const [sourceContentPackId, setSourceContentPackId] = useState("")
  const [sourceGenerationId, setSourceGenerationId] = useState("")
  const [sourceType, setSourceType] = useState<
    "" | "CONTENT_PACK" | "GENERATION" | "MANUAL"
  >("")
  const [qualitySignals, setQualitySignals] = useState<string[]>([])
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [lastFailureRequestId, setLastFailureRequestId] = useState<string | null>(null)
  const [repeatUsageCount, setRepeatUsageCount] = useState(0)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [packAngleHint, setPackAngleHint] = useState("")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const normalizeHex = (value: string) => {
    const trimmed = value.trim()
    return /^#[0-9A-Fa-f]{6}$/.test(trimmed) ? trimmed.toUpperCase() : null
  }
  const applyClipTypePreset = useCallback(
    (preset: ClipTypePreset, customized: boolean) => {
      setClipTypePreset(preset)
      setStyleCustomized(customized)
      switch (preset) {
        case "viral":
          setClipLayoutPreset("reaction_style")
          setCaptionStylePreset("bold_viral")
          setCaptionColorTheme("yellow")
          break
        case "streamer":
          setClipLayoutPreset("stream_overlay")
          setCaptionStylePreset("highlight_words")
          setCaptionColorTheme("purple")
          break
        case "talking":
          setClipLayoutPreset("clean")
          setCaptionStylePreset("clean_minimal")
          setCaptionColorTheme("white")
          break
        case "podcast":
          setClipLayoutPreset("podcast_clip")
          setCaptionStylePreset("subtitle_style")
          setCaptionColorTheme("green")
          break
        case "promo":
          setClipLayoutPreset("gaming_style")
          setCaptionStylePreset("bold_viral")
          setCaptionColorTheme("purple")
          break
        default:
          break
      }
    },
    []
  )
  const clipTypeOptions: ClipTypeOption[] = [
    {
      value: "viral",
      label: "Viral Clip",
      useCase: "Fast hook-first packaging for retention on short feeds.",
    },
    {
      value: "streamer",
      label: "Streamer Clip",
      useCase: "Live-style packaging with creator identity overlay bars.",
    },
    {
      value: "talking",
      label: "Talking Clip",
      useCase: "Clean talking-head framing with readable lower captions.",
    },
    {
      value: "podcast",
      label: "Podcast Clip",
      useCase: "Dialogue-led composition tuned for long-sentence clarity.",
    },
    {
      value: "promo",
      label: "Promo Clip",
      useCase: "Offer-driven framing with polished accent treatment.",
    },
  ]

  const captionOptions: CaptionOption[] = [
    {
      value: "clean_minimal",
      label: "Clean",
      visualSample: "balanced sentence case at lower third",
    },
    {
      value: "bold_viral",
      label: "Bold",
      visualSample: "large uppercase stack with high emphasis",
    },
    {
      value: "highlight_words",
      label: "Highlight",
      visualSample: "key words color-popped for scan speed",
    },
    {
      value: "subtitle_style",
      label: "Minimal",
      visualSample: "compact subtitle lane with low visual noise",
    },
  ]

  const clipAccess = entitlement?.featureAccess.clip
  const blockedMessage = formatBlockedReason(
    clipAccess?.blockedReason ?? null,
    clipAccess?.minimumPlan ?? null
  )
  const canGenerateByEntitlement = clipAccess ? clipAccess.allowed : true

  const resolveSubtitleStyle = (): SubtitleStyle => {
    switch (captionStylePreset) {
      case "clean_minimal":
        return "clean"
      case "bold_viral":
        return "viral"
      case "highlight_words":
        return "bold"
      case "subtitle_style":
        return "minimal"
      case "high_contrast":
        return "bold"
      default:
        return "clean"
    }
  }

  const clipTypeVisuals: Record<
    ClipTypePreset,
    {
      accent: string
      frameTone: string
      overlay: string
      captionY: string
      captionText: string
      chip: string
    }
  > = {
    viral: {
      accent: "#FDE047",
      frameTone: "from-[#1b1229] via-[#1c2b4a] to-[#05070d]",
      overlay: "Top hook strip + momentum badge",
      captionY: "bottom-3",
      captionText: "THIS MOMENT CHANGES EVERYTHING",
      chip: "Retention mode",
    },
    streamer: {
      accent: "#A78BFA",
      frameTone: "from-[#24162e] via-[#17293f] to-[#04070f]",
      overlay: "Creator topbar + platform badge",
      captionY: "bottom-3",
      captionText: "Chat went wild at this point",
      chip: "Live identity",
    },
    talking: {
      accent: "#FFFFFF",
      frameTone: "from-[#1a1f2e] via-[#18212c] to-[#07090f]",
      overlay: "Subtle lower-third framing",
      captionY: "bottom-3",
      captionText: "Three practical steps to fix this today",
      chip: "Talking-head",
    },
    podcast: {
      accent: "#86EFAC",
      frameTone: "from-[#102128] via-[#151e2b] to-[#05070d]",
      overlay: "Dual-speaker title rail",
      captionY: "bottom-2",
      captionText: "We tested this for 90 days and here is what happened",
      chip: "Conversation",
    },
    promo: {
      accent: "#FB7185",
      frameTone: "from-[#2a1220] via-[#221b3d] to-[#06070e]",
      overlay: "Offer badge + CTA rail",
      captionY: "bottom-3",
      captionText: "Launch offer ends tonight",
      chip: "Campaign",
    },
  }

  const activeClipType = clipTypeOptions.find((preset) => preset.value === clipTypePreset)
  const activeCaptionOption = captionOptions.find((preset) => preset.value === captionStylePreset)

  useEffect(() => {
    const source = searchParams.get("source")
    const platformParam = searchParams.get("platform")
    const clipsParam = searchParams.get("clips")
    const subtitleParam = searchParams.get("subtitleStyle")
    const context = searchParams.get("contextId")
    const workspace = searchParams.get("workspaceId")
    const sourcePack = searchParams.get("sourceContentPackId")
    const sourceGeneration = searchParams.get("sourceGenerationId")
    const sourceTypeParam = searchParams.get("sourceType")

    if (source && !video) {
      setSourceMode("youtube")
      setYoutubeUrl(source)
    }
    if (
      platformParam === "tiktok" ||
      platformParam === "instagram" ||
      platformParam === "youtube"
    ) {
      setPlatform(platformParam)
    }
    if (clipsParam) {
      const parsed = Number(clipsParam)
      if (Number.isFinite(parsed)) {
        setClips(Math.min(20, Math.max(1, Math.round(parsed))))
      }
    }
    if (
      subtitleParam === "clean" ||
      subtitleParam === "bold" ||
      subtitleParam === "viral" ||
      subtitleParam === "minimal"
    ) {
      if (subtitleParam === "clean") setCaptionStylePreset("clean_minimal")
      if (subtitleParam === "bold") setCaptionStylePreset("highlight_words")
      if (subtitleParam === "viral") setCaptionStylePreset("bold_viral")
      if (subtitleParam === "minimal") setCaptionStylePreset("subtitle_style")
    }
    if (context) {
      setRequestContextId(context)
    }
    if (workspace) setWorkspaceId(workspace)
    if (sourcePack) setSourceContentPackId(sourcePack)
    if (sourceGeneration) setSourceGenerationId(sourceGeneration)
    if (
      sourceTypeParam === "CONTENT_PACK" ||
      sourceTypeParam === "GENERATION" ||
      sourceTypeParam === "MANUAL"
    ) {
      setSourceType(sourceTypeParam)
    }
    const clipAngle = searchParams.get("clipAngle")
    if (clipAngle?.trim()) {
      setPackAngleHint(clipAngle.trim())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (styleCustomized) return
    if (platform === "tiktok") {
      applyClipTypePreset("viral", false)
      return
    }
    if (platform === "youtube") {
      applyClipTypePreset("talking", false)
      return
    }
    applyClipTypePreset("promo", false)
  }, [platform, styleCustomized, applyClipTypePreset])

  useEffect(() => {
    pollAbortRef.current = false
    return () => {
      pollAbortRef.current = true
    }
  }, [])

  useEffect(() => {
    if (!loading) {
      setElapsedSeconds(0)
      return
    }
    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1)
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [loading])

  const validateInput = (): boolean => {
    if (sourceMode === "upload") {
      if (!video) {
        setValidationHint("Choose a video file to continue.")
        return false
      }
      if (video.size > MAX_UPLOAD_BYTES) {
        setValidationHint("File is too large. Maximum upload size is 512 MB.")
        return false
      }
      setValidationHint("")
    } else {
      const normalizedUrl = youtubeUrl.trim()
      // Keep in sync with server/src/lib/youtube-url.ts :: YOUTUBE_HOSTS.
      // A drift test in server/src/tests/clip/youtube-url.test.ts parses this
      // literal and fails CI if the two sets diverge. The server revalidates
      // the URL on submit — this copy exists only for immediate in-form UX.
      const YOUTUBE_HOSTS = new Set([
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
      ])
      let validYoutubeUrl = false
      if (normalizedUrl) {
        try {
          const withScheme = /^https?:\/\//i.test(normalizedUrl)
            ? normalizedUrl
            : `https://${normalizedUrl}`
          const u = new URL(withScheme)
          validYoutubeUrl =
            (u.protocol === "https:" || u.protocol === "http:") &&
            YOUTUBE_HOSTS.has(u.hostname.toLowerCase())
        } catch {
          validYoutubeUrl = false
        }
      }
      if (!normalizedUrl || !validYoutubeUrl) {
        setValidationHint(
          "Use a public YouTube link (youtube.com, youtu.be, or m./music./youtube-nocookie variants)."
        )
        return false
      }
      setValidationHint("")
    }

    if (!Number.isFinite(clips) || clips < 1 || clips > 20) {
      setValidationHint("Clip count must be between 1 and 20.")
      return false
    }

    if (clipLengthPreset === "custom") {
      if (
        !Number.isFinite(customClipLengthSec) ||
        customClipLengthSec < 5 ||
        customClipLengthSec > 120
      ) {
        setValidationHint("Custom clip length must be between 5 and 120 seconds.")
        return false
      }
    }

    return true
  }

  const generate = async () => {
    if (!canGenerateByEntitlement) {
      setError(
        `${blockedMessage || "Access blocked"}. Current plan: ${
          entitlement?.normalizedPlan ?? "STARTER"
        }. Required: ${clipAccess?.minimumPlan ?? "STARTER"}.`
      )
      setShowUpgradeModal(true)
      return
    }
    if (!validateInput()) return

    try {
      setLoading(true)
      setError("")
      setInfoMessage("")
      setResults([])
      setQualitySignals([])
      setJobSummary(null)
      setRequestContextId("")
      setJobProgress(0)
      setStageLabel("Submitting job…")

      const formData = new FormData()

      if (sourceMode === "upload" && video) {
        formData.append("video", video)
      }

      if (sourceMode === "youtube" && youtubeUrl) {
        formData.append("youtubeUrl", youtubeUrl.trim())
      }

      formData.append("clips", String(clips))
      formData.append("platform", platform)
      formData.append("subtitleStyle", resolveSubtitleStyle())
      formData.append("clipLengthPreset", clipLengthPreset)
      if (clipLengthPreset === "custom") {
        formData.append("customClipLengthSec", String(customClipLengthSec))
      }
      formData.append("captionsEnabled", captionsEnabled ? "true" : "false")
      formData.append("captionMode", captionsEnabled ? captionMode : "both")
      formData.append("clipLayoutPreset", clipLayoutPreset)
      if (clipLayoutPreset === "stream_overlay") {
        const safeStreamerName = streamerName.trim()
        if (safeStreamerName) formData.append("streamerName", safeStreamerName)
        formData.append("streamPlatform", streamPlatform)
      }
      formData.append("captionStylePreset", captionStylePreset)
      formData.append("captionColorTheme", captionColorTheme)
      if (captionColorTheme === "custom") {
        const safeHex = normalizeHex(captionCustomColor)
        if (!safeHex) {
          setError("Custom caption color must be a valid hex value like #FACC15.")
          setLoading(false)
          return
        }
        formData.append("captionCustomColor", safeHex)
      }
      if (workspaceId) formData.append("workspaceId", workspaceId)
      if (sourceContentPackId) formData.append("sourceContentPackId", sourceContentPackId)
      if (sourceGenerationId) formData.append("sourceGenerationId", sourceGenerationId)
      if (sourceType) formData.append("sourceType", sourceType)

      const enqueued = await api.post<CreateClipJobResponse>("/clip/create", formData, {
        timeout: 120_000,
        retry: 0,
        idempotencyKey: `clip-create:${crypto.randomUUID()}`,
      })

      if (!enqueued.success || !enqueued.jobId) {
        setError(enqueued.message || "Could not start clip job.")
        return
      }

      if (enqueued.requestId) setRequestContextId(enqueued.requestId)
      setStageLabel(
        enqueued.message ||
          CLIP_STAGE_LABELS[enqueued.clipJobStage || "queued"] ||
          "Job queued…"
      )

      const jobId = enqueued.jobId
      const deadline = Date.now() + 45 * 60 * 1000

      while (Date.now() < deadline) {
        if (pollAbortRef.current) {
          setError("Cancelled.")
          return
        }

        const job = await api.get<ClipJobPollResponse>(`/clip/jobs/${jobId}`, {
          timeout: 45_000,
        })

        if (!job.success || !job.jobId) {
          setError("Lost connection to job status. Refresh and check history.")
          return
        }

        setJobProgress(typeof job.progress === "number" ? job.progress : 0)
        setStageLabel(
          job.message ||
            CLIP_STAGE_LABELS[job.clipJobStage] ||
            "Processing…"
        )

        if (job.clipJobStage === "failed" || job.status === "failed") {
          throw new Error(job.error?.message || job.message || "Clip job failed")
        }

        if (
          (job.clipJobStage === "completed" || job.status === "completed") &&
          job.result?.clipItems
        ) {
          const clipItems = job.result.clipItems
          if (clipItems.length > 0) {
            setResults(clipItems)
            setQualitySignals(job.result.qualitySignals || [])
            setJobSummary({
              partial: Boolean(job.result.partial),
              requestedClips: job.result.requestedClips,
              generatedClips: job.result.generatedClips,
              targetClipDurationSec: job.result.targetClipDurationSec,
            })
            setLastFailureRequestId(null)
            if (job.result.partial) {
              setInfoMessage(
                `Delivered ${job.result.generatedClips} of ${job.result.requestedClips} clips — source length limited full coverage.`
              )
            } else {
              setInfoMessage(job.message || "All requested clips are ready.")
            }
            const usageCount = incrementToolUsage("clipper")
            setRepeatUsageCount(usageCount)
            pushOutputHistory({
              tool: "clipper",
              title: `Clip set created (${clipItems.length})`,
              summary: clipItems[0]?.summary || clipItems[0]?.publicPath,
              continuePath: "/dashboard/tools/story-maker",
              nextAction: "Move clips into Story Maker or Prompt Intelligence.",
            })
            recordEmailReadyEvent("OUTPUT_CREATED", `output:clipper:${Date.now()}`, {
              tool: "clipper",
              count: clipItems.length,
            })
          } else {
            setError("Job completed but returned no clips. Try different settings.")
          }
          return
        }

        await sleep(1600)
      }

      setError("This job is taking longer than expected. Check back later or retry with fewer clips.")
    } catch (err) {
      const apiError = err as ApiError & Error
      const msg = err instanceof Error ? err.message : String(err)
      console.error(err)
      setLastFailureRequestId(
        typeof apiError.requestId === "string" ? apiError.requestId : null
      )
      if (apiError?.status === 401) {
        setError("Your session expired. Please log in and try again.")
      } else if (apiError?.status === 403) {
        setError(apiError.message || "Clipper requires an eligible plan.")
        setShowUpgradeModal(true)
      } else if (apiError?.status === 400) {
        setError(apiError.message || "Invalid request. Check your file, URL, and settings.")
      } else if (apiError?.status === 404) {
        setError("Job not found or expired. Start a new run.")
      } else if (apiError?.status === 408) {
        setError("Status request timed out. Your job may still be running — wait and use Retry.")
      } else {
        setError(
          formatClipperJobErrorForUi(msg || "Clip job failed.", sourceMode === "youtube")
        )
      }
    } finally {
      setLoading(false)
      setJobProgress(0)
    }
  }

  return (
    <ToolPageShell
      toolId="clipper"
      title="Clipper Engine"
      subtitle="Automation pipeline: ingest a long-form source, detect strong moments, trim to your target length, timestamp every export, and align captions — then hand off to the rest of NovaPulseAI."
      guidance="Jobs run asynchronously on the server (no long browser hang). You will see live stages: ingest → analyze → trim → captions → finalize. Paste a public YouTube URL and NovaPulse downloads the source server-side for you, or upload a file directly (up to 512MB). Both paths feed the same pipeline — upload is offered as a fallback only if YouTube surfaces a real bot check or blocked format for your link."
      statusLabel={
        blockedMessage ||
        (loading ? `Processing… ${jobProgress > 0 ? `${jobProgress}%` : ""}` : "Ready")
      }
      statusTone={loading ? "warning" : blockedMessage ? "warning" : "success"}
      ctaHref="/dashboard/tools/story-maker"
      ctaLabel="Open Story Maker"
    >
      <div className="space-y-6">
        <section className="np-card p-5 md:p-6">
          <div className="mb-5 flex items-start gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-2">
              <Upload className="h-4 w-4 text-white/75" aria-hidden />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-[-0.01em] text-white/92">
                Source
              </h3>
              <p className="mt-1 text-xs text-white/55">
                Paste a public YouTube URL and NovaPulse downloads the source server-side, or upload a file
                directly. Both feed the same clip pipeline.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/20 p-1">
            <button
              type="button"
              onClick={() => {
                setSourceMode("upload")
                setValidationHint("")
              }}
              className={`relative rounded-lg px-3 py-2.5 text-left text-sm transition ${
                sourceMode === "upload"
                  ? "bg-purple-600 text-white shadow-[0_12px_28px_-18px_rgba(147,51,234,0.85)] ring-1 ring-white/15"
                  : "text-white/70 hover:bg-white/5"
              }`}
            >
              <span className="block font-semibold">Upload video</span>
              <span
                className={`mt-0.5 block text-[10px] font-medium uppercase tracking-wide ${
                  sourceMode === "upload" ? "text-white/80" : "text-white/40"
                }`}
              >
                Direct file
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSourceMode("youtube")
                setValidationHint("")
              }}
              className={`rounded-lg px-3 py-2.5 text-left text-sm transition ${
                sourceMode === "youtube"
                  ? "bg-purple-600 text-white shadow-[0_12px_28px_-18px_rgba(147,51,234,0.85)] ring-1 ring-white/15"
                  : "text-white/70 hover:bg-white/5"
              }`}
            >
              <span className="block font-semibold">YouTube link</span>
              <span
                className={`mt-0.5 block text-[10px] font-medium uppercase tracking-wide ${
                  sourceMode === "youtube" ? "text-white/80" : "text-emerald-300/90"
                }`}
              >
                Server-managed
              </span>
            </button>
          </div>
          <div className="mt-4">
            {sourceMode === "upload" ? (
              <>
                <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
                  Video file
                </label>
                <input
                  type="file"
                  accept="video/*,.mp4,.mov,.webm,.mkv,.m4v"
                  className="block w-full text-sm text-white/80 file:mr-3 file:rounded-lg file:border-0 file:bg-purple-600 file:px-3 file:py-2 file:text-white"
                  onChange={(e) => setVideo(e.target.files?.[0] || null)}
                />
                {video && (
                  <p className="mt-2 text-xs text-emerald-300">
                    {video.name} · {(video.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                )}
                <p className="mt-2 text-xs leading-relaxed text-white/50">
                  Sent over HTTPS and used only to run this Clipper job — the same pipeline as uploads elsewhere in
                  NovaPulseAI.
                </p>
              </>
            ) : (
              <>
                <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
                  YouTube URL
                </label>
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://www.youtube.com/watch?v=…"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  className="w-full rounded-lg border border-white/15 bg-black/30 p-2.5 text-white placeholder:text-white/35"
                />
                <div className="mt-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-200/85">
                    Server-managed ingest
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-white/65">
                    NovaPulse downloads the video from this link on our servers and feeds it straight into the clip
                    pipeline — you do not need to upload anything. If YouTube rejects the link on our side (bot
                    check, geo block, private / age-gated content), we will surface a clear reason and offer an
                    upload fallback then.
                  </p>
                </div>
              </>
            )}
          </div>
          <p className="mt-2 text-xs text-white/45">
            Jobs run server-side. This panel controls packaging style only.
          </p>
        </section>

        {packAngleHint && (
          <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-3 text-sm text-white/80">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200/90">
              Clip angle (from content pack)
            </p>
            <p className="mt-2 whitespace-pre-wrap text-white/75">{packAngleHint}</p>
            <p className="mt-2 text-xs text-white/45">
              Paste your long-form source above, then let this angle guide which beats to favor in the edit.
            </p>
          </div>
        )}

        <section className="np-card p-5 md:p-6">
          <div className="mb-5 flex items-start gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-2">
              <Palette className="h-4 w-4 text-white/75" aria-hidden />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-[-0.01em] text-white/92">
                Choose Clip Format
              </h3>
              <p className="mt-1 text-xs text-white/55">
                Pick a packaging format first, then fine-tune only what matters.
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {clipTypeOptions.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => applyClipTypePreset(preset.value, true)}
                className={`rounded-xl border p-3 text-left transition ${
                  clipTypePreset === preset.value
                    ? "border-purple-400/55 bg-purple-500/12 shadow-[0_16px_30px_-24px_rgba(167,139,250,0.8)]"
                    : "border-white/10 bg-black/25 hover:border-white/25 hover:bg-white/[0.06]"
                }`}
              >
                <div
                  className={`relative mb-3 h-20 overflow-hidden rounded-lg border border-white/15 bg-gradient-to-br ${
                    clipTypeVisuals[preset.value].frameTone
                  }`}
                >
                  <div className="absolute inset-x-3 top-2 flex items-center justify-between">
                    <span className="rounded-full bg-black/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/75">
                      {clipTypeVisuals[preset.value].chip}
                    </span>
                    <span
                      className="h-1.5 w-8 rounded-full"
                      style={{ backgroundColor: clipTypeVisuals[preset.value].accent }}
                    />
                  </div>
                  <div className={`absolute inset-x-3 ${clipTypeVisuals[preset.value].captionY}`}>
                    <p
                      className="inline-block rounded px-2 py-1 text-[10px] font-semibold tracking-wide text-white"
                      style={{ backgroundColor: "rgba(0,0,0,0.48)" }}
                    >
                      {clipTypeVisuals[preset.value].captionText}
                    </p>
                  </div>
                </div>
                <p className="text-sm font-semibold text-white">{preset.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/60">{preset.useCase}</p>
              </button>
            ))}
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
                Number of clips
              </label>
              <input
                type="number"
                value={clips}
                min={1}
                max={20}
                onChange={(e) =>
                  setClips(Math.min(20, Math.max(1, Number(e.target.value) || 1)))
                }
                className="np-select w-full"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
                Clip length
              </label>
              <select
                value={clipLengthPreset}
                onChange={(e) => setClipLengthPreset(e.target.value as LengthPreset)}
                className="np-select w-full"
              >
                <option value="15">15 seconds</option>
                <option value="30">30 seconds</option>
                <option value="45">45 seconds</option>
                <option value="60">60 seconds</option>
                <option value="custom">Custom…</option>
              </select>
              {clipLengthPreset === "custom" && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={customClipLengthSec}
                    onChange={(e) => setCustomClipLengthSec(Number(e.target.value) || 5)}
                    className="w-28 rounded-lg border border-white/15 bg-black/30 p-2 text-white"
                  />
                  <span className="text-xs text-white/50">seconds (5–120)</span>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="np-card p-5 md:p-6">
          <div className="mb-5 flex items-start gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-2">
              <Captions className="h-4 w-4 text-white/75" aria-hidden />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-[-0.01em] text-white/92">
                Caption Style
              </h3>
              <p className="mt-1 text-xs text-white/55">
                Choose the caption treatment you want viewers to feel.
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {captionOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setCaptionStylePreset(opt.value)
                  setStyleCustomized(true)
                }}
                className={`rounded-xl border p-3 text-left transition ${
                  captionStylePreset === opt.value
                    ? "border-purple-400/55 bg-purple-500/12"
                    : "border-white/10 bg-black/25 hover:border-white/25 hover:bg-white/[0.06]"
                }`}
              >
                <div className="mb-2 h-12 rounded-md border border-white/15 bg-black/40 p-2">
                  <p
                    className={`line-clamp-2 ${
                      opt.value === "bold_viral"
                        ? "text-[11px] font-extrabold uppercase tracking-wide"
                        : opt.value === "highlight_words"
                          ? "text-[11px] font-semibold"
                          : opt.value === "subtitle_style"
                            ? "text-[10px] font-medium"
                            : "text-[11px] font-medium"
                    }`}
                    style={{
                      color:
                        opt.value === "highlight_words"
                          ? "#FDE047"
                          : opt.value === "subtitle_style"
                            ? "#E5E7EB"
                            : "#FFFFFF",
                    }}
                  >
                    {opt.value === "bold_viral"
                      ? "THIS PART HOOKS VIEWERS"
                      : opt.value === "highlight_words"
                        ? "This line highlights key conversion words"
                        : opt.value === "subtitle_style"
                          ? "Clean subtitle rhythm for longer speaking beats."
                          : "Balanced and clean caption treatment."}
                  </p>
                </div>
                <p className="text-xs font-semibold uppercase tracking-wide text-white/90">
                  {opt.label}
                </p>
                <p className="mt-1 text-[11px] text-white/55">{opt.visualSample}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="np-card-soft p-5 md:p-6">
          <div className="mb-3 flex items-start gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-2">
              <Sparkles className="h-4 w-4 text-white/75" aria-hidden />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-[-0.01em] text-white/90">
                Live Style Preview
              </h3>
              <p className="mt-1 text-xs text-white/55">
                UI-only mock preview of your packaging style (not a real frame render).
              </p>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-[#080c18] p-4 shadow-[0_24px_60px_-40px_rgba(0,0,0,0.95)]">
            <div
              className={`relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br ${clipTypeVisuals[clipTypePreset].frameTone} p-4`}
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(255,255,255,0.12),transparent_45%)]" />
              <div className="relative mb-12 flex items-center justify-between">
                <span className="rounded-full border border-white/20 bg-black/35 px-2.5 py-1 text-[11px] font-medium text-white/90">
                  {activeClipType?.label ?? "Clip format"}
                </span>
                <span
                  className="rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-black"
                  style={{ backgroundColor: clipTypeVisuals[clipTypePreset].accent }}
                >
                  {clipTypeVisuals[clipTypePreset].chip}
                </span>
              </div>
              {clipTypePreset === "streamer" && (
                <div className="relative mb-3 flex items-center justify-between rounded-lg border border-white/20 bg-black/35 px-3 py-2 text-xs text-white/85">
                  <span>{streamerName.trim() || "Streamer Name"}</span>
                  <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                    {streamPlatform}
                  </span>
                </div>
              )}
              <div className="relative rounded-lg border border-white/10 bg-black/25 p-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-white/55">
                  {clipTypeVisuals[clipTypePreset].overlay}
                </p>
                <p
                  className={`mt-2 max-w-[92%] rounded-md px-2.5 py-1.5 ${
                    captionStylePreset === "bold_viral"
                      ? "text-sm font-extrabold uppercase tracking-wide"
                      : captionStylePreset === "highlight_words"
                        ? "text-sm font-semibold"
                        : captionStylePreset === "subtitle_style"
                          ? "text-xs font-medium"
                          : "text-sm font-medium"
                  }`}
                  style={{
                    color:
                      captionColorTheme === "custom"
                        ? captionCustomColor
                        : captionColorTheme === "yellow"
                          ? "#FDE047"
                          : captionColorTheme === "green"
                            ? "#86EFAC"
                            : captionColorTheme === "purple"
                              ? "#C4B5FD"
                              : "#FFFFFF",
                    backgroundColor:
                      captionStylePreset === "clean_minimal"
                        ? "rgba(0,0,0,0.2)"
                        : "rgba(0,0,0,0.55)",
                  }}
                >
                  {clipTypeVisuals[clipTypePreset].captionText}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/70">
              <span className="rounded-full border border-white/15 bg-black/35 px-2 py-1">
                Layout: {clipLayoutPreset.replace("_", " ")}
              </span>
              <span className="rounded-full border border-white/15 bg-black/35 px-2 py-1">
                Captions: {activeCaptionOption?.label ?? "Custom"}
              </span>
              <span className="rounded-full border border-white/15 bg-black/35 px-2 py-1">
                Accent: {captionColorTheme === "custom" ? captionCustomColor : captionColorTheme}
              </span>
            </div>
          </div>
          <p className="mt-3 text-xs text-white/45">
            Preview is high-fidelity UI guidance only. The backend job flow and render pipeline remain unchanged.
          </p>
        </section>

        <section className="np-card p-5 md:p-6">
          <button
            type="button"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left"
          >
            <span>
              <span className="block text-sm font-semibold text-white/90">Advanced settings</span>
              <span className="text-xs text-white/50">
                Platform defaults, output behavior, accents, and diagnostics.
              </span>
            </span>
            <span className="text-xs text-white/60">{showAdvanced ? "Hide" : "Show"}</span>
          </button>
          {showAdvanced && (
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
                    Target platform
                  </label>
                  <select
                    value={platform}
                    onChange={(e) => {
                      setPlatform(e.target.value as "tiktok" | "instagram" | "youtube")
                      setStyleCustomized(false)
                    }}
                    className="np-select w-full"
                  >
                    <option value="tiktok">TikTok</option>
                    <option value="instagram">Instagram Reels</option>
                    <option value="youtube">YouTube Shorts</option>
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
                    Caption color theme
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {(["white", "yellow", "green", "purple", "custom"] as CaptionColorTheme[]).map((theme) => (
                      <button
                        key={theme}
                        type="button"
                        onClick={() => {
                          setCaptionColorTheme(theme)
                          setStyleCustomized(true)
                        }}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition ${
                          captionColorTheme === theme
                            ? "border-purple-400/45 bg-purple-500/20 text-white"
                            : "border-white/15 bg-black/20 text-white/75 hover:border-white/25 hover:bg-white/5"
                        }`}
                      >
                        {theme}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {captionColorTheme === "custom" && (
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
                    Custom accent color
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={captionCustomColor}
                      onChange={(e) => {
                        setCaptionCustomColor(e.target.value)
                        setStyleCustomized(true)
                      }}
                      className="h-9 w-12 rounded-md border border-white/20 bg-transparent"
                    />
                    <span className="text-xs text-white/55">{captionCustomColor}</span>
                  </div>
                </div>
              )}
              {clipTypePreset === "streamer" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
                      Streamer name
                    </label>
                    <input
                      type="text"
                      value={streamerName}
                      onChange={(e) => setStreamerName(e.target.value)}
                      placeholder="e.g. NovaPulseLive"
                      className="w-full rounded-lg border border-white/15 bg-black/30 p-2.5 text-white placeholder:text-white/35"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
                      Stream platform
                    </label>
                    <select
                      value={streamPlatform}
                      onChange={(e) => setStreamPlatform(e.target.value as StreamPlatform)}
                      className="np-select w-full"
                    >
                      <option value="kick">Kick</option>
                      <option value="twitch">Twitch</option>
                      <option value="youtube">YouTube</option>
                    </select>
                  </div>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={captionsEnabled}
                    onChange={(e) => setCaptionsEnabled(e.target.checked)}
                  />
                  <span>
                    <span className="block text-sm font-medium text-white">Captions enabled</span>
                    <span className="text-xs text-white/50">
                      If disabled, clips still export but subtitle files are skipped.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={showTimestamps}
                    onChange={(e) => setShowTimestamps(e.target.checked)}
                  />
                  <span>
                    <span className="block text-sm font-medium text-white">Timestamp helpers</span>
                    <span className="text-xs text-white/50">
                      Include source timecodes in result metadata for editing handoff.
                    </span>
                  </span>
                </label>
              </div>
              {captionsEnabled && (
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
                    Caption output
                  </label>
                  <select
                    value={captionMode}
                    onChange={(e) =>
                      setCaptionMode(e.target.value as "burn" | "srt" | "both")
                    }
                    className="np-select w-full"
                  >
                    <option value="both">Burned-in + downloadable SRT</option>
                    <option value="burn">Burned-in only (no sidecar file)</option>
                    <option value="srt">SRT only (clean MP4 + subtitles file)</option>
                  </select>
                </div>
              )}
              <button
                type="button"
                onClick={() => setStyleCustomized(false)}
                className="np-btn np-btn-chip"
              >
                Re-apply platform defaults
              </button>
            </div>
          )}
        </section>

        <section className="np-card p-5 md:p-6">
          <div className="mb-4 flex items-start gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-2">
              <Clapperboard className="h-4 w-4 text-white/75" aria-hidden />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-[-0.01em] text-white/92">
                Output
              </h3>
              <p className="mt-1 text-xs text-white/55">
                Start the job and monitor each stage while clips are packaged on the server.
              </p>
            </div>
          </div>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading}
          className="w-full rounded-lg bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {loading ? "Start clip job…" : "Start clip job"}
        </button>

        {loading && (
          <div className="space-y-2 text-sm text-purple-200">
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-[width] duration-500"
                style={{ width: `${Math.min(100, Math.max(4, jobProgress))}%` }}
              />
            </div>
            <div>
              {stageLabel || "Working…"}{" "}
              <span className="text-white/60">
                · {jobProgress}% · {elapsedSeconds}s elapsed
              </span>
            </div>
            <p className="text-xs text-white/50">
              The browser only polls status — heavy work runs on the server. Safe to switch tabs; keep this session
              logged in.
            </p>
          </div>
        )}

        {validationHint && <div className="text-sm text-amber-300">{validationHint}</div>}
        {infoMessage && (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {infoMessage}
          </div>
        )}
        {repeatUsageCount >= 3 && (
          <div className="text-sm text-purple-200">
            Heavy clipping session — higher plans keep this workflow fast at volume.
            <a href="/pricing" className="ml-2 underline">
              Compare plans
            </a>
          </div>
        )}

        {error &&
          (clipperErrorIsYoutubePremiumFailure(error) ? (
            <div className="overflow-hidden rounded-2xl border border-white/12 bg-gradient-to-b from-white/[0.07] to-black/25 shadow-[0_24px_50px_-28px_rgba(0,0,0,0.85)] ring-1 ring-amber-500/15">
              <div className="flex gap-3 border-b border-white/10 bg-amber-500/[0.06] px-4 py-3">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-200/90" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/80">
                    {clipperErrorIsYoutubeJsCategory(error)
                      ? "YouTube playback limit"
                      : clipperErrorIsYoutubeCookiesIssueCategory(error)
                        ? error === CLIP_UI_YOUTUBE_COOKIES_BAD
                          ? "YouTube session file"
                          : "YouTube server session"
                        : "YouTube blocked for servers"}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white/95">We could not ingest this YouTube source</p>
                </div>
              </div>
              <div className="space-y-3 px-4 py-4">
                <p className="text-sm leading-relaxed text-white/78">{error}</p>
                <p className="text-xs leading-relaxed text-white/48">
                  {clipperErrorIsYoutubeJsCategory(error)
                    ? "Some links require a full browser playback stack. That is a platform limitation on our side, not a billing or account issue."
                    : clipperErrorIsYoutubeCookiesIssueCategory(error)
                      ? error === CLIP_UI_YOUTUBE_COOKIES_BAD
                        ? "Operators should refresh the signed-in browser cookies export on the API host. End users can always upload the file instead."
                        : "Operators can add a Netscape-format cookies export from a logged-in browser (internal operator docs). Upload stays the fastest sure path."
                      : "Bot checks and datacenter blocks are common. Your link may still play in a normal browser; a configured operator session often improves success."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSourceMode("upload")
                      setError("")
                      setValidationHint("")
                    }}
                    className="rounded-lg bg-purple-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-purple-500"
                  >
                    Switch to Upload video
                  </button>
                  <button
                    type="button"
                    onClick={() => void generate()}
                    className="rounded-lg border border-white/18 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-white/85 transition hover:bg-white/[0.08]"
                  >
                    Retry same source
                  </button>
                </div>
                {lastFailureRequestId ? (
                  <p className="text-[11px] text-white/38">Request ID: {lastFailureRequestId}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-sm text-red-400">
              {error}
              {lastFailureRequestId ? ` (Request ID: ${lastFailureRequestId})` : ""}
              <div>
                <button
                  type="button"
                  onClick={() => void generate()}
                  className="rounded-lg border border-red-300/30 bg-red-500/15 px-3 py-1 text-xs text-red-100 hover:bg-red-500/25"
                >
                  Retry
                </button>
              </div>
            </div>
          ))}
        </section>
      </div>

      {results.length > 0 && (
        <ClipperResultsPanel
          results={results}
          qualitySignals={qualitySignals}
          contextId={requestContextId}
          showTimestamps={showTimestamps}
          jobSummary={jobSummary}
          onRegenerate={() => void generate()}
        />
      )}

      {!loading && results.length === 0 && !error && (
        <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/60">
          Start a job to generate vertical clips with timestamps and optional captions. Processing is asynchronous — the
          UI will stream progress while the server ingests, analyzes, trims, and packages outputs.
        </div>
      )}
      <UpgradeModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        message="Clipper is available on paid plans with the Clipper tool enabled."
        currentPlan={entitlement?.normalizedPlan}
        requiredPlan={clipAccess?.minimumPlan ?? "STARTER"}
        benefits={[
          "Automated moment detection and trim",
          "Vertical exports for short-form platforms",
          "Caption pipeline for faster publishing",
        ]}
      />
    </ToolPageShell>
  )
}
