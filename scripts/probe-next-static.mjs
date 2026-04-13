/**
 * Appends one NDJSON line to debug-45b566.log at repo root (session 45b566).
 * Run: node scripts/probe-next-static.mjs
 * Optional: PROBE_ORIGIN=http://127.0.0.1:3000
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function resolveRepoRoot() {
  let dir = path.resolve(process.cwd())
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "e2e", "fixtures", "sample.mp4"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.resolve(process.cwd())
}

const REPO_ROOT = resolveRepoRoot()
const LOG_FILE = path.join(REPO_ROOT, "debug-45b566.log")
const origin = (process.env.PROBE_ORIGIN || "http://localhost:3000").replace(/\/$/, "")

const PATHS = [
  "/_next/static/chunks/webpack.js",
  "/_next/static/chunks/main-app.js",
]

async function probe(chunkPath) {
  const url = `${origin}${chunkPath}`
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  })
  const ct = String(res.headers.get("content-type") ?? "").toLowerCase()
  const body = (await res.text()).slice(0, 200)
  const looksLikeJs = ct.includes("javascript") || ct.includes("ecmascript")
  return {
    path: chunkPath,
    url,
    status: res.status,
    contentType: ct || null,
    bodyPrefix: body,
    ok: res.ok && looksLikeJs,
  }
}

const results = []
for (const p of PATHS) {
  try {
    results.push(await probe(p))
  } catch (e) {
    results.push({
      path: p,
      url: `${origin}${p}`,
      status: 0,
      contentType: null,
      bodyPrefix: "",
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

const broken = results.find(
  (r) =>
    !r.ok &&
    typeof r.bodyPrefix === "string" &&
    r.bodyPrefix.includes("missing required error components")
)

const line =
  JSON.stringify({
    sessionId: "45b566",
    hypothesisId: "H_cli_next_static_probe",
    data: {
      origin,
      repoRoot: REPO_ROOT,
      cwd: process.cwd(),
      atIso: new Date().toISOString(),
      results,
      allOk: results.every((r) => r.ok),
      ...(broken
        ? {
            remediation:
              "Next dev returned the 'missing required error components' fallback (often stale .next, two dev servers on :3000, or build+dev overlap). Stop all node on3000, run `npm run dev:fresh` from repo root, then re-probe.",
          }
        : {}),
    },
    timestamp: Date.now(),
  }) + "\n"

fs.appendFileSync(LOG_FILE, line, "utf8")
console.log(LOG_FILE)
console.log(JSON.stringify(results, null, 2))
if (broken) {
  console.error("\n[probe] Next dev chunk issue — see log remediation line.\n")
}

process.exit(results.every((r) => r.ok) ? 0 : 1)
