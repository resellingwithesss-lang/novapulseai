import type { ToolStage } from "@/lib/api"

export type ToolMediaItem = {
  publicPath: string
  durationSec?: number
  qualityScore?: number
  preset?: string
}

export type ToolRunSummary = {
  requestId?: string
  stage?: ToolStage
  qualitySignals?: string[]
}
