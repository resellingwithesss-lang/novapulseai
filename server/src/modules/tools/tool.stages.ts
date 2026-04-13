export const TOOL_STAGES = [
  "validate",
  "analyze",
  "rank",
  "render",
  "finalize",
  "failed",
] as const

export type ToolStage = (typeof TOOL_STAGES)[number]
