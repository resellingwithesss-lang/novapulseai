/// <reference path="../types/express.d.ts" />
import type { Request, Response } from "express"
import type { ToolStage } from "../modules/tools/tool.stages"

export type ToolErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "TOO_SHORT"
  | "NOT_FOUND"
  | "AI_INVALID"
  | "RETRY_LATER"
  | "TIMEOUT"
  | "CANCELLED"
  | "EXPIRED"
  | "PARTIAL_RESULT"
  | "INTERNAL_ERROR"
  /** DB behind `prisma/migrations` (Prisma P2021/P2022). */
  | "DATABASE_SCHEMA_MIGRATION_REQUIRED"

type ToolOkPayload = {
  requestId?: string
  stage?: ToolStage
  status?: "queued" | "processing" | "completed" | "failed"
  progress?: number
  jobId?: string
} & Record<string, unknown>

type ToolFailPayload = {
  requestId?: string
  stage?: ToolStage
  code?: ToolErrorCode
  status?: "queued" | "processing" | "completed" | "failed"
  progress?: number
  jobId?: string
} & Record<string, unknown>

function mapStageToStatus(stage: ToolStage) {
  if (stage === "failed") return "failed" as const
  if (stage === "finalize") return "completed" as const
  if (stage === "validate") return "queued" as const
  return "processing" as const
}

export function toolOk(
  res: Response,
  payload: ToolOkPayload = {},
  status = 200
) {
  const { requestId, stage = "finalize", status: explicitStatus, progress, jobId, ...rest } = payload
  const resolvedStatus = explicitStatus ?? mapStageToStatus(stage)
  return res.status(status).json({
    success: true,
    requestId,
    stage,
    status: resolvedStatus,
    progress: progress ?? (resolvedStatus === "completed" ? 100 : undefined),
    jobId,
    ...rest,
  })
}

export function toolFail(
  res: Response,
  status: number,
  message: string,
  payload: ToolFailPayload = {}
) {
  const { requestId, stage = "failed", code, status: explicitStatus, progress, jobId, ...rest } = payload
  const resolvedStatus = explicitStatus ?? mapStageToStatus(stage)
  return res.status(status).json({
    success: false,
    message,
    code,
    requestId,
    stage,
    status: resolvedStatus,
    progress,
    jobId,
    ...rest,
  })
}

export function resolveRequestId(req: Request): string {
  const id = req.requestId
  if (typeof id === "string" && id.trim()) return id.trim()
  return "unknown_request_id"
}
