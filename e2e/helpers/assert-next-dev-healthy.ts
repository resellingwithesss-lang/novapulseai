import { expect, type APIRequestContext } from "@playwright/test"

const DEFAULT_ORIGIN = "http://localhost:3000"

/** Same paths the browser loads; HTML MIME here matches console "Refused to execute script". */
const CHUNK_PATHS = [
  "/_next/static/chunks/webpack.js",
  "/_next/static/chunks/main-app.js",
] as const

/**
 * Fails fast when something on :3000 returns HTML for `/_next/static/*` (wrong process, stale `.next`, or proxy).
 * Retries for cold `next dev` first-compile.
 */
export async function assertNextDevServesJsBundles(
  request: APIRequestContext,
  options?: { origin?: string; timeoutMs?: number; onEvidence?: (payload: Record<string, unknown>) => void }
) {
  const origin = (options?.origin ?? DEFAULT_ORIGIN).replace(/\/$/, "")
  const timeoutMs = options?.timeoutMs ?? 120_000
  const onEvidence = options?.onEvidence

  await expect(async () => {
    for (const path of CHUNK_PATHS) {
      const url = `${origin}${path}`
      const res = await request.get(url)
      const ct = String(res.headers()["content-type"] ?? "").toLowerCase()
      const body = (await res.text()).slice(0, 160)
      const looksLikeJs = ct.includes("javascript") || ct.includes("ecmascript")
      const ok = res.ok() && looksLikeJs

      onEvidence?.({
        hypothesisId: "H_e2e_next_chunk_probe",
        path,
        url,
        status: res.status(),
        contentType: ct || null,
        bodyPrefix: body,
        ok,
      })

      expect(
        ok,
        `Next dev on ${origin} is not serving JS for ${path} ` +
          `(status ${res.status()}, content-type: ${ct || "missing"}). ` +
          `Another app on port 3000 or a stale client/.next often causes HTML/404 here. ` +
          `Fix: free port 3000, run "npm run dev" from repo root (API + Next), or "npm run dev:fresh" from repo root. ` +
          `Body preview: ${JSON.stringify(body)}`
      ).toBeTruthy()
    }
  }).toPass({ timeout: timeoutMs, intervals: [400, 800, 1600, 3200] })
}
