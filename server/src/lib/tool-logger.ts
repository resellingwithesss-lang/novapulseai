type ToolLogLevel = "info" | "warn" | "error"

type ToolLogPayload = {
  tool: string
  requestId?: string
  jobId?: string
  stage?: string
  status?: string
  userId?: string
  elapsedMs?: number
  message?: string
  [key: string]: unknown
}

export function logToolEvent(level: ToolLogLevel, payload: ToolLogPayload) {
  const base = {
    event: "tool_event",
    level,
    ts: new Date().toISOString(),
    ...payload,
  }

  if (level === "error") {
    console.error("TOOL_EVENT", base)
    return
  }
  if (level === "warn") {
    console.warn("TOOL_EVENT", base)
    return
  }
  console.info("TOOL_EVENT", base)
}
