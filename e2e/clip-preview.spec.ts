import { test, expect, type Page, type Route } from "@playwright/test"
import fs from "fs"
import path from "path"
import { assertNextDevServesJsBundles } from "./helpers/assert-next-dev-healthy"

const MOCK_JOB_ID = "e2e-mock-clip-job"
const PREVIEW_PATH = "/clips/e2e-preview-clip.mp4"

/** Walk up from `process.cwd()` until `e2e/fixtures/sample.mp4` exists (stable without `import.meta`). */
function resolveRepoRoot(): string {
  let dir = path.resolve(process.cwd())
  for (let i = 0; i < 8; i++) {
    const marker = path.join(dir, "e2e", "fixtures", "sample.mp4")
    if (fs.existsSync(marker)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.resolve(process.cwd())
}

const REPO_ROOT = resolveRepoRoot()

function allowedFeature() {
  return {
    allowed: true,
    blockedReason: null,
    minimumPlan: null,
    upgradeRequired: false,
  }
}

function debugLogTargets(): string[] {
  const paths = [
    path.resolve(REPO_ROOT, "debug-45b566.log"),
    path.resolve(process.cwd(), "debug-45b566.log"),
  ]
  return [...new Set(paths)]
}

/** Truncate log at the start of each test so a file always exists after Playwright begins. */
function resetDebugSessionFiles() {
  const line =
    JSON.stringify({
      sessionId: "45b566",
      hypothesisId: "H_e2e_harness_start",
      data: { repoRoot: REPO_ROOT, cwd: process.cwd() },
      timestamp: Date.now(),
    }) + "\n"
  for (const p of debugLogTargets()) {
    try {
      fs.writeFileSync(p, line, "utf8")
    } catch (err) {
      console.error("[clip-preview e2e] resetDebugSessionFiles failed:", p, err)
    }
  }
}

function appendDebugSessionLog(lines: string) {
  for (const p of debugLogTargets()) {
    try {
      fs.appendFileSync(p, lines, "utf8")
    } catch (err) {
      console.error("[clip-preview e2e] appendDebugSessionLog failed:", p, err)
    }
  }
}

/** Always write NDJSON to repo root (even on assertion failure) so the agent can read runtime evidence. */
async function logClipDebugProbe(page: Page, phase: string, videoSrc: string | null) {
  const clipDebugProbe = await page.evaluate(() => {
    const w = (window as unknown as { __VF_CLIP_DEBUG__?: unknown[] }).__VF_CLIP_DEBUG__
    let storage: string | null = null
    try {
      storage = sessionStorage.getItem("npai-debug-45b566")
    } catch {
      storage = null
    }
    return {
      windowClipDebugLen: Array.isArray(w) ? w.length : 0,
      sessionStorageChars: storage ? storage.length : 0,
      lastHypothesis:
        Array.isArray(w) && w.length > 0
          ? String((w[w.length - 1] as { hypothesisId?: string })?.hypothesisId ?? "")
          : "",
    }
  })
  appendDebugSessionLog(
    JSON.stringify({
      sessionId: "45b566",
      hypothesisId: "H_e2e_clip_probe",
      data: { phase, ...clipDebugProbe, videoSrcPrefix: (videoSrc ?? "").slice(0, 96) },
      timestamp: Date.now(),
    }) + "\n"
  )
}

async function persistClipPreviewDebug(page: Page) {
  const bundle = await page.evaluate(() => {
    let fromStorage: string | null = null
    try {
      fromStorage = sessionStorage.getItem("npai-debug-45b566")
    } catch {
      fromStorage = null
    }
    if (fromStorage && fromStorage.length > 0) {
      return { source: "sessionStorage" as const, raw: fromStorage }
    }
    const w = (window as unknown as { __VF_CLIP_DEBUG__?: unknown[] }).__VF_CLIP_DEBUG__
    if (Array.isArray(w) && w.length > 0) {
      return { source: "window" as const, raw: JSON.stringify(w) }
    }
    return { source: "none" as const, raw: null as string | null }
  })
  const raw = bundle.raw
  let out = ""
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      out = Array.isArray(parsed)
        ? parsed.map((e) => JSON.stringify(e)).join("\n") + "\n"
        : `${String(raw)}\n`
    } catch {
      out = `${raw}\n`
    }
  }
  out +=
    JSON.stringify({
      sessionId: "45b566",
      hypothesisId: "H_e2e_finally",
      message: "e2e persistClipPreviewDebug",
      data: {
        debugSource: bundle.source,
        hadDebugPayload: Boolean(raw && raw.length > 2),
        repoRoot: REPO_ROOT,
        cwd: process.cwd(),
      },
      timestamp: Date.now(),
    }) + "\n"
  appendDebugSessionLog(out)
}

const mockEntitlementBody = {
  success: true,
  entitlement: {
    plan: "STARTER",
    normalizedPlan: "STARTER",
    subscriptionStatus: "ACTIVE",
    isTrialActive: false,
    trialExpiresAt: null,
    isPaid: true,
    isUnlimited: false,
    creditsRemaining: 50,
    blockedReason: null,
    upgradeRequired: false,
    minimumPlan: null,
    featureAccess: {
      generation: allowedFeature(),
      prompt: allowedFeature(),
      storyMaker: allowedFeature(),
      clip: allowedFeature(),
      ads: {
        allowed: false,
        blockedReason: "PLAN_UPGRADE_REQUIRED",
        minimumPlan: "ELITE",
        upgradeRequired: true,
      },
      admin: {
        allowed: false,
        blockedReason: "ADMIN_REQUIRED",
        minimumPlan: null,
        upgradeRequired: true,
      },
    },
  },
}

test.describe("Clipper preview after job", () => {
  test.beforeEach(async ({ request }) => {
    resetDebugSessionFiles()
    await assertNextDevServesJsBundles(request, {
      onEvidence: (data) => {
        appendDebugSessionLog(
          JSON.stringify({
            sessionId: "45b566",
            timestamp: Date.now(),
            ...data,
          }) + "\n"
        )
      },
    })
  })

  test.afterEach(async ({ page }) => {
    appendDebugSessionLog(
      JSON.stringify({
        sessionId: "45b566",
        hypothesisId: "H_e2e_afterEach_enter",
        data: { repoRoot: REPO_ROOT },
        timestamp: Date.now(),
      }) + "\n"
    )
    try {
      await persistClipPreviewDebug(page)
    } catch (err) {
      appendDebugSessionLog(
        JSON.stringify({
          sessionId: "45b566",
          hypothesisId: "H_e2e_afterEach_catch",
          data: { err: String(err), repoRoot: REPO_ROOT, cwd: process.cwd() },
          timestamp: Date.now(),
        }) + "\n"
      )
    }
  })

  test("clip results show a video tag and the MP4 URL is reachable (user flow)", async ({ page }) => {
    const fixturePath = path.join(REPO_ROOT, "e2e", "fixtures", "sample.mp4")
    if (!fs.existsSync(fixturePath)) {
      test.skip(true, "Missing e2e/fixtures/sample.mp4 — add a small MP4 under e2e/fixtures/")
    }
    const mp4Body = fs.readFileSync(fixturePath)

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const email = `pw_clip_${suffix}@test.local`
    const password = "E2E_Strong_99!"

    /** Avoid requiring a live DB / full API stack when `reuseExistingServer` attaches to Next-only dev. */
    let e2eAuthStubbed = false
    const e2eSessionUser = {
      id: "e2e-user-id",
      email,
      role: "USER",
      plan: "STARTER",
      subscriptionStatus: "ACTIVE",
      credits: 50,
      trialExpiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const isAuthMe = (url: URL) => url.pathname === "/api/auth/me"
    const isAuthRegister = (url: URL) => url.pathname === "/api/auth/register"

    await page.route(isAuthMe, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue()
        return
      }
      if (!e2eAuthStubbed) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ success: false, message: "Unauthorized" }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, user: e2eSessionUser }),
      })
    })

    await page.route(isAuthRegister, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue()
        return
      }
      e2eAuthStubbed = true
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, user: e2eSessionUser }),
      })
    })

    await page.route("**/api/billing/entitlement", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockEntitlementBody),
      })
    })

    await page.route("**/api/clip/create", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          requestId: "e2e-req",
          jobId: MOCK_JOB_ID,
          clipJobStage: "queued",
          status: "queued",
          progress: 0,
          message: "Job accepted (e2e).",
          stage: "validate",
        }),
      })
    })

    await page.route(`**/api/clip/jobs/${MOCK_JOB_ID}`, async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          requestId: "e2e-req",
          jobId: MOCK_JOB_ID,
          userId: "e2e-user",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: "completed",
          clipJobStage: "completed",
          progress: 100,
          message: "Done.",
          params: {
            source: "youtube",
            clips: 1,
            platform: "tiktok",
            subtitleStyle: "clean",
            clipLengthPreset: "30",
            captionsEnabled: true,
            captionMode: "both",
            targetClipDurationSec: 30,
          },
          result: {
            partial: false,
            requestedClips: 1,
            generatedClips: 1,
            targetClipDurationSec: 30,
            qualitySignals: ["e2e_ready"],
            clipItems: [
              {
                index: 0,
                startSec: 0,
                endSec: 10,
                durationSec: 10,
                platform: "tiktok",
                subtitleStyle: "clean",
                score: 84,
                reasonLabels: ["e2e"],
                publicPath: PREVIEW_PATH,
                sourceType: "youtube",
                targetClipDurationSec: 30,
                title: "E2E preview clip",
                summary: "Automated test clip",
                timestampRangeLabel: "00:00–00:10",
                captionsEnabled: true,
                captionStatus: "burned_in",
                captionSource: "whisper",
              },
            ],
          },
        }),
      })
    })

    const clipPathSuffix = "clips/e2e-preview-clip.mp4"
    const fulfillClip = async (route: Route) => {
      const method = route.request().method()
      const cors = {
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      } as const

      if (method === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            ...cors,
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Max-Age": "86400",
          },
        })
        return
      }

      if (method === "HEAD") {
        await route.fulfill({
          status: 200,
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(mp4Body.length),
            "Accept-Ranges": "bytes",
            ...cors,
          },
        })
        return
      }
      if (method !== "GET") {
        await route.continue()
        return
      }

      const rangeHdr = route.request().headerValue("range")
      const range =
        typeof rangeHdr === "string"
          ? rangeHdr
          : Array.isArray(rangeHdr)
            ? rangeHdr[0]
            : ""
      if (range && String(range).toLowerCase().startsWith("bytes=")) {
        const total = mp4Body.length
        const m = /^bytes=(\d*)-(\d*)$/i.exec(String(range).trim())
        if (m) {
          let start = m[1] ? parseInt(m[1], 10) : 0
          let end = m[2] ? parseInt(m[2], 10) : total - 1
          if (Number.isNaN(start)) start = 0
          if (Number.isNaN(end) || end >= total) end = total - 1
          if (start >= total) {
            await route.fulfill({ status: 416, headers: { ...cors } })
            return
          }
          const chunk = mp4Body.subarray(start, end + 1)
          await route.fulfill({
            status: 206,
            headers: {
              "Content-Type": "video/mp4",
              "Content-Length": String(chunk.length),
              "Content-Range": `bytes ${start}-${start + chunk.length - 1}/${total}`,
              "Accept-Ranges": "bytes",
              ...cors,
            },
            body: chunk,
          })
          return
        }
      }

      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(mp4Body.length),
          "Accept-Ranges": "bytes",
          ...cors,
        },
        body: mp4Body,
      })
    }

    await page.route(`**/${clipPathSuffix}**`, fulfillClip)

    await page.goto("/register")
    await expect(page.getByText("Checking saved session…")).toBeHidden({
      timeout: 30_000,
    })

    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(password)
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page).toHaveURL(/\/(dashboard|pricing)/, { timeout: 30_000 })

    await page.goto("/dashboard/tools/clipper")
    await expect(page.getByRole("heading", { name: "Clipper Engine" })).toBeVisible({
      timeout: 20_000,
    })

    await page.getByRole("button", { name: "YouTube link" }).click()
    await page.getByPlaceholder(/youtube\.com/i).fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ")

    await page.getByRole("button", { name: "Start clip job" }).click()

    await expect(page.getByText("E2E preview clip", { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    await logClipDebugProbe(page, "after_results_visible", null)

    const video = page.locator("video").first()
    await expect(video).toBeVisible()

    const videoSrc = await video.getAttribute("src")
    expect(videoSrc).toBeTruthy()

    // useClipPreviewSrc may use a blob URL after fetching the MP4 (cross-origin playback path).
    if (videoSrc!.startsWith("blob:")) {
      await expect
        .poll(async () => video.evaluate((el: HTMLVideoElement) => el.readyState), {
          timeout: 20_000,
        })
        .toBeGreaterThanOrEqual(2)
    } else {
      expect(videoSrc).toMatch(/e2e-preview-clip\.mp4/)
      const headStatus = await page.evaluate(async (url: string) => {
        const r = await fetch(url, { method: "HEAD", mode: "cors", credentials: "omit" })
        return r.status
      }, videoSrc!)
      expect(headStatus).toBe(200)

      const getStatus = await page.evaluate(async (url: string) => {
        const r = await fetch(url, { method: "GET", mode: "cors", credentials: "omit" })
        return r.status
      }, videoSrc!)
      expect([200, 206]).toContain(getStatus)
    }

    await logClipDebugProbe(page, "after_video_checks", videoSrc ?? null)
  })
})
