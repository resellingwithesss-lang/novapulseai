import type { ToolStage } from "@/lib/api"

export type ToolExecutionStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"

export type ToolOperation<TOutput = unknown> = {
  success: boolean
  message?: string
  requestId?: string
  jobId?: string
  stage?: ToolStage
  status?: ToolExecutionStatus
  progress?: number
  result?: TOutput
  error?: {
    code?: string
    details?: unknown
  }
}

function mapStageToStatus(stage?: ToolStage): ToolExecutionStatus | undefined {
  if (!stage) return undefined
  if (stage === "failed") return "failed"
  if (stage === "finalize") return "completed"
  if (stage === "validate") return "queued"
  return "processing"
}

export function normalizeToolOperation<TOutput = unknown>(
  input: unknown,
  options?: {
    resultKey?: string
    resultFallbackKeys?: string[]
    jobIdKey?: string
    statusKey?: string
    progressKey?: string
  }
): ToolOperation<TOutput> {
  const data = (input ?? {}) as Record<string, unknown>
  const resultKey = options?.resultKey ?? "result"
  const resultFallbackKeys = options?.resultFallbackKeys ?? ["output"]
  const jobIdKey = options?.jobIdKey ?? "jobId"
  const statusKey = options?.statusKey ?? "status"
  const progressKey = options?.progressKey ?? "progress"

  const stage = typeof data.stage === "string" ? (data.stage as ToolStage) : undefined
  const status = typeof data[statusKey] === "string"
    ? (data[statusKey] as ToolExecutionStatus)
    : mapStageToStatus(stage)
  const progress =
    typeof data[progressKey] === "number"
      ? Math.max(0, Math.min(100, data[progressKey] as number))
      : undefined

  const primaryResult = data[resultKey] as TOutput | undefined
  const fallbackResult =
    primaryResult === undefined
      ? resultFallbackKeys
          .map((key) => data[key] as TOutput | undefined)
          .find((value) => value !== undefined)
      : undefined

  return {
    success: Boolean(data.success),
    message: typeof data.message === "string" ? data.message : undefined,
    requestId: typeof data.requestId === "string" ? data.requestId : undefined,
    jobId: typeof data[jobIdKey] === "string" ? data[jobIdKey] : undefined,
    stage,
    status,
    progress,
    result: primaryResult ?? fallbackResult,
    error: data.success
      ? undefined
      : {
          code: typeof data.code === "string" ? data.code : undefined,
          details: data,
        },
  }
}
