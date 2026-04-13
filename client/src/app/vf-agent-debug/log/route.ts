import fs from "fs/promises"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

/**
 * Prefer `client/public/*.ndjson` (always under the Next package, mkdir-friendly).
 * Repo-root `debug-45b566.log` is second for Cursor workspace tools at monorepo root.
 */
function candidateLogFiles(): string[] {
  const envPath = process.env.NPAI_DEBUG_LOG_PATH?.trim()
  if (envPath) {
    return [path.resolve(envPath)]
  }
  const cwd = process.cwd()
  const resolved = path.resolve(cwd)
  const base = path.basename(resolved)
  const parent = path.resolve(resolved, "..")

  if (base === "client") {
    return [
      path.join(resolved, "public", "npai-debug-45b566.ndjson"),
      path.join(parent, "debug-45b566.log"),
      path.join(resolved, "debug-45b566.log"),
    ]
  }
  return [
    path.join(resolved, "client", "public", "npai-debug-45b566.ndjson"),
    path.join(resolved, "debug-45b566.log"),
    path.join(resolved, "client", "debug-45b566.log"),
  ]
}

/** Sanity check in dev (browser or curl GET). */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false }, { status: 404 })
  }
  return NextResponse.json({ ok: true, endpoint: "novapulseai-agent-debug/log" })
}

/** Dev-only: append one NDJSON line (not under `/api/*` — those rewrites proxy to Express). */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false }, { status: 404 })
  }
  try {
    const line = (await req.text()).trim()
    if (!line) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }
    let lastErr: string | null = null
    for (const logFile of candidateLogFiles()) {
      try {
        await fs.mkdir(path.dirname(logFile), { recursive: true })
        await fs.appendFile(logFile, line + "\n", "utf8")
        return NextResponse.json({ ok: true })
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
      }
    }
    return NextResponse.json({ ok: false, error: lastErr ?? "write failed" }, { status: 500 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
