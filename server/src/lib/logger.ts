/**
 * Lightweight structured logging (no extra deps).
 * Production: one JSON object per line for log aggregators.
 * Development: pretty multi-line for readability.
 */

const isProduction = process.env.NODE_ENV === "production"

export type LogLevel = "debug" | "info" | "warn" | "error"

export type LogFields = Record<string, unknown>

function formatLine(level: LogLevel, message: string, fields: LogFields): string {
  const base = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...fields,
  }
  if (isProduction) {
    return JSON.stringify(base)
  }
  const extra =
    Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields, null, 0)}` : ""
  return `[${base.ts}] ${level.toUpperCase()} ${message}${extra}`
}

function write(level: LogLevel, message: string, fields: LogFields = {}) {
  const line = formatLine(level, message, fields)
  if (level === "error") {
    console.error(line)
  } else if (level === "warn") {
    console.warn(line)
  } else {
    console.log(line)
  }
}

export const log = {
  debug(message: string, fields?: LogFields) {
    if (!isProduction) write("debug", message, fields ?? {})
  },
  info(message: string, fields?: LogFields) {
    write("info", message, fields ?? {})
  },
  warn(message: string, fields?: LogFields) {
    write("warn", message, fields ?? {})
  },
  error(message: string, fields?: LogFields) {
    write("error", message, fields ?? {})
  },
}

export function serializeErr(err: unknown): { name?: string; message: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message }
  }
  if (typeof err === "string") return { message: err }
  try {
    return { message: JSON.stringify(err) }
  } catch {
    return { message: "unknown_error" }
  }
}
