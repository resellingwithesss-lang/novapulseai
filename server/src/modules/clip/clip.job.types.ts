import type { ClipResult } from "./types/clip.types"

/** User-facing pipeline stages for jobs + API polling. */
export type ClipJobStage =
  | "queued"
  | "ingesting"
  | "analyzing"
  | "selecting_moments"
  | "trimming"
  | "captioning"
  | "finalizing"
  | "completed"
  | "failed"

export type ClipJobStatus = ClipJobStage

export type ClipJobParams = {
  source: "upload" | "youtube"
  youtubeUrl?: string
  clips: number
  platform: "tiktok" | "instagram" | "youtube"
  subtitleStyle: "clean" | "bold" | "viral" | "minimal"
  clipLengthPreset: "15" | "30" | "45" | "60" | "custom"
  customClipLengthSec?: number
  captionsEnabled: boolean
  captionMode: "burn" | "srt" | "both"
  targetClipDurationSec: number
}

export type ClipJobError = {
  code: string
  message: string
  httpStatus?: number
}

/** Persisted job document (server-side). */
export type ClipJobRecord = {
  jobId: string
  userId: string
  requestId: string
  createdAt: number
  updatedAt: number
  status: ClipJobStatus
  clipJobStage: ClipJobStage
  progress: number
  message: string
  params: ClipJobParams
  /** Local path to source video during processing; removed after job ends. */
  sourceVideoPath?: string
  result?: {
    clipItems: ClipResult[]
    partial: boolean
    requestedClips: number
    generatedClips: number
    targetClipDurationSec: number
    qualitySignals: string[]
  }
  error?: ClipJobError
}

/** Progress events from the clip pipeline (internal). */
export type ClipPipelineProgressKind =
  | "analyzing"
  | "selecting_moments"
  | "trimming"
  | "captioning"
  | "finalizing"

export type ClipPipelineProgressEvent = {
  kind: ClipPipelineProgressKind
  /** 0–1 progress within the current kind (e.g. clip 2 of 5 → 0.4). */
  fraction: number
  message?: string
  clipIndex?: number
  clipTotal?: number
}
