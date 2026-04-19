"use client"

import { useCallback, useState } from "react"
import { buildToolHandoffUrl } from "@/lib/tool-handoff"
import ToolResultLayout from "@/components/tools/results/ToolResultLayout"
import {
  downloadMediaBlob,
  filenameFromPublicPath,
  toAbsoluteMediaUrl,
  toDirectApiMediaUrl,
} from "@/lib/mediaOrigin"
import ClipPreviewVideo from "./ClipPreviewVideo"

type ClipCaptionStatus =
  | "burned_in"
  | "srt_only"
  | "skipped_disabled"
  | "skipped_empty"
  | "failed"

type ClipCaptionSource =
  | "youtube_transcript"
  | "whisper"
  | "none"
  | "unavailable"

type ClipItem = {
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

type JobSummary = {
  partial: boolean
  requestedClips: number
  generatedClips: number
  targetClipDurationSec: number
}

type ClipperResultsPanelProps = {
  results: ClipItem[]
  qualitySignals?: string[]
  contextId?: string
  showTimestamps?: boolean
  jobSummary?: JobSummary | null
  onRegenerate?: () => void
}

function formatSeconds(seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds))
  const mins = Math.floor(sec / 60)
  const rem = sec % 60
  return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`
}

function captionStatusLabel(status?: ClipCaptionStatus): string {
  switch (status) {
    case "burned_in":
      return "Burned into video"
    case "srt_only":
      return "SRT sidecar (clean video)"
    case "skipped_disabled":
      return "Off"
    case "skipped_empty":
      return "No speech in window"
    case "failed":
      return "Caption step failed"
    default:
      return "—"
  }
}

function captionSourceLabel(src?: ClipCaptionSource): string {
  switch (src) {
    case "youtube_transcript":
      return "YouTube transcript"
    case "whisper":
      return "Speech-to-text (Whisper)"
    case "unavailable":
      return "Unavailable"
    case "none":
    default:
      return "—"
  }
}

function sourceLabel(t?: "upload" | "youtube"): string {
  if (t === "youtube") return "YouTube"
  if (t === "upload") return "Upload"
  return "—"
}

export default function ClipperResultsPanel({
  results,
  qualitySignals = [],
  contextId = "",
  showTimestamps = true,
  jobSummary = null,
  onRegenerate,
}: ClipperResultsPanelProps) {
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const topClip = results[0]
  const topClipFetchUrl = topClip ? toAbsoluteMediaUrl(topClip.publicPath) : null
  const topClipOpenUrl = topClip ? toDirectApiMediaUrl(topClip.publicPath) : null
  const topClipFilename = topClip ? filenameFromPublicPath(topClip.publicPath) : "clip.mp4"

  const runDownload = useCallback(async (absoluteUrl: string, filename: string) => {
    setDownloadError(null)
    try {
      await downloadMediaBlob(absoluteUrl, filename)
    } catch (e) {
      setDownloadError(
        e instanceof Error ? e.message : "Could not download file. Try Open in a new tab."
      )
    }
  }, [])

  const copyTimestamps = useCallback(
    async (clip: ClipItem) => {
      const line =
        clip.timestampRangeLabel ||
        `${formatSeconds(clip.startSec)}–${formatSeconds(clip.endSec)} (source)`
      try {
        await navigator.clipboard.writeText(line)
      } catch {
        /* ignore */
      }
    },
    []
  )

  return (
    <ToolResultLayout
      title="Clip job output"
      state={results.length > 0 ? "success" : "empty"}
      statusLabel={results.length > 0 ? `${results.length} clips` : "No clips"}
      summary="Vertical 9:16 renders with source timecodes. Captions are labeled by source (transcript vs speech-to-text)."
      emptyMessage="No clips were generated. Try a longer source, fewer clips, or a shorter target length."
      keyOutputs={[
        {
          label: "Top score",
          value: results.length > 0 ? `${Math.round(results[0].score)}/100` : "—",
        },
        {
          label: "Delivered",
          value: jobSummary
            ? `${jobSummary.generatedClips}/${jobSummary.requestedClips}`
            : `${results.length}`,
        },
        {
          label: "Target length",
          value: jobSummary ? `${jobSummary.targetClipDurationSec}s` : "—",
        },
      ]}
      actions={[
        topClipFetchUrl
          ? {
              label: "Download top clip",
              onClick: () => void runDownload(topClipFetchUrl, topClipFilename),
            }
          : { label: "Open Clipper", href: "/dashboard/tools/clipper" },
        topClipOpenUrl
          ? {
              label: "Preview top clip",
              href: topClipOpenUrl,
              external: true,
              tone: "secondary",
            }
          : {
              label: "Prompt Intelligence",
              href: "/dashboard/tools/prompt",
              tone: "secondary",
            },
      ]}
      recoveryActions={[
        { label: "New clip run", href: "/dashboard/tools/clipper" },
        ...(onRegenerate
          ? [
              {
                label: "Regenerate with same settings",
                onClick: onRegenerate,
                tone: "secondary" as const,
              },
            ]
          : []),
      ]}
      nextSteps={[
        { label: "Story Maker", href: "/dashboard/tools/story-maker" },
        { label: "Video Script", href: "/dashboard/tools/video" },
        { label: "AI Ad Generator", href: "/dashboard/tools/ai-ad-generator" },
      ]}
    >
      {jobSummary?.partial && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <span className="font-medium">Partial delivery:</span> generated{" "}
          <strong>{jobSummary.generatedClips}</strong> of{" "}
          <strong>{jobSummary.requestedClips}</strong> clips at ~{jobSummary.targetClipDurationSec}s — the source could
          not support more non-overlapping windows.
        </div>
      )}

      <p className="mb-4 text-xs text-white/45">
        Hand off timestamps and titles into Story Maker or Prompt Intelligence. AI Ad Generator uses a product URL, so
        this handoff passes clip text as a creative brief only.
      </p>
      {downloadError && (
        <div
          className="mb-4 rounded-xl border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-200"
          role="alert"
        >
          {downloadError}
        </div>
      )}

      {qualitySignals.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {qualitySignals.map((signal) => (
            <span
              key={signal}
              className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200"
            >
              {signal.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {results.map((clip, i) => {
          const url = toAbsoluteMediaUrl(clip.publicPath)
          const openUrl = toDirectApiMediaUrl(clip.publicPath)
          const srtUrl = clip.subtitlePublicPath
            ? toAbsoluteMediaUrl(clip.subtitlePublicPath)
            : null
          const mp4Name = filenameFromPublicPath(clip.publicPath)
          const srtName = clip.subtitlePublicPath
            ? filenameFromPublicPath(clip.subtitlePublicPath)
            : "captions.srt"
          const storyHandoff = buildToolHandoffUrl("/dashboard/tools/story-maker", {
            topic:
              clip.title ||
              `Clip ${clip.index + 1} (${formatSeconds(clip.startSec)} – ${formatSeconds(clip.endSec)})`,
            contextId: contextId || undefined,
          })
          const promptHandoff = buildToolHandoffUrl("/dashboard/tools/prompt", {
            topic: clip.summary || clip.title || `Clip ${clip.index + 1}`,
            contextId: contextId || undefined,
          })
          const storyVideoHandoff = buildToolHandoffUrl("/dashboard/tools/ai-ad-generator", {
            videoBrief:
              clip.summary ||
              clip.title ||
              `Clip ${clip.index + 1} · ${clip.timestampRangeLabel || ""}`,
            sourceGenerationId: contextId || undefined,
            sourceType: contextId ? "GENERATION" : undefined,
          })

          return (
            <div
              key={`${clip.publicPath}-${i}`}
              className="rounded-xl bg-[#111827] p-4 ring-1 ring-white/10"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-white">
                    {clip.title || `Clip ${clip.index + 1}`}
                  </div>
                  {clip.summary && (
                    <div className="mt-1 text-xs text-white/50">{clip.summary}</div>
                  )}
                </div>
                <div className="shrink-0 rounded-full bg-purple-500/20 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-purple-200">
                  {clip.platform}
                </div>
              </div>

              <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-white/70">
                <div>
                  <span className="text-white/40">Source:</span> {sourceLabel(clip.sourceType)}
                </div>
                <div>
                  <span className="text-white/40">Target length:</span>{" "}
                  {clip.targetClipDurationSec != null ? `${clip.targetClipDurationSec}s` : "—"}
                </div>
                {showTimestamps && (
                  <div className="col-span-2">
                    <span className="text-white/40">Source range:</span>{" "}
                    {clip.timestampRangeLabel ||
                      `${formatSeconds(clip.startSec)} – ${formatSeconds(clip.endSec)}`}
                  </div>
                )}
                <div>
                  <span className="text-white/40">Duration:</span>{" "}
                  {clip.durationSec > 0 ? `${clip.durationSec.toFixed(1)}s` : "—"}
                </div>
                <div>
                  <span className="text-white/40">Score:</span>{" "}
                  {clip.score > 0 ? `${Math.round(clip.score)}/100` : "—"}
                </div>
                <div className="col-span-2">
                  <span className="text-white/40">Caption output:</span>{" "}
                  {captionStatusLabel(clip.captionStatus)}
                </div>
                <div className="col-span-2">
                  <span className="text-white/40">Caption source:</span>{" "}
                  {captionSourceLabel(clip.captionSource)}
                  {clip.captionNote ? (
                    <span className="ml-1 text-white/45">({clip.captionNote})</span>
                  ) : null}
                </div>
              </div>

              {clip.reasonLabels.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {clip.reasonLabels.map((label) => (
                    <span
                      key={label}
                      className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/70"
                    >
                      {label.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              )}

              <ClipPreviewVideo absoluteUrl={url} />

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <button
                  type="button"
                  onClick={() => void runDownload(url, mp4Name)}
                  className="text-purple-400 hover:text-purple-300"
                >
                  Download MP4
                </button>
                {srtUrl && (
                  <button
                    type="button"
                    onClick={() => void runDownload(srtUrl, srtName)}
                    className="text-cyan-300 hover:text-cyan-200"
                  >
                    Download SRT
                  </button>
                )}
                <a
                  href={openUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/60 hover:text-white"
                >
                  Open
                </a>
                {showTimestamps && (
                  <button
                    type="button"
                    onClick={() => void copyTimestamps(clip)}
                    className="text-amber-200/90 hover:text-amber-100"
                  >
                    Copy timestamps
                  </button>
                )}
                <a href={storyHandoff} className="text-emerald-300 hover:text-emerald-200">
                  Story Maker
                </a>
                <a href={promptHandoff} className="text-sky-300 hover:text-sky-200">
                  Prompt
                </a>
                <a href={storyVideoHandoff} className="text-fuchsia-300 hover:text-fuchsia-200">
                  Story Video
                </a>
              </div>
            </div>
          )
        })}
      </div>

    </ToolResultLayout>
  )
}
