export type ClipPlatform = "tiktok" | "instagram" | "youtube"
export type ClipSubtitleStyle = "clean" | "bold" | "viral" | "minimal"
export type ClipSourceType = "upload" | "youtube"

export type ClipLengthPreset = "15" | "30" | "45" | "60" | "custom"

export type ClipCaptionMode = "burn" | "srt" | "both"

export type ClipCaptionSource = "youtube_transcript" | "whisper" | "none" | "unavailable"

export interface ClipRequest {
  videoPath: string
  clips: number
  platform: ClipPlatform
  subtitleStyle: ClipSubtitleStyle
  /** Target duration per clip in seconds (from preset or custom). */
  targetClipDurationSec: number
  captionsEnabled: boolean
  /** When captions off, ignored. */
  captionMode: ClipCaptionMode
  sourceType: ClipSourceType
  youtubeUrl?: string | null
  /** Pre-fetched YouTube captions (absolute video timeline). */
  youtubeTranscript?: YoutubeTranscriptLine[] | null
}

export type YoutubeTranscriptLine = {
  text: string
  duration: number
  offset: number
}

export interface ClipCandidate {
  start: number
  end: number
  durationSec: number
  score: number
  reasonLabels: string[]
}

export type ClipCaptionStatus =
  | "burned_in"
  | "srt_only"
  | "skipped_disabled"
  | "skipped_empty"
  | "failed"

export interface ClipResult {
  index: number
  startSec: number
  endSec: number
  durationSec: number
  platform: ClipPlatform
  subtitleStyle: ClipSubtitleStyle
  score: number
  reasonLabels: string[]
  fileName: string
  filePath: string
  publicPath: string
  sourceType: ClipSourceType
  targetClipDurationSec: number
  title: string
  summary: string
  /** Human-readable range for UI copy actions */
  timestampRangeLabel: string
  captionsEnabled: boolean
  captionStatus: ClipCaptionStatus
  captionSource: ClipCaptionSource
  captionNote?: string
  /** Sidecar subtitles when generated (download) */
  subtitlePublicPath?: string
}

export interface PlatformPreset {
  width: number
  height: number
  videoBitrate: string
  maxRate: string
  bufferSize: string
  audioBitrate: string
  fps: number
  profile: "high" | "main"
  x264Preset: "fast" | "medium"
}

export const PLATFORM_PRESETS: Record<ClipPlatform, PlatformPreset> = {
  tiktok: {
    width: 1080,
    height: 1920,
    videoBitrate: "8M",
    maxRate: "10M",
    bufferSize: "16M",
    audioBitrate: "160k",
    fps: 30,
    profile: "high",
    x264Preset: "medium",
  },

  instagram: {
    width: 1080,
    height: 1920,
    videoBitrate: "8M",
    maxRate: "10M",
    bufferSize: "16M",
    audioBitrate: "160k",
    fps: 30,
    profile: "high",
    x264Preset: "medium",
  },

  youtube: {
    width: 1080,
    height: 1920,
    videoBitrate: "10M",
    maxRate: "12M",
    bufferSize: "20M",
    audioBitrate: "192k",
    fps: 30,
    profile: "high",
    x264Preset: "fast",
  },
}
