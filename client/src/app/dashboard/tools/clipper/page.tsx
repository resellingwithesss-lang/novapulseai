"use client"

import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import {
  Captions,
  Clapperboard,
  Palette,
  SlidersHorizontal,
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
  type StreamPlatform = "kick" | "twitch" | "youtube"
  type CaptionStylePreset =
    | "clean_minimal"
    | "bold_viral"
    | "highlight_words"
    | "subtitle_style"
    | "high_contrast"
  type CaptionColorTheme = "white" | "yellow" | "green" | "purple" | "custom"
  type LayoutOption = {
    value: ClipLayoutPreset
    label: string
    description: string
  }
  type CaptionOption = {
    value: CaptionStylePreset
    label: string
    description: string
  }

  const searchParams = useSearchParams()
  const { entitlement } = useEntitlementSnapshot()
  const [sourceMode, setSourceMode] = useState<"upload" | "youtube">("upload")
  const [video, setVideo] = useState<File | null>(null)
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const [clips, setClips] = useState(5)
  const [platform, setPlatform] = useState<"tiktok" | "instagram" | "youtube">("tiktok")
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
  const [qualitySignals, setQualitySignals] = useState<string[]>([])
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [lastFailureRequestId, setLastFailureRequestId] = useState<string | null>(null)
  const [repeatUsageCount, setRepeatUsageCount] = useState(0)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [packAngleHint, setPackAngleHint] = useState("")
  const normalizeHex = (value: string) => {
    const trimmed = value.trim()
    return /^#[0-9A-Fa-f]{6}$/.test(trimmed) ? trimmed.toUpperCase() : null
  }
  const layoutOptions: LayoutOption[] = [
    {
      value: "clean",
      label: "Clean",
      description: "Pure clip output with no branding overlays.",
    },
    {
      value: "stream_overlay",
      label: "Creator Stream Overlay",
      description: "Identity bar treatment for streamer-style packaging.",
    },
    {
      value: "reaction_style",
      label: "Reaction Focus",
      description: "Text-forward framing tuned for reaction edits.",
    },
    {
      value: "podcast_clip",
      label: "Podcast Subtitles",
      description: "Conversation-friendly layout with subtitle emphasis.",
    },
    {
      value: "gaming_style",
      label: "Gaming Impact",
      description: "High-contrast treatment for fast gameplay pacing.",
    },
  ]

  const captionOptions: CaptionOption[] = [
    {
      value: "clean_minimal",
      label: "Clean Minimal",
      description: "Low-noise, lightweight captions for polished edits.",
    },
    {
      value: "bold_viral",
      label: "Bold Viral",
      description: "Large punchy words optimized for short-form retention.",
    },
    {
      value: "highlight_words",
      label: "Highlight Words",
      description: "Key terms pop to reinforce hooks and payoff moments.",
    },
    {
      value: "subtitle_style",
      label: "Subtitle Style",
      description: "Classic subtitle rhythm for long sentence readability.",
    },
    {
      value: "high_contrast",
      label: "High Contrast",
      description: "Maximum readability for noisy or low-light footage.",
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

  const captionStyleHelper = (() => {
    switch (captionStylePreset) {
      case "clean_minimal":
        return "Lightweight lower-third captions with minimal decoration."
      case "bold_viral":
        return "Large, punchy captions optimized for short-form thumb-stop moments."
      case "highlight_words":
        return "Key words pop with stronger emphasis to improve retention."
      case "subtitle_style":
        return "Traditional subtitle treatment with cleaner rhythm."
      case "high_contrast":
        return "Maximum readability treatment for noisy or fast visuals."
      default:
        return ""
    }
  })()

  const layoutHelper = (() => {
    switch (clipLayoutPreset) {
      case "clean":
        return "No extra overlays; pure clip with your caption treatment."
      case "stream_overlay":
        return "Adds streamer-style name bar treatment for creator identity."
      case "reaction_style":
        return "Optimized for reaction framing with text-forward pacing."
      case "podcast_clip":
        return "Centered conversational framing with subtitle-first readability."
      case "gaming_style":
        return "High-contrast treatment suited for fast, energetic gameplay edits."
      default:
        return ""
    }
  })()

  useEffect(() => {
    const source = searchParams.get("source")
    const platformParam = searchParams.get("platform")
    const clipsParam = searchParams.get("clips")
    const subtitleParam = searchParams.get("subtitleStyle")
    const context = searchParams.get("contextId")

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
    const clipAngle = searchParams.get("clipAngle")
    if (clipAngle?.trim()) {
      setPackAngleHint(clipAngle.trim())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (styleCustomized) return
    if (platform === "tiktok") {
      setClipLayoutPreset("reaction_style")
      setCaptionStylePreset("bold_viral")
      setCaptionColorTheme("yellow")
      return
    }
    if (platform === "youtube") {
      setClipLayoutPreset("podcast_clip")
      setCaptionStylePreset("subtitle_style")
      setCaptionColorTheme("white")
      return
    }
    setClipLayoutPreset("clean")
    setCaptionStylePreset("clean_minimal")
    setCaptionColorTheme("white")
  }, [platform, styleCustomized])

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
      const validYoutubeUrl = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(
        normalizedUrl
      )
      if (!normalizedUrl || !validYoutubeUrl) {
        setValidationHint("Use a valid YouTube URL (youtube.com or youtu.be).")
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

      const enqueued = await api.post<CreateClipJobResponse>("/clip/create", formData, {
        timeout: 120_000,
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
        setError(msg || "Clip job failed.")
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
      guidance="Jobs run asynchronously on the server (no long browser hang). You will see live stages: ingest → analyze → trim → captions → finalize. Upload files up to 512MB or paste a public YouTube URL."
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
                Choose one long-form source. Jobs run server-side and stream status updates here.
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
              className={`rounded-lg px-3 py-2 text-sm transition ${
                sourceMode === "upload"
                  ? "bg-purple-600 text-white"
                  : "text-white/70 hover:bg-white/5"
              }`}
            >
              Upload video
            </button>
            <button
              type="button"
              onClick={() => {
                setSourceMode("youtube")
                setValidationHint("")
              }}
              className={`rounded-lg px-3 py-2 text-sm transition ${
                sourceMode === "youtube"
                  ? "bg-purple-600 text-white"
                  : "text-white/70 hover:bg-white/5"
              }`}
            >
              YouTube link
            </button>
          </div>
          <p className="mt-2 text-xs text-white/45">
            Only one source is used per run — upload takes priority if both were ever present.
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
              <SlidersHorizontal className="h-4 w-4 text-white/75" aria-hidden />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-[-0.01em] text-white/92">
                Clip Settings
              </h3>
              <p className="mt-1 text-xs text-white/55">
                Control platform target, count, and clip length strategy.
              </p>
            </div>
          </div>
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
            </>
          )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
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
              className="w-full rounded-lg border border-white/15 bg-black/30 p-2.5 text-white"
            >
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram Reels</option>
              <option value="youtube">YouTube Shorts</option>
            </select>
          </div>
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
              className="w-full rounded-lg border border-white/15 bg-black/30 p-2.5 text-white"
            />
            <p className="mt-2 text-xs text-white/45">
              More clips increase processing time and can reduce per-clip selectivity.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
            Clip length
          </label>
          <select
            value={clipLengthPreset}
            onChange={(e) => setClipLengthPreset(e.target.value as LengthPreset)}
            className="w-full rounded-lg border border-white/15 bg-black/30 p-2.5 text-white"
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
          <p className="mt-2 text-xs text-white/45">
            Each clip is trimmed toward this length. If the source is shorter than your target, we return the best-fit
            segment.
          </p>
        </div>
        </section>

        <section className="np-card p-5 md:p-6">
          <div className="mb-5 flex items-start gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-2">
              <Palette className="h-4 w-4 text-white/75" aria-hidden />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-[-0.01em] text-white/92">
                Visual Style
              </h3>
              <p className="mt-1 text-xs text-white/55">
                Choose how packaged clips should look in the final output style pass.
              </p>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
              Clip Style
            </label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {layoutOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setClipLayoutPreset(opt.value)
                    setStyleCustomized(true)
                  }}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    clipLayoutPreset === opt.value
                      ? "border-purple-400/50 bg-purple-500/15 text-white"
                      : "border-white/10 bg-black/25 text-white/80 hover:border-white/20 hover:bg-white/5"
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide">
                    {opt.label}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/55">
                    {opt.description}
                  </p>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-white/45">
              {layoutHelper} Smart defaults follow the selected platform until you customize.
            </p>
          </div>
          {clipLayoutPreset === "stream_overlay" && (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 sm:p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/60">
                Stream overlay details
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
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
                    className="w-full rounded-lg border border-white/15 bg-black/30 p-2.5 text-white"
                  >
                    <option value="kick">Kick</option>
                    <option value="twitch">Twitch</option>
                    <option value="youtube">YouTube</option>
                  </select>
                </div>
              </div>
              <p className="mt-3 text-xs text-white/45">
                Overlay text is stored with the job as packaging intent for future render styling.
              </p>
            </div>
          )}
        </section>

        <section className="np-card p-5 md:p-6">
          <div className="mb-5 flex items-start gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-2">
              <Captions className="h-4 w-4 text-white/75" aria-hidden />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-[-0.01em] text-white/92">
                Captions
              </h3>
              <p className="mt-1 text-xs text-white/55">
                Tune caption style, contrast, and export behavior.
              </p>
            </div>
          </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={captionsEnabled}
              onChange={(e) => setCaptionsEnabled(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium text-white">Captions</span>
              <span className="text-xs text-white/50">
                Burn subtitles into the video. YouTube links prefer auto-captions when available; uploads use speech
                recognition.
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
                Show copyable source timecodes on each result (metadata from the original video).
              </span>
            </span>
          </label>
        </div>

        <div className="mt-4">
          <label className="mb-2 block text-xs uppercase tracking-wide text-white/60">
            Caption style
          </label>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {captionOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setCaptionStylePreset(opt.value)
                  setStyleCustomized(true)
                }}
                className={`rounded-lg border px-3 py-2 text-left transition ${
                  captionStylePreset === opt.value
                    ? "border-purple-400/50 bg-purple-500/15 text-white"
                    : "border-white/10 bg-black/25 text-white/80 hover:border-white/20 hover:bg-white/5"
                }`}
              >
                <p className="text-xs font-semibold uppercase tracking-wide">
                  {opt.label}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/55">
                  {opt.description}
                </p>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-white/45">{captionStyleHelper}</p>
        </div>

        <div className="mt-4">
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
          {captionColorTheme === "custom" && (
            <div className="mt-2 flex items-center gap-3">
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
          )}
          <button
            type="button"
            onClick={() => setStyleCustomized(false)}
            className="np-btn np-btn-chip mt-3"
          >
            Re-apply platform defaults
          </button>
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
              className="w-full rounded-lg border border-white/15 bg-black/30 p-2.5 text-white"
            >
              <option value="both">Burned-in + downloadable SRT</option>
              <option value="burn">Burned-in only (no sidecar file)</option>
              <option value="srt">SRT only (clean MP4 + subtitles file)</option>
            </select>
            <p className="mt-2 text-xs text-white/45">
              YouTube sources prefer official/auto transcripts when available; otherwise we fall back to speech-to-text.
              Caption issues never cancel the whole job — you still get trimmed clips.
            </p>
          </div>
        )}
        </section>

        <section className="np-card-soft p-5 md:p-6">
          <div className="mb-3 flex items-start gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-2">
              <Sparkles className="h-4 w-4 text-white/75" aria-hidden />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-[-0.01em] text-white/90">
                Style Preview
              </h3>
              <p className="mt-1 text-xs text-white/55">
                Visual intent preview only — final rendering still uses your selected packaging pipeline.
              </p>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/40 p-4">
            {clipLayoutPreset === "stream_overlay" && (
              <div className="mb-3 flex items-center justify-between rounded-md border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] uppercase tracking-wide text-white/80">
                <span>{streamerName.trim() || "Streamer Name"}</span>
                <span className="text-white/60">{streamPlatform.toUpperCase()}</span>
              </div>
            )}
            <div className="h-24 rounded-lg bg-gradient-to-br from-white/10 via-white/5 to-transparent" />
            <div className="mt-3 space-y-2">
              <div
                className="inline-flex rounded px-2 py-1 text-xs font-semibold"
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
                  background:
                    captionStylePreset === "clean_minimal"
                      ? "transparent"
                      : "rgba(0,0,0,0.45)",
                }}
              >
                {captionStylePreset.replace("_", " ").replace(/\b\w/g, (m) => m.toUpperCase())}
              </div>
              <p className="text-xs text-white/55">
                Layout: {layoutOptions.find((opt) => opt.value === clipLayoutPreset)?.label ?? clipLayoutPreset}
                {" · "}
                Caption style: {captionOptions.find((opt) => opt.value === captionStylePreset)?.label ?? captionStylePreset}
                {" · "}
                Theme: {captionColorTheme === "custom" ? "Custom" : captionColorTheme}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-white/45">
            Preview is a style summary, not a rendered frame. Final output still depends on source content and job pipeline.
          </p>
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

        {error && (
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
        )}
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
