import puppeteer, { Browser, Page, ElementHandle } from "puppeteer"
import { puppeteerLaunchOptions } from "../../lib/puppeteer-launch"
import fs from "fs"
import path from "path"
import crypto from "crypto"
import { spawn } from "child_process"
import { CaptureResult, Platform, type NovaPulseAICaptureDiagnostics } from "./ads.types"
import type {
  AdInteractionStep,
  InteractiveAdScene,
  InteractionCaptureOptions,
  InteractiveFocalRegion,
  InteractiveSceneIntent,
  ProductDemoSceneKind,
} from "./pipeline/interaction.types"
import {
  resolveNovaPulseAICaptureProfile,
  novaPulseAIDemoLoginConfigured,
} from "./pipeline/ad.product-profile"
import type { AdSiteIngestion } from "./pipeline/types"
import { runInteractionStep } from "./website.interaction.runner"
import {
  finalizeNovaPulseAIDemoLogin,
  isNovaPulseAILoggedIn,
  vfPostLoginAllowedPathKeys,
} from "./website.novapulseai-login"
import {
  assertPublicHttpUrl,
  assertPublicHttpUrlWithDns,
  isLoopbackIngestionAllowed,
} from "../../lib/url-guard"
import { installNavigationSsrfGuard } from "../../lib/puppeteer-ssrf-guard"

/** Correlates capture logs with an ad job (optional). */
export type AdsCaptureLogContext = { requestId: string; jobDbId: string }

interface CaptureOptions {
  platform?: Platform
  duration?: number
  loginEmail?: string
  loginPassword?: string
  /** Visit these paths first (same-origin), e.g. ["/pricing","/features"]. */
  preferredPaths?: string[]
  /** When set, runs scripted interactions per segment instead of the default timeline. */
  interactiveSegments?: InteractiveAdScene[]
  interaction?: InteractionCaptureOptions
  /** Structured logging for post-script capture (voice already done). */
  logContext?: AdsCaptureLogContext
  /** Rough 0–100 progress within capture (for job UI during long frame loops). */
  onCaptureProgress?: (percentApprox: number) => void
  /** Shorter capture, lower res, faster ffmpeg — opt-in only (dev / iteration). */
  fastPreview?: boolean
  /** True when cinematic pipeline retried capture without interactive after interactive failed. */
  fallbackFromInteractive?: boolean
  /** NovaPulseAI: ingestion subset for post-login route locking (tools / dashboard / pricing paths). */
  vfSiteIngestion?: Pick<AdSiteIngestion, "siteUrl" | "toolsUrl" | "dashboardUrl" | "pricingUrl">
}

interface TimelineStep {
  route: string
  label: string
  waitMs: number
  action?: (page: Page) => Promise<void>
}

const TMP_DIR = path.resolve("tmp/capture")
/** Hard cap for the whole capture session (navigation + frames + ffmpeg). */
const CAPTURE_WALL_MS = Math.min(
  900_000,
  Math.max(120_000, Math.floor(Number(process.env.AD_CAPTURE_WALL_CLOCK_MS ?? "420000")))
)
const PUPPETEER_LAUNCH_MS = Math.min(
  120_000,
  Math.max(15_000, Math.floor(Number(process.env.AD_PUPPETEER_LAUNCH_TIMEOUT_MS ?? "45000")))
)
const FRAMES_TO_VIDEO_MS = Math.min(
  900_000,
  Math.max(60_000, Math.floor(Number(process.env.AD_CAPTURE_FFMPEG_MS ?? "600000")))
)
/** Upper bound on captured frames (wall-time driver). ~24s @ 30fps default. */
const AD_CAPTURE_MAX_FRAMES = Math.min(
  1400,
  Math.max(360, Math.floor(Number(process.env.AD_CAPTURE_MAX_FRAMES ?? "720")))
)
const AD_CAPTURE_MAX_FRAMES_PER_SEGMENT = Math.min(
  320,
  Math.max(36, Math.floor(Number(process.env.AD_CAPTURE_MAX_FRAMES_PER_SEGMENT ?? "120")))
)
const AD_CAPTURE_MAX_INTERACTIVE_SEGMENTS = Math.min(
  16,
  Math.max(3, Math.floor(Number(process.env.AD_CAPTURE_MAX_INTERACTIVE_SEGMENTS ?? "6")))
)
const AD_CAPTURE_MAX_TIMELINE_STEPS = Math.min(
  10,
  Math.max(3, Math.floor(Number(process.env.AD_CAPTURE_MAX_TIMELINE_STEPS ?? "6")))
)
const AD_CAPTURE_MAX_FRAMES_PER_TIMELINE_STEP = Math.min(
  200,
  Math.max(24, Math.floor(Number(process.env.AD_CAPTURE_MAX_FRAMES_PER_TIMELINE_STEP ?? "100")))
)
/** Primary navigation budget (domcontentloaded — avoids long networkidle stalls). */
const GOTO_CAPTURE_MS = Math.min(
  70_000,
  Math.max(12_000, Math.floor(Number(process.env.AD_CAPTURE_GOTO_MS ?? "38000")))
)
const CAPTURE_SETTLE_MS = Math.min(
  2000,
  Math.max(350, Math.floor(Number(process.env.AD_CAPTURE_SETTLE_MS ?? "600")))
)
/** Milliseconds between frame grabs; lower = faster capture pass (same frame cap). */
const AD_CAPTURE_FRAME_INTERVAL_MS = Math.min(
  45,
  Math.max(6, Math.floor(Number(process.env.AD_CAPTURE_FRAME_INTERVAL_MS ?? "20")))
)
const DEFAULT_DURATION = 24
const FPS = 30
const MIN_OUTPUT_BYTES = 120_000

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID()}`
}

function ff(p: string) {
  return path.resolve(p).replace(/\\/g, "/")
}

function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms))
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  }) as Promise<T>
}

function logCapture(ctx: AdsCaptureLogContext | undefined, payload: Record<string, unknown>) {
  const prefix = ctx
    ? `[ads:capture] requestId=${ctx.requestId} jobDbId=${ctx.jobDbId}`
    : `[ads:capture]`
  console.log(prefix, JSON.stringify({ ...payload, ts: new Date().toISOString() }))
}

type CaptureWallContext = {
  logContext?: AdsCaptureLogContext
  detail?: Record<string, unknown>
}

function assertCaptureWall(wallEnd: number, where: string, ctx?: CaptureWallContext) {
  if (Date.now() > wallEnd) {
    if (ctx?.detail && Object.keys(ctx.detail).length > 0) {
      logCapture(ctx.logContext, {
        phase: "capture_wall_exceeded",
        where,
        remainingMs: wallEnd - Date.now(),
        ...ctx.detail,
      })
    }
    throw new Error(
      `[AD_CAPTURE:${where}] Website capture exceeded wall clock budget (see server logs ads:capture).`
    )
  }
}

async function launchBrowserForCapture(ctx: AdsCaptureLogContext | undefined): Promise<Browser> {
  const t0 = Date.now()
  logCapture(ctx, { phase: "browser_launch", status: "start", timeoutMs: PUPPETEER_LAUNCH_MS })
  try {
    const browser = await withTimeout(
      puppeteer.launch(
        puppeteerLaunchOptions({
          defaultViewport: null,
        })
      ),
      PUPPETEER_LAUNCH_MS,
      "puppeteer.launch(ad capture)"
    )
    logCapture(ctx, {
      phase: "browser_launch",
      status: "end",
      durationMs: Date.now() - t0,
    })
    return browser
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logCapture(ctx, {
      phase: "browser_launch",
      status: "error",
      durationMs: Date.now() - t0,
      detail: msg,
    })
    throw err
  }
}

function getPreset(platform: Platform = "youtube", fastPreview?: boolean) {
  let width: number
  let height: number
  if (platform === "tiktok") {
    width = 1080
    height = 1920
  } else if (platform === "instagram") {
    width = 1080
    height = 1080
  } else {
    width = 1920
    height = 1080
  }
  if (fastPreview) {
    width = Math.max(480, Math.floor(width / 2 / 2) * 2)
    height = Math.max(480, Math.floor(height / 2 / 2) * 2)
  }
  return { width, height, fps: FPS }
}

function resolveCaptureCaps(fastPreview: boolean | undefined, novaPulseAISite = false) {
  const fast = fastPreview === true
  const vf = novaPulseAISite
  return {
    maxFrames: fast
      ? Math.min(400, Math.max(140, Math.floor(AD_CAPTURE_MAX_FRAMES * 0.38)))
      : vf
        ? Math.min(AD_CAPTURE_MAX_FRAMES, Math.floor(AD_CAPTURE_MAX_FRAMES * 0.94))
        : AD_CAPTURE_MAX_FRAMES,
    maxFramesPerSegment: fast
      ? Math.min(64, Math.max(22, Math.floor(AD_CAPTURE_MAX_FRAMES_PER_SEGMENT * 0.5)))
      : vf
        ? Math.min(102, AD_CAPTURE_MAX_FRAMES_PER_SEGMENT)
        : AD_CAPTURE_MAX_FRAMES_PER_SEGMENT,
    maxInteractiveSegments: fast
      ? Math.max(2, Math.min(vf ? 3 : 4, AD_CAPTURE_MAX_INTERACTIVE_SEGMENTS))
      : vf
        ? Math.max(4, Math.min(5, AD_CAPTURE_MAX_INTERACTIVE_SEGMENTS))
        : AD_CAPTURE_MAX_INTERACTIVE_SEGMENTS,
    maxTimelineSteps: fast
      ? Math.max(2, Math.min(3, AD_CAPTURE_MAX_TIMELINE_STEPS))
      : vf
        ? Math.max(3, Math.min(4, AD_CAPTURE_MAX_TIMELINE_STEPS))
        : AD_CAPTURE_MAX_TIMELINE_STEPS,
    maxFramesPerTimelineStep: fast
      ? Math.min(52, Math.max(16, Math.floor(AD_CAPTURE_MAX_FRAMES_PER_TIMELINE_STEP * 0.4)))
      : vf
        ? Math.min(44, Math.max(22, Math.floor(AD_CAPTURE_MAX_FRAMES_PER_TIMELINE_STEP * 0.4)))
        : AD_CAPTURE_MAX_FRAMES_PER_TIMELINE_STEP,
    gotoMs: fast
      ? Math.min(GOTO_CAPTURE_MS, Math.max(8_000, Math.floor(GOTO_CAPTURE_MS * 0.55)))
      : GOTO_CAPTURE_MS,
    settleMs: fast
      ? Math.max(200, Math.floor(CAPTURE_SETTLE_MS * 0.48))
      : vf
        ? Math.max(280, Math.floor(CAPTURE_SETTLE_MS * 0.85))
        : CAPTURE_SETTLE_MS,
    frameIntervalMs: fast
      ? Math.max(6, Math.floor(AD_CAPTURE_FRAME_INTERVAL_MS * 0.88))
      : vf
        ? Math.min(52, AD_CAPTURE_FRAME_INTERVAL_MS + 3)
        : AD_CAPTURE_FRAME_INTERVAL_MS,
    wallMs: fast
      ? Math.min(CAPTURE_WALL_MS, Math.max(72_000, Math.floor(CAPTURE_WALL_MS * (vf ? 0.38 : 0.35))))
      : CAPTURE_WALL_MS,
    minVidBytes: fast ? 48_000 : MIN_OUTPUT_BYTES,
    stepWaitCapMs: fast ? 280 : vf ? 520 : 900,
    /** Extra cap on total frame budget when using timeline mode on NovaPulseAI (fallback path). */
    maxFramesTimelineNovaPulseAI: vf ? 300 : undefined,
  }
}

function capturePathKey(navUrl: string): string {
  try {
    const u = new URL(navUrl)
    return `${u.pathname}${u.search || ""}`
  } catch {
    return navUrl
  }
}

/** Timeline capture: bucket each step for VF runtime-mix diagnostics. */
function vfTimelineFrameKind(route: string): string {
  const p = capturePathKey(route)
  if (/\/(login|signin|sign-in)\b/i.test(p)) return "timeline_login"
  if (/\/pricing\b/i.test(p)) return "timeline_pricing"
  if (p === "" || p === "/") return "timeline_hero"
  if (
    /\/(tools|dashboard|app|studio|editor|library|workflow|create|features)\b/i.test(p)
  ) {
    return "timeline_product"
  }
  return "timeline_other"
}

/** Drop lowest-value beats when the interactive plan exceeds the segment cap (NovaPulseAI). */
function trimNovaPulseAIInteractiveSegments(
  raw: InteractiveAdScene[],
  maxCount: number
): InteractiveAdScene[] {
  if (raw.length <= maxCount) return raw
  const n = raw.length
  const score = (i: number): number => {
    const s = raw[i]!
    if (s.sceneType === "transformation_proof") return 1_000
    if (s.intent === "prove" && s.sceneType !== "pricing") return 860
    if (s.intent === "convert") return 820
    if (s.intent === "explain") return 640
    if (s.intent === "attract") return 600
    if (s.sceneType === "signin") return 880
    if (s.sceneType === "signup") return 120
    /** Convert+pricing already scored above; remaining pricing beats are non-CTA. */
    if (s.sceneType === "pricing") return 280
    return 400
  }
  const droppable = Array.from({ length: n }, (_, i) => i).filter(i => {
    if (i === 0 || i === n - 1) return false
    const s = raw[i]!
    if (s.sceneType === "transformation_proof") return false
    return true
  })
  droppable.sort((a, b) => score(a) - score(b))
  const drop = new Set<number>()
  let need = raw.length - maxCount
  for (const i of droppable) {
    if (need <= 0) break
    drop.add(i)
    need--
  }
  return raw.filter((_, i) => !drop.has(i))
}

/** Reserve wall time so frames→video + margin stay inside the global cap (NovaPulseAI governor). */
const GOVERNOR_FFMPEG_RESERVE_RATIO = 0.26
/** Below this share of total wall (+ reserve), skip starting non-critical segments. */
const GOVERNOR_GLOBAL_BUFFER_RATIO = 0.24
const GOVERNOR_TRANSFORMATION_MAX_FRAMES = 90
const GOVERNOR_TRANSFORMATION_MAX_FRAMES_TIGHT = 56
const MIN_CAPTURE_SEGMENT_FRAMES = 24

function isGovernorCriticalSegment(
  seg: InteractiveAdScene,
  idx: number,
  len: number
): boolean {
   if (seg.sceneType === "transformation_proof") return true
  if (seg.sceneType === "signin") return true
  if (idx === 0) return true
  if (idx === len - 1) return true
  if (seg.intent === "convert") return true
  if (seg.intent === "prove" && seg.sceneType === "result") return true
  return false
}

function allocateGovernorSegmentBudgetsMs(
  segments: InteractiveAdScene[],
  allocatableMs: number
): number[] {
  if (!segments.length || allocatableMs <= 0) return segments.map(() => 0)
  const weights = segments.map((seg, idx) => {
    if (seg.sceneType === "transformation_proof") return 4.4
    if (idx === 0) return 2.1
    if (idx === segments.length - 1) return 1.65
    if (seg.intent === "convert") return 1.65
    if (seg.intent === "prove" && seg.sceneType === "result") return 2.9
    if (seg.intent === "explain") return 1.35
    if (seg.intent === "attract") return 1.25
    if (seg.sceneType === "signin") return 1.75
    if (seg.sceneType === "signup") return 0.55
    return 1.0
  })
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  const raw = weights.map(w => Math.floor((w / sum) * allocatableMs))
  const drift = allocatableMs - raw.reduce((a, b) => a + b, 0)
  if (raw.length) raw[raw.length - 1]! += drift
  return raw
}

/** Minimal proof path: grid reveal + clip + export (governor time crisis). */
function governorMinimalTransformationSegment(seg: InteractiveAdScene): InteractiveAdScene {
  const out: AdInteractionStep[] = []
  for (const st of seg.steps) {
    if (out.length >= 10) break
    if (st.type === "waitForSelector") {
      const w = st as { type: "waitForSelector"; selector: string; timeoutMs?: number }
      out.push({ ...w, timeoutMs: Math.min(w.timeoutMs ?? 8000, 3200) })
    } else if (st.type === "wait") {
      const w = st as { type: "wait"; ms: number }
      out.push({ ...w, ms: Math.min(w.ms, 340) })
    } else if (st.type === "scroll") {
      const w = st as { type: "scroll"; amount: number }
      if (out.filter(s => s.type === "scroll").length < 2) {
        out.push({ ...w, amount: Math.min(w.amount, 240) })
      }
    } else if (st.type === "hover") {
      const w = st as { type: "hover"; label?: string; selector?: string }
      const lab = (w.label || "").toLowerCase()
      if (lab === "clip" || lab === "export" || lab === "ready" || out.filter(s => s.type === "hover").length < 2) {
        out.push(w)
      }
    } else if (st.type === "move") {
      out.push(st)
    }
  }
  return { ...seg, steps: out, stepStartOffsetsMs: undefined }
}

/** Fewer steps / shorter selector budgets — keeps the magic beat but finishes reliably. */
function leanNovaPulseAITransformationSegment(seg: InteractiveAdScene): InteractiveAdScene {
  const out: AdInteractionStep[] = []
  let scrolls = 0
  let hovers = 0
  const keepHoverLabel = (lab: string) =>
    /^(clip|export|ready|batch|thumbnail|variant)$/.test(lab) || hovers < 2

  for (const st of seg.steps) {
    if (st.type === "waitForSelector") {
      const w = st as { type: "waitForSelector"; selector: string; timeoutMs?: number }
      out.push({
        ...w,
        timeoutMs: Math.min(w.timeoutMs ?? 8500, 4200),
      })
    } else if (st.type === "wait") {
      const w = st as { type: "wait"; ms: number }
      out.push({ ...w, ms: Math.max(120, Math.floor(w.ms * 0.52)) })
    } else if (st.type === "scroll") {
      scrolls++
      if (scrolls <= 2) {
        const w = st as { type: "scroll"; amount: number }
        out.push({ ...w, amount: Math.min(w.amount, 300) })
      }
    } else if (st.type === "hover") {
      const w = st as { type: "hover"; label?: string; selector?: string }
      const lab = (w.label || "").toLowerCase()
      hovers++
      if (hovers <= 5 && keepHoverLabel(lab)) out.push(w)
    } else {
      out.push(st)
    }
  }
  return { ...seg, steps: out, stepStartOffsetsMs: undefined }
}

function normalizeUrl(input: string) {
  // Defense in depth: ads.routes already normalizes the user-supplied siteUrl,
  // but this module can be invoked with URLs derived from persisted job
  // metadata. Re-validate before any `page.goto` so operator tooling / older
  // rows cannot bypass the guard.
  return assertPublicHttpUrl(input, {
    allowSchemeless: true,
    allowLoopback: isLoopbackIngestionAllowed(),
  })
}

async function configurePage(page: Page, platform: Platform, fastPreview?: boolean) {
  const preset = getPreset(platform, fastPreview)
  await page.setViewport({ width: preset.width, height: preset.height, deviceScaleFactor: 1 })
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36")
}

async function countClipLikeTiles(page: Page): Promise<number> {
  try {
    return await page.evaluate(() => {
      const q =
        "[class*='clip'],[class*='card'],[class*='thumbnail'],[class*='tile'],[class*='grid-item'],[role='grid'] > *,[class*='grid'] > div,article"
      return document.querySelectorAll(q).length
    })
  } catch {
    return 0
  }
}

/** Push primary content into frame; fade sticky chrome so nav never dominates. */
async function deemphasizeTopChrome(page: Page) {
  try {
    await page.evaluate(() => {
      document.querySelectorAll("nav,header,[role='navigation']").forEach(el => {
        const n = el as HTMLElement
        const r = n.getBoundingClientRect()
        if (r.height > 0 && r.height < 170 && r.top < 150) {
          n.style.opacity = "0.11"
          n.style.transition = "opacity 0.35s"
          n.style.pointerEvents = "none"
        }
      })
    })
  } catch {
    /* ignore */
  }
}

async function hideNoise(page: Page) {
  await page.evaluate(() => {
    const selectors = [
      "[class*=cookie]",
      "[class*=consent]",
      "[class*=intercom]",
      "[class*=chat]",
      "[role=dialog]",
      "iframe[title*=chat]"
    ]

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        const node = el as HTMLElement
        node.style.display = "none"
        node.style.visibility = "hidden"
        node.style.opacity = "0"
      })
    }
  })
}

async function moveMouseHuman(page: Page, x: number, y: number) {
  const start = { x: 80 + Math.random() * 250, y: 80 + Math.random() * 180 }
  const steps = 35 + Math.floor(Math.random() * 15)
  const c1 = { x: start.x + (x - start.x) * 0.35 + (Math.random() - 0.5) * 120, y: start.y + (y - start.y) * 0.15 + (Math.random() - 0.5) * 120 }
  const c2 = { x: start.x + (x - start.x) * 0.65 + (Math.random() - 0.5) * 120, y: start.y + (y - start.y) * 0.85 + (Math.random() - 0.5) * 120 }

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const inv = 1 - t
    const px =
      inv * inv * inv * start.x +
      3 * inv * inv * t * c1.x +
      3 * inv * t * t * c2.x +
      t * t * t * x
    const py =
      inv * inv * inv * start.y +
      3 * inv * inv * t * c1.y +
      3 * inv * t * t * c2.y +
      t * t * t * y

    await page.mouse.move(px, py)
    await sleep(4 + Math.floor(Math.random() * 8))
  }
}

async function smoothScroll(page: Page, total = 1200) {
  let done = 0
  while (done < total) {
    const chunk = 80 + Math.random() * 120
    await page.mouse.wheel({ deltaY: chunk })
    done += chunk
    await sleep(140 + Math.random() * 110)
  }
}

async function hoverElement(page: Page, el: ElementHandle<Element>) {
  const box = await el.boundingBox()
  if (!box) return
  await moveMouseHuman(page, box.x + box.width / 2, box.y + box.height / 2)
  await sleep(220)
}

async function clickElement(page: Page, el: ElementHandle<Element>) {
  const box = await el.boundingBox()
  if (!box) return
  await moveMouseHuman(page, box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await sleep(40 + Math.random() * 50)
  await page.mouse.up()
}

async function typeHuman(page: Page, selector: string, value: string) {
  const el = await page.$(selector)
  if (!el) return false

  await clickElement(page, el)
  await page.keyboard.down("Control")
  await page.keyboard.press("A")
  await page.keyboard.up("Control")
  await page.keyboard.press("Backspace")

  for (const ch of value) {
    await page.keyboard.type(ch, { delay: 35 + Math.floor(Math.random() * 50) })
  }

  return true
}

async function findClickable(page: Page, selectors: string[]): Promise<ElementHandle<Element> | null> {
  for (const selector of selectors) {
    const el = await page.$(selector)
    if (el) return el
  }
  return null
}

async function captureFrame(page: Page, framesDir: string, index: number) {
  const file = path.join(framesDir, `${String(index).padStart(6, "0")}.png`)
  await page.screenshot({ path: file, type: "png" })
}

async function resolveFocusRect(
  page: Page,
  region: InteractiveFocalRegion
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate((r: InteractiveFocalRegion) => {
    const box = (el: Element | null) => {
      if (!el) return null
      const html = el as HTMLElement
      const b = html.getBoundingClientRect()
      if (b.width < 12 || b.height < 12) return null
      return { x: b.x, y: b.y, width: b.width, height: b.height }
    }
    const first = (...selectors: string[]) => {
      for (const s of selectors) {
        const el = document.querySelector(s)
        const b = box(el)
        if (b) return b
      }
      return null
    }

    if (r === "hero") return first("h1", "[class*='hero']", "header")
    if (r === "form") return first("form", "[role='search']")
    if (r === "nav") return first("nav", "header")
    if (r === "result") {
      return first(
        "main",
        "[role='main']",
        "article",
        "pre",
        "[class*='output']",
        "[class*='result']"
      )
    }
    if (r === "cta") {
      return first("footer", "[class*='cta']", "[class*='CTA']")
    }
    return null
  }, region)
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function panWeightForIntent(intent: InteractiveSceneIntent | undefined): number {
  switch (intent) {
    case "prove":
      return 0.9
    case "convert":
      return 0.74
    case "explain":
      return 0.58
    case "attract":
      return 0.36
    default:
      return 0.5
  }
}

function scaleOffsetsToSegmentWall(
  offsetsMs: number[],
  segmentWallMs: number,
  baseSceneDurMs: number
): number[] {
  const scaleT = segmentWallMs / Math.max(400, baseSceneDurMs)
  let last = -130
  return offsetsMs.map(o => {
    const ms = Math.floor(o * scaleT)
    const next = Math.max(ms, last + 110)
    last = next
    return Math.min(next, Math.max(0, segmentWallMs - 35))
  })
}

async function ambientCursorNudge(
  page: Page,
  preset: { width: number; height: number },
  intent: InteractiveSceneIntent | undefined,
  frameIndex: number,
  t: number
) {
  if (intent === "prove" && Math.random() > 0.42) return
  if (Math.random() > 0.38) return
  const vw = preset.width
  const vh = preset.height
  const bx = vw * (0.32 + 0.36 * Math.sin(frameIndex * 0.21 + t * 1.7))
  const by = vh * (0.26 + 0.38 * Math.cos(frameIndex * 0.19 + t * 1.4))
  try {
    const steps = 2 + Math.floor(Math.random() * 5)
    await page.mouse.move(
      Math.max(40, Math.min(vw - 40, bx + (Math.random() - 0.5) * 55)),
      Math.max(40, Math.min(vh - 40, by + (Math.random() - 0.5) * 48)),
      { steps }
    )
  } catch {
    /* ignore */
  }
}

/**
 * Virtual camera: continuous subtle zoom + drift + slow pan toward focal region.
 * Bias composition away from caption band on vertical/square (matches ads.renderer safe zones).
 */
async function captureFrameCinematic(
  page: Page,
  framesDir: string,
  index: number,
  preset: { width: number; height: number },
  platform: Platform,
  intent: InteractiveSceneIntent | undefined,
  focalRegion: InteractiveFocalRegion | undefined,
  t: number,
  segmentSeed: number,
  demoSceneKind?: ProductDemoSceneKind,
  densityPullBack?: boolean,
  proofPanOnly?: boolean
) {
  const file = path.join(framesDir, `${String(index).padStart(6, "0")}.png`)
  const vw = preset.width
  const vh = preset.height

  let focus: { x: number; y: number; width: number; height: number } | null = null
  if (focalRegion) {
    try {
      focus = await resolveFocusRect(page, focalRegion)
    } catch {
      focus = null
    }
  }
  if (!focus || focus.width < 12 || focus.height < 12) focus = null

  const focusCx = focus ? focus.x + focus.width / 2 : vw / 2
  const focusCy = focus ? focus.y + focus.height / 2 : vh / 2

  const gridLike =
    demoSceneKind === "transformation_proof" ||
    (demoSceneKind === "result" && intent === "prove")

  const panW =
    (focalRegion ? panWeightForIntent(intent) : 0.22) *
    smoothstep(0.06, 0.92, t) *
    (gridLike ? 0.55 : 1)
  let centerX = vw / 2 + (focusCx - vw / 2) * panW
  let centerY = vh / 2 + (focusCy - vh / 2) * panW

  const captionBiasY =
    platform === "tiktok" ? -vh * 0.065 : platform === "instagram" ? -vh * 0.045 : -vh * 0.02
  centerY += captionBiasY

  let breathe = Math.sin(t * Math.PI * 2 * 0.82 + segmentSeed) * 0.024
  let breathe2 = Math.sin(t * Math.PI * 1.07 + segmentSeed * 1.63) * 0.016
  let zoomBase =
    intent === "prove" ? 1.04 : intent === "convert" ? 1.048 : intent === "explain" ? 1.036 : 1.028
  if (intent === "attract") zoomBase = 1.018

  let settleIn = intent === "prove" ? 0.022 * smoothstep(0.15, 0.95, t) : 0.012 * smoothstep(0.2, 0.9, t)

  if (gridLike) {
    zoomBase = proofPanOnly === true ? 1 : densityPullBack === true ? 0.975 : 1.0
    if (proofPanOnly === true) {
      breathe = 0
      breathe2 = 0
      settleIn = 0
    } else {
      breathe *= 0.12
      breathe2 *= 0.12
      settleIn *= 0.15
    }
  }

  const zoom =
    gridLike && proofPanOnly === true ? 1 : zoomBase + breathe + breathe2 + settleIn

  const driftAmpX = gridLike
    ? vw * 0.0045
    : intent === "prove"
      ? vw * 0.008
      : vw * 0.014
  const driftAmpY = gridLike
    ? vh * 0.004
    : intent === "prove"
      ? vh * 0.007
      : vh * 0.013
  const driftX = Math.sin(t * 6.6 + segmentSeed * 0.9) * driftAmpX
  const driftY = Math.cos(t * 5.2 + segmentSeed * 1.1) * driftAmpY

  centerX += driftX
  centerY += driftY

  const cw = vw / zoom
  const ch = vh / zoom
  let x = centerX - cw / 2
  let y = centerY - ch / 2
  x = Math.max(0, Math.min(x, vw - cw))
  y = Math.max(0, Math.min(y, vh - ch))

  const clip = {
    x: Math.floor(x),
    y: Math.floor(y),
    width: Math.floor(cw),
    height: Math.floor(ch),
  }

  try {
    if (clip.width >= 200 && clip.height >= 200) {
      await page.screenshot({ path: file, type: "png", clip })
    } else {
      await page.screenshot({ path: file, type: "png" })
    }
  } catch {
    await page.screenshot({ path: file, type: "png" })
  }
}

async function renderFramesToVideo(
  framesDir: string,
  outputPath: string,
  platform: Platform,
  ctx?: AdsCaptureLogContext,
  fastPreview?: boolean
): Promise<void> {
  const preset = getPreset(platform, false)

  const args = [
    "-y",
    "-framerate", String(preset.fps),
    "-i", ff(path.join(framesDir, "%06d.png")),
    "-vf", `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease,pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p`,
    "-c:v", "libx264",
    "-preset", fastPreview ? "veryfast" : "slow",
    "-crf", fastPreview ? "22" : "16",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    ff(outputPath)
  ]

  const t0 = Date.now()
  logCapture(ctx, { phase: "frames_to_video", status: "start", timeoutMs: FRAMES_TO_VIDEO_MS })

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { windowsHide: true })
    let stderr = ""
    const killTimer = setTimeout(() => {
      try {
        proc.kill("SIGKILL")
      } catch {
        /* ignore */
      }
      reject(
        new Error(
          `[AD_CAPTURE:frames_to_video] ffmpeg frames-to-video timed out after ${FRAMES_TO_VIDEO_MS}ms`
        )
      )
    }, FRAMES_TO_VIDEO_MS)

    proc.stderr.on("data", d => {
      stderr += d.toString()
    })

    proc.on("close", code => {
      clearTimeout(killTimer)
      if (code === 0) resolve()
      else reject(new Error(stderr || `ffmpeg exited with ${code}`))
    })

    proc.on("error", err => {
      clearTimeout(killTimer)
      reject(err)
    })
  })

  logCapture(ctx, {
    phase: "frames_to_video",
    status: "end",
    durationMs: Date.now() - t0,
  })

  const stats = fs.statSync(outputPath)
  const minBytes = fastPreview ? 48_000 : MIN_OUTPUT_BYTES
  if (stats.size < minBytes) {
    throw new Error("Capture video too small")
  }
}

async function settle(page: Page, ms = 900) {
  await hideNoise(page)
  await sleep(ms)
}

/** Returns whether navigation likely succeeded (bounded waits; avoids networkidle2 stalls). */
async function gotoCaptureNav(
  page: Page,
  targetUrl: string,
  nav?: { gotoMs: number; settleMs: number }
): Promise<boolean> {
  const gotoMs = nav?.gotoMs ?? GOTO_CAPTURE_MS
  const settleMs = nav?.settleMs ?? CAPTURE_SETTLE_MS
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: gotoMs })
    await settle(page, settleMs)
    return true
  } catch {
    try {
      await page.goto(targetUrl, { waitUntil: "load", timeout: 16_000 })
      await settle(page, settleMs)
      return true
    } catch {
      return false
    }
  }
}

function emitCaptureProgress(
  options: CaptureOptions,
  frameIndex: number,
  totalFrames: number,
  state: { lastPct: number }
) {
  if (!options.onCaptureProgress || totalFrames <= 0) return
  const pct = Math.min(99, Math.floor((frameIndex / totalFrames) * 100))
  if (pct - state.lastPct >= 3 || frameIndex === 0 || (frameIndex >= totalFrames - 1 && pct > state.lastPct)) {
    state.lastPct = pct
    options.onCaptureProgress(pct)
  }
}

function segmentNavigationUrl(baseUrl: string, pageHint: string): string {
  const base = normalizeUrl(baseUrl)
  const hint = String(pageHint || "/").trim()
  if (/^https?:\/\//i.test(hint)) return hint
  const pathPart = hint.startsWith("/") ? hint : `/${hint}`
  return new URL(pathPart, new URL(base).origin).href
}

async function runSegmentInteractionSteps(
  page: Page,
  seg: InteractiveAdScene,
  interaction: InteractionCaptureOptions | undefined,
  maxWallMs: number,
  tuning?: Pick<InteractionCaptureOptions, "capturePressure" | "novaPulseAILeanCapture">
) {
  const opts: InteractionCaptureOptions = {
    allowDestructiveSubmit: false,
    timingProfile: "cinematic",
    pacingMultiplier: 1,
    ...interaction,
    ...tuning,
    sceneIntent: seg.intent,
    focalRegion: seg.focalRegion,
  }
  const deadline = Date.now() + maxWallMs
  for (const step of seg.steps) {
    if (Date.now() > deadline) break
    try {
      await runInteractionStep(page, step, opts)
    } catch {
      /* step-level fallback: continue segment */
    }
  }
}

async function captureWebsiteInteractive(
  url: string,
  options: CaptureOptions
): Promise<CaptureResult> {
  const vfCapture = resolveNovaPulseAICaptureProfile(url)
  const novaPulseAISite = vfCapture.active
  console.log(
    "[ads:capture env] AD_TREAT_LOCALHOST_AS_NOVAPULSEAI =",
    process.env.AD_TREAT_LOCALHOST_AS_NOVAPULSEAI ?? "(unset)"
  )
  const caps = resolveCaptureCaps(options.fastPreview, novaPulseAISite)
  const navBudget = { gotoMs: caps.gotoMs, settleMs: caps.settleMs }
  const segmentsRaw = options.interactiveSegments!
  const segments = novaPulseAISite
    ? trimNovaPulseAIInteractiveSegments(segmentsRaw, caps.maxInteractiveSegments)
    : segmentsRaw.length > caps.maxInteractiveSegments
      ? segmentsRaw.slice(0, caps.maxInteractiveSegments)
      : segmentsRaw
  const platform = options.platform || "youtube"
  const duration = Math.max(8, Math.min(60, options.duration || DEFAULT_DURATION))
  const preset = getPreset(platform, options.fastPreview)
  const framesDir = path.join(TMP_DIR, uid("frames"))
  const outputPath = path.join(TMP_DIR, `${uid("capture")}.mp4`)
  const screenshots: string[] = []
  const pagesVisited: string[] = []

  ensureDir(framesDir)

  const wallEnd = Date.now() + caps.wallMs
  const sessionStart = Date.now()
  const rawTotalFrames = Math.round(duration * preset.fps)
  const totalFrames = Math.min(rawTotalFrames, caps.maxFrames)
  const progressState = { lastPct: -10 }

  logCapture(options.logContext, {
    phase: "capture_session",
    mode: "interactive",
    status: "start",
    fastPreview: options.fastPreview === true,
    novaPulseAICaptureProfile: novaPulseAISite,
    novaPulseAICaptureReason: vfCapture.reason,
    captureSiteHost: vfCapture.host,
    wallClockBudgetMs: caps.wallMs,
    segmentCount: segments.length,
    segmentsRaw: segmentsRaw.length,
    frameBudget: totalFrames,
    frameBudgetUncapped: rawTotalFrames,
  })
  options.onCaptureProgress?.(0)

  let browser: Browser | null = null

  try {
    assertCaptureWall(wallEnd, "interactive pre-launch")
    browser = await launchBrowserForCapture(options.logContext)

    const page = await browser.newPage()
    await configurePage(page, platform, options.fastPreview)
    // Navigation-time SSRF guard: closes DNS-rebinding TOCTOU and cross-origin
    // 3xx redirects into private space for every `page.goto` this session
    // performs. Installed before the first navigation.
    await installNavigationSsrfGuard(page, {
      allowLoopback: isLoopbackIngestionAllowed(),
      onBlock: ({ url: blockedUrl, reason, resourceType }) => {
        logCapture(options.logContext, {
          phase: "ssrf_navigation_blocked",
          mode: "interactive",
          url: blockedUrl,
          resourceType,
          reason,
        })
      },
    })

    const totalSegDur =
      segments.reduce((a, s) => a + Math.max(0.05, Number(s.duration) || 2), 0) || 1

    let frameIndex = 0
    const pacingMul = options.fastPreview ? 0.52 : novaPulseAISite ? 0.92 : 1
    let lastNavPath = ""

    const signinSegIdx = novaPulseAISite ? segments.findIndex(s => s.sceneType === "signin") : -1
    let npaiLoginSuccess = false
    let vfLoginFailed = false
    let vfRouteLock: ReturnType<typeof vfPostLoginAllowedPathKeys> | null = null
    const postLoginRoutesVisited: string[] = []
    const framesByKind: Record<string, number> = {}
    const vfBump = (kind: string, n = 1) => {
      framesByKind[kind] = (framesByKind[kind] ?? 0) + n
    }
    let maxTransformationTiles = 0
    let postLoginAppReached = false
    let postLoginFrameCount = 0
    let ffmpegReserveMs = 0
    let captureBudgetEnd = wallEnd
    let segmentBudgetsMs: number[] = []
    let governorSegmentsSkipped = 0
    if (novaPulseAISite) {
      ffmpegReserveMs = Math.max(
        55_000,
        Math.min(170_000, Math.floor(caps.wallMs * GOVERNOR_FFMPEG_RESERVE_RATIO))
      )
      captureBudgetEnd = wallEnd - ffmpegReserveMs
      const poolMs = Math.max(25_000, captureBudgetEnd - Date.now())
      segmentBudgetsMs = allocateGovernorSegmentBudgetsMs(segments, Math.floor(poolMs * 0.8))
      logCapture(options.logContext, {
        phase: "budget_governor_start",
        tag: "[AD_CAPTURE:budget_governor]",
        captureBudgetEndMs: captureBudgetEnd,
        ffmpegReserveMs,
        globalWallMs: caps.wallMs,
        perSegmentBudgetMs: segmentBudgetsMs,
      })
    }

    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      const seg = segments[segIdx]!
      assertCaptureWall(wallEnd, "interactive segment start")

      let pageHintEff = seg.pageHint
      if (
        novaPulseAISite &&
        npaiLoginSuccess &&
        vfRouteLock &&
        signinSegIdx >= 0 &&
        segIdx > signinSegIdx
      ) {
        const cand = segmentNavigationUrl(url, pageHintEff)
        const key = capturePathKey(cand)
        const isCta = seg.sceneType === "pricing" || seg.intent === "convert"
        if ((key === vfRouteLock.heroPath || /\/(login|signin|sign-in)\b/i.test(key)) && !isCta) {
          logCapture(options.logContext, {
            phase: "vf_route_clamp",
            fromPath: key,
            toPath: vfRouteLock.toolsPath,
            reason: "post_login_avoid_landing_or_auth",
          })
          pageHintEff = vfRouteLock.toolsPath
        } else if (!vfRouteLock.keys.has(key) && !isCta) {
          const to =
            /grid|clip|output|batch|library|studio|editor/i.test(key) || seg.sceneType === "result"
              ? vfRouteLock.resultsPath
              : vfRouteLock.toolsPath
          logCapture(options.logContext, {
            phase: "vf_route_clamp",
            fromPath: key,
            toPath: to,
            reason: "post_login_allowed_set",
          })
          pageHintEff = to
        }
      }

      const navUrl = segmentNavigationUrl(url, pageHintEff)
      const pathKey = capturePathKey(navUrl)
      const remainingMs = wallEnd - Date.now()
      const usedRatio = 1 - remainingMs / caps.wallMs
      const pressure: InteractionCaptureOptions["capturePressure"] =
        usedRatio > 0.72 ? "severe" : usedRatio > 0.52 ? "degraded" : "normal"
      if (novaPulseAISite && (pressure === "degraded" || pressure === "severe")) {
        logCapture(options.logContext, {
          phase: "capture_pressure",
          pressure,
          usedRatio: Math.round(usedRatio * 1000) / 1000,
          remainingMs,
        })
      }

      const governorCritical = novaPulseAISite && isGovernorCriticalSegment(seg, segIdx, segments.length)
      if (novaPulseAISite) {
        const bufferFloor =
          Math.floor(caps.wallMs * GOVERNOR_GLOBAL_BUFFER_RATIO) + ffmpegReserveMs
        const pastSegmentCutoff = Date.now() >= captureBudgetEnd
        const globalBufferLow = remainingMs < bufferFloor
        const segBudgetMs = segmentBudgetsMs[segIdx] ?? 8_000
        const projectedOverBudget = Date.now() + segBudgetMs > captureBudgetEnd
        if (
          !governorCritical &&
          (pastSegmentCutoff || globalBufferLow || (projectedOverBudget && segIdx > 0))
        ) {
          governorSegmentsSkipped++
          logCapture(options.logContext, {
            phase: "budget_cutoff",
            tag: "[AD_CAPTURE:budget_cutoff]",
            remainingMs,
            segmentsSkipped: governorSegmentsSkipped,
            currentSegment: segIdx,
            currentSceneType: seg.sceneType,
            reason: pastSegmentCutoff
              ? "past_capture_phase_deadline"
              : globalBufferLow
                ? "global_buffer_low"
                : "segment_budget_projection",
          })
          continue
        }
      }

      const nearCapturePhaseEnd =
        novaPulseAISite && captureBudgetEnd - Date.now() < 42_000

      let segWorking: InteractiveAdScene = seg
      if (novaPulseAISite && seg.sceneType === "transformation_proof") {
        if (nearCapturePhaseEnd || pressure === "severe") {
          segWorking = governorMinimalTransformationSegment(leanNovaPulseAITransformationSegment(seg))
        } else {
          segWorking = leanNovaPulseAITransformationSegment(seg)
        }
      }

      if (pathKey !== lastNavPath) {
        const okNav = await gotoCaptureNav(page, navUrl, navBudget)
        if (okNav) pagesVisited.push(navUrl)
        else {
          const okFallback = await gotoCaptureNav(page, normalizeUrl(url), navBudget)
          if (okFallback) pagesVisited.push(normalizeUrl(url))
        }
        lastNavPath = pathKey
      } else {
        logCapture(options.logContext, {
          phase: "nav_skip_duplicate",
          path: pathKey,
          novaPulseAI: novaPulseAISite,
        })
        await settle(page, Math.min(220, caps.settleMs))
      }

      if (novaPulseAISite) {
        await deemphasizeTopChrome(page)
      }

      const segDur = Math.max(0.5, Number(seg.duration) || 2)
      const intentMul =
        seg.intent === "prove" ? 1.14 : seg.intent === "convert" ? 1.08 : seg.intent === "attract" ? 0.94 : 1
      let stepBudget =
        Math.min(9800, Math.max(1700, segDur * 520 * intentMul)) * pacingMul
      if (novaPulseAISite) {
        stepBudget *=
          seg.sceneType === "signin" ? 1.02 : seg.sceneType === "signup" ? 0.52 : 0.88
        const gb = segmentBudgetsMs[segIdx]
        if (gb !== undefined && gb > 0) {
          const gbFrac = seg.sceneType === "signin" ? 0.78 : 0.52
          stepBudget = Math.min(stepBudget, Math.max(900, Math.floor(gb * gbFrac)))
        }
      }
      if (pressure === "severe") stepBudget *= 0.38
      else if (pressure === "degraded") stepBudget *= 0.66

      let targetFrames = Math.max(1, Math.round((segDur / totalSegDur) * totalFrames))
      targetFrames = Math.min(targetFrames, caps.maxFramesPerSegment)
      targetFrames = Math.max(MIN_CAPTURE_SEGMENT_FRAMES, targetFrames)
      if (novaPulseAISite && seg.sceneType === "transformation_proof") {
        const cap =
          nearCapturePhaseEnd || pressure !== "normal"
            ? GOVERNOR_TRANSFORMATION_MAX_FRAMES_TIGHT
            : GOVERNOR_TRANSFORMATION_MAX_FRAMES
        targetFrames = Math.min(targetFrames, cap)
        targetFrames = Math.max(
          targetFrames,
          pressure === "severe" ? MIN_CAPTURE_SEGMENT_FRAMES : Math.round(2.5 * preset.fps)
        )
      }
      if (pressure === "severe") targetFrames = Math.max(MIN_CAPTURE_SEGMENT_FRAMES, Math.floor(targetFrames * 0.5))
      else if (pressure === "degraded")
        targetFrames = Math.max(MIN_CAPTURE_SEGMENT_FRAMES, Math.floor(targetFrames * 0.76))

      const segmentLoopStartedAt = Date.now()
      const segmentHardDeadlineMs =
        novaPulseAISite && segmentBudgetsMs[segIdx] !== undefined
          ? segmentLoopStartedAt + Math.max(2_500, segmentBudgetsMs[segIdx]!)
          : Number.POSITIVE_INFINITY
      const segmentWallMs = (targetFrames / preset.fps) * 1000
      const baseSceneDurMs = Math.max(500, segDur * 1000)

      const captureTuning: Pick<InteractionCaptureOptions, "capturePressure" | "novaPulseAILeanCapture"> = {
        capturePressure: pressure,
        novaPulseAILeanCapture:
          novaPulseAISite &&
          (options.fastPreview === true ||
            pressure !== "normal" ||
            segWorking.sceneType === "transformation_proof"),
      }

      const useTimedSteps =
        Array.isArray(segWorking.stepStartOffsetsMs) &&
        segWorking.stepStartOffsetsMs.length === segWorking.steps.length &&
        segWorking.steps.length > 0

      const scaledOffsets = useTimedSteps
        ? scaleOffsetsToSegmentWall(segWorking.stepStartOffsetsMs!, segmentWallMs, baseSceneDurMs)
        : null

      if (!useTimedSteps) {
        await runSegmentInteractionSteps(
          page,
          segWorking,
          options.interaction,
          stepBudget,
          captureTuning
        )
      }

      if (novaPulseAISite && segWorking.sceneType === "signin") {
        const loginCapEarly = Math.min(
          22_000,
          Math.max(
            1200,
            Math.min(
              Number.isFinite(segmentHardDeadlineMs)
                ? Math.max(0, segmentHardDeadlineMs - Date.now())
                : 18_000,
              wallEnd - Date.now() - 12_000
            )
          )
        )
        const authEarly = await finalizeNovaPulseAIDemoLogin(page, options.logContext, loginCapEarly)
        if (authEarly.ok && options.vfSiteIngestion) {
          vfRouteLock = vfPostLoginAllowedPathKeys(options.vfSiteIngestion)
          const toolsNav = segmentNavigationUrl(url, vfRouteLock.toolsPath)
          const okTools = await gotoCaptureNav(page, toolsNav, navBudget)
          let inApp = okTools && (await isNovaPulseAILoggedIn(page))
          if (okTools && !inApp) {
            await settle(page, Math.min(900, caps.settleMs * 2))
            inApp = await isNovaPulseAILoggedIn(page)
          }
          postLoginAppReached = Boolean(okTools && inApp)
          logCapture(options.logContext, {
            phase: "vf_post_login_app_nav",
            tools_nav_ok: okTools,
            logged_in_state_ok: inApp,
            post_login_app_reached: postLoginAppReached,
            path: vfRouteLock.toolsPath,
          })
        } else if (authEarly.ok) {
          postLoginAppReached = true
        } else {
          postLoginAppReached = false
        }

        npaiLoginSuccess = authEarly.ok && postLoginAppReached
        vfLoginFailed = !npaiLoginSuccess
        logCapture(options.logContext, {
          phase: "vf_demo_auth",
          demo_auth_success: authEarly.ok,
          demo_auth_failed: !authEarly.ok,
          login_form_detected: authEarly.loginFormDetected,
          submit_attempted: authEarly.submitAttempted,
          post_login_app_reached: postLoginAppReached,
          used_logged_in_flow: npaiLoginSuccess,
          login_cap_ms: loginCapEarly,
        })
      }

      if (novaPulseAISite && npaiLoginSuccess && segIdx > signinSegIdx && signinSegIdx >= 0) {
        postLoginRoutesVisited.push(pathKey)
      }

      const still = path.join(TMP_DIR, `${uid(String(segWorking.sceneType))}.png`)
      try {
        await page.screenshot({ path: still, type: "png", fullPage: false })
        screenshots.push(still)
      } catch {}

      const stepOpts: InteractionCaptureOptions = {
        allowDestructiveSubmit: false,
        timingProfile: "cinematic",
        pacingMultiplier: 1,
        ...options.interaction,
        ...captureTuning,
        sceneIntent: segWorking.intent,
        focalRegion: segWorking.focalRegion,
      }

      let vfProofPanOnly =
        novaPulseAISite && npaiLoginSuccess && segWorking.sceneType === "transformation_proof"

      let densityPullBack = false
      if (novaPulseAISite && segWorking.sceneType === "transformation_proof") {
        await deemphasizeTopChrome(page)
        try {
          await page.evaluate(() => {
            window.scrollBy(0, Math.min(110, window.innerHeight * 0.09))
          })
          await sleep(170)
        } catch {
          /* ignore */
        }
        let tileN = await countClipLikeTiles(page)
        if (tileN < 6) {
          try {
            await smoothScroll(page, 520)
            await sleep(220)
          } catch {
            /* ignore */
          }
          tileN = await countClipLikeTiles(page)
          if (tileN < 6) {
            try {
              await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.26))
              await sleep(260)
            } catch {
              /* ignore */
            }
            densityPullBack = true
          }
        }
        maxTransformationTiles = Math.max(maxTransformationTiles, tileN)
        logCapture(options.logContext, {
          phase: "vf_transformation_tiles",
          visible_tiles_count: tileN,
          density_pull_back: densityPullBack,
        })
      }

      if (vfProofPanOnly) {
        densityPullBack = false
      }

      let stepIdx = 0
      const segmentStart = Date.now()
      const segmentSeed =
        (segWorking.builtSceneIndex ?? 0) * 1.713 + (String(segWorking.sceneType).length % 9) * 0.37

      for (let i = 0; i < targetFrames && frameIndex < totalFrames; i++) {
        if (i % 24 === 0) {
          assertCaptureWall(wallEnd, "interactive frame loop", {
            logContext: options.logContext,
            detail: {
              novaPulseAICaptureProfile: novaPulseAISite,
              novaPulseAICaptureReason: vfCapture.reason,
              captureSiteHost: vfCapture.host,
              segmentIndex: segIdx,
              innerFrameIndex: i,
              framesCapturedSoFar: frameIndex,
              frameTarget: totalFrames,
            },
          })
        }
        if (novaPulseAISite && Date.now() >= segmentHardDeadlineMs) {
          logCapture(options.logContext, {
            phase: "budget_cutoff",
            tag: "[AD_CAPTURE:budget_cutoff]",
            remainingMs: wallEnd - Date.now(),
            segmentsSkipped: governorSegmentsSkipped,
            currentSegment: segIdx,
            currentSceneType: seg.sceneType,
            reason: "segment_soft_budget_exhausted",
          })
          break
        }
        emitCaptureProgress(options, frameIndex, totalFrames, progressState)
        const elapsed = Date.now() - segmentStart
        if (useTimedSteps && scaledOffsets) {
          while (
            stepIdx < segWorking.steps.length &&
            scaledOffsets[stepIdx]! <= elapsed
          ) {
            try {
              await runInteractionStep(page, segWorking.steps[stepIdx]!, stepOpts)
            } catch {
              /* continue */
            }
            stepIdx++
          }
        }

        if (useTimedSteps && Math.random() < 0.07) {
          await sleep(38 + Math.floor(Math.random() * 55))
        }

        const tProg = targetFrames > 1 ? i / (targetFrames - 1) : 0
        await ambientCursorNudge(page, preset, segWorking.intent, frameIndex, tProg)
        await captureFrameCinematic(
          page,
          framesDir,
          frameIndex,
          preset,
          platform,
          segWorking.intent,
          segWorking.focalRegion,
          tProg,
          segmentSeed,
          segWorking.sceneType,
          densityPullBack,
          vfProofPanOnly
        )
        vfBump(segWorking.sceneType)
        const countPostLogin =
          novaPulseAISite &&
          npaiLoginSuccess &&
          signinSegIdx >= 0 &&
          (segIdx > signinSegIdx ||
            (segIdx === signinSegIdx && postLoginAppReached))
        if (countPostLogin) postLoginFrameCount++
        frameIndex++
        await sleep(caps.frameIntervalMs)
      }

      if (useTimedSteps) {
        while (stepIdx < segWorking.steps.length) {
          try {
            await runInteractionStep(page, segWorking.steps[stepIdx]!, stepOpts)
          } catch {
            /* continue */
          }
          stepIdx++
        }
      }

    }

    if (novaPulseAISite) {
      const totalDur = segments.reduce((a, s) => a + Math.max(0.05, Number(s.duration) || 2), 0) || 1
      const xfDur = segments
        .filter(s => s.sceneType === "transformation_proof")
        .reduce((a, s) => a + Math.max(0.05, Number(s.duration) || 2), 0)
      const vfFrameTotal =
        Object.values(framesByKind).reduce((a, b) => a + b, 0) || 1
      logCapture(options.logContext, {
        phase: "vf_capture_summary",
        used_logged_in_flow: npaiLoginSuccess,
        demo_auth_failed: vfLoginFailed,
        post_login_routes: [...new Set(postLoginRoutesVisited)],
        transformation_share_pct: Math.round((xfDur / totalDur) * 1000) / 10,
        runtime_share_pct: {
          signin: Math.round(((framesByKind.signin ?? 0) / vfFrameTotal) * 1000) / 10,
          pricing: Math.round(((framesByKind.pricing ?? 0) / vfFrameTotal) * 1000) / 10,
          transformation_proof:
            Math.round(((framesByKind.transformation_proof ?? 0) / vfFrameTotal) * 1000) / 10,
          product_surface: Math.round(
            ((framesByKind.dashboard ?? 0) +
              (framesByKind.tool_preview ?? 0) +
              (framesByKind.feature_walkthrough ?? 0) +
              (framesByKind.result ?? 0) +
              (framesByKind.transformation_proof ?? 0)) /
              vfFrameTotal *
              1000
          ) / 10,
          padding: Math.round(((framesByKind.padding ?? 0) / vfFrameTotal) * 1000) / 10,
        },
        max_transformation_tiles: maxTransformationTiles,
        post_login_frame_pct:
          frameIndex > 0 ? Math.round((postLoginFrameCount / frameIndex) * 1000) / 10 : 0,
      })
    }

    const paddingDeadline = novaPulseAISite ? captureBudgetEnd - 6_000 : wallEnd
    while (frameIndex < totalFrames) {
      assertCaptureWall(wallEnd, "interactive padding frames", {
        logContext: options.logContext,
        detail: {
          novaPulseAICaptureProfile: novaPulseAISite,
          novaPulseAICaptureReason: vfCapture.reason,
          captureSiteHost: vfCapture.host,
          framesCapturedSoFar: frameIndex,
          frameTarget: totalFrames,
        },
      })
      if (novaPulseAISite && Date.now() >= paddingDeadline) {
        logCapture(options.logContext, {
          phase: "budget_cutoff",
          tag: "[AD_CAPTURE:budget_cutoff]",
          remainingMs: wallEnd - Date.now(),
          segmentsSkipped: governorSegmentsSkipped,
          currentSegment: segments.length,
          currentSceneType: "padding",
          reason: "padding_truncated_for_ffmpeg_reserve",
          framesCaptured: frameIndex,
          frameTarget: totalFrames,
        })
        break
      }
      emitCaptureProgress(options, frameIndex, totalFrames, progressState)
      await captureFrame(page, framesDir, frameIndex)
      vfBump("padding")
      frameIndex++
      await sleep(caps.frameIntervalMs)
    }

    options.onCaptureProgress?.(100)
    await renderFramesToVideo(
      framesDir,
      outputPath,
      platform,
      options.logContext,
      options.fastPreview
    )

    logCapture(options.logContext, {
      phase: "capture_session",
      mode: "interactive",
      status: "end",
      durationMs: Date.now() - sessionStart,
      pagesVisited: pagesVisited.length,
      ...(novaPulseAISite ? { governorSegmentsSkipped } : {}),
    })

    const demoCfg = novaPulseAIDemoLoginConfigured()
    const demoAttempted = novaPulseAISite && signinSegIdx >= 0 && demoCfg
    const novaPulseAIDiagnostics: NovaPulseAICaptureDiagnostics | undefined = novaPulseAISite
      ? {
          captureMode: "interactive",
          framesByKind: { ...framesByKind },
          totalFrames: Math.max(1, frameIndex),
          demoLoginConfigured: demoCfg,
          demoLoginAttempted: Boolean(demoAttempted),
          demoLoginSucceeded: Boolean(demoAttempted && npaiLoginSuccess),
          postLoginAppReached,
          postLoginFrameShare:
            frameIndex > 0 ? postLoginFrameCount / Math.max(1, frameIndex) : 0,
          maxTransformationTiles,
          postLoginDistinctRoutes: new Set(postLoginRoutesVisited).size,
          fallbackFromInteractive: options.fallbackFromInteractive === true,
        }
      : undefined

    return {
      videoPath: outputPath,
      duration,
      pagesVisited,
      screenshots,
      ...(novaPulseAIDiagnostics ? { novaPulseAIDiagnostics } : {}),
    }
  } finally {
    if (browser) {
      try {
        await browser.close()
      } catch {}
    }
  }
}

function buildTimeline(
  baseUrl: string,
  email: string,
  password: string,
  preferredPaths?: string[]
): TimelineStep[] {
  const root = new URL(baseUrl)
  const withRoute = (route: string) => new URL(route, root.origin).href

  const pref =
    preferredPaths
      ?.map(p => (p.startsWith("/") ? p : `/${p}`))
      .filter(p => p.length > 1)
      .slice(0, 5)
      .map((route, i) => ({
        route: withRoute(route),
        label: `focus-${i}`,
        waitMs: 2400,
        action: async (page: Page) => {
          await smoothScroll(page, 800)
          await sleep(400)
        },
      })) ?? []

  const core: TimelineStep[] = [
    { route: withRoute("/"), label: "landing", waitMs: 2500, action: async page => {
      await smoothScroll(page, 700)
      await sleep(400)
    } },
    { route: withRoute("/pricing"), label: "pricing", waitMs: 2400, action: async page => {
      await smoothScroll(page, 1100)
      await sleep(500)
    } },
    { route: withRoute("/login"), label: "login", waitMs: 1800, action: async page => {
      const fallback = await page.$("a[href*='login'],a[href*='signin'],button")
      if (fallback) await hoverElement(page, fallback)

      await typeHuman(page, "input[type='email'],input[name='email']", email)
      await sleep(200)
      await typeHuman(page, "input[type='password'],input[name='password']", password)
      await sleep(300)

      const submit = await findClickable(page, [
        "button[type='submit']",
        "button",
        "input[type='submit']"
      ])

      if (submit) {
        await clickElement(page, submit)
        await sleep(1800)
      }
    } },
    { route: withRoute("/tools"), label: "tools", waitMs: 2600, action: async page => {
      const cards = await page.$$("a,button,[role='button']")
      const firstThree = cards.slice(0, 3)
      for (const el of firstThree) {
        await hoverElement(page, el)
        await sleep(260)
      }
      await smoothScroll(page, 650)
      await sleep(500)
    } },
    { route: withRoute("/dashboard"), label: "dashboard", waitMs: 2400, action: async page => {
      await smoothScroll(page, 550)
      await sleep(350)
    } }
  ]

  const seen = new Set<string>()
  const merged: TimelineStep[] = []
  for (const step of [...pref, ...core]) {
    if (seen.has(step.route)) continue
    seen.add(step.route)
    merged.push(step)
  }
  return merged
}

/**
 * NovaPulseAI timeline fallback: landing → login (when demo creds) → in-app surfaces → pricing last.
 */
function orderAndTrimNovaPulseAITimeline(
  steps: TimelineStep[],
  maxKeep: number,
  includeLogin: boolean
): TimelineStep[] {
  const pathKey = (route: string) => capturePathKey(route)
  const isPricing = (route: string) => /\/pricing\b/i.test(pathKey(route))
  const isLogin = (route: string) => /\/(login|signin|sign-in)\b/i.test(pathKey(route))
  const uniq: TimelineStep[] = []
  const seen = new Set<string>()
  for (const s of steps) {
    const k = pathKey(s.route)
    if (seen.has(k)) continue
    seen.add(k)
    uniq.push(s)
  }
  const pricing = uniq.filter(s => isPricing(s.route))
  const rest = uniq.filter(s => !isPricing(s.route))
  const rankPath = (route: string): number => {
    const p = pathKey(route)
    if (p === "" || p === "/") return 0
    if (includeLogin && isLogin(route)) return 1
    if (!includeLogin && isLogin(route)) return 12
    if (/\/(tools|features|docs|workflow|create)\b/i.test(p)) return 3
    if (/\/(dashboard|app|studio|editor|library)\b/i.test(p)) return 4
    if (isPricing(route)) return 9
    return 5
  }
  rest.sort((a, b) => rankPath(a.route) - rankPath(b.route))
  const pricingTail = pricing.slice(0, 1)
  return [...rest, ...pricingTail].slice(0, Math.max(1, maxKeep))
}

export async function captureWebsite(
  url: string,
  options: CaptureOptions = {}
): Promise<CaptureResult> {
  ensureDir(TMP_DIR)

  // Runtime SSRF choke point: resolve the capture host and refuse if it
  // resolves to private/reserved space. The sync `normalizeUrl` checks that
  // run downstream only inspect literal IPs, so they cannot see an attacker-
  // controlled hostname that A-records into 10.0.0.0/8 or ::1. Chromium will
  // still resolve independently at goto time (see url-guard.ts for the
  // rebinding caveat) and redirects are not revalidated by this call.
  await assertPublicHttpUrlWithDns(url, {
    allowSchemeless: true,
    allowLoopback: isLoopbackIngestionAllowed(),
  })

  if (options.interactiveSegments?.length) {
    return captureWebsiteInteractive(url, options)
  }

  const vfCapture = resolveNovaPulseAICaptureProfile(url)
  const novaPulseAISite = vfCapture.active
  console.log(
    "[ads:capture env] AD_TREAT_LOCALHOST_AS_NOVAPULSEAI =",
    process.env.AD_TREAT_LOCALHOST_AS_NOVAPULSEAI ?? "(unset)"
  )
  const caps = resolveCaptureCaps(options.fastPreview, novaPulseAISite)
  const navBudget = { gotoMs: caps.gotoMs, settleMs: caps.settleMs }
  const platform = options.platform || "youtube"
  const duration = Math.max(8, Math.min(60, options.duration || DEFAULT_DURATION))
  const preset = getPreset(platform, options.fastPreview)
  const framesDir = path.join(TMP_DIR, uid("frames"))
  const outputPath = path.join(TMP_DIR, `${uid("capture")}.mp4`)
  const screenshots: string[] = []
  const pagesVisited: string[] = []

  ensureDir(framesDir)

  const email =
    options.loginEmail ||
    process.env.AD_DEMO_EMAIL ||
    "demo@novapulse.ai"

  const password =
    options.loginPassword ||
    process.env.AD_DEMO_PASSWORD ||
    "password123"

  const wallEnd = Date.now() + caps.wallMs
  const sessionStart = Date.now()

  let browser: Browser | null = null

  try {
    assertCaptureWall(wallEnd, "timeline pre-launch")
    browser = await launchBrowserForCapture(options.logContext)

    const page = await browser.newPage()
    await configurePage(page, platform, options.fastPreview)
    // Navigation-time SSRF guard: closes DNS-rebinding TOCTOU and cross-origin
    // 3xx redirects into private space for every `page.goto` this session
    // performs. Installed before the first navigation.
    await installNavigationSsrfGuard(page, {
      allowLoopback: isLoopbackIngestionAllowed(),
      onBlock: ({ url: blockedUrl, reason, resourceType }) => {
        logCapture(options.logContext, {
          phase: "ssrf_navigation_blocked",
          mode: "timeline",
          url: blockedUrl,
          resourceType,
          reason,
        })
      },
    })

    let fullTimeline = buildTimeline(normalizeUrl(url), email, password, options.preferredPaths)
    if (novaPulseAISite) {
      const demoEmail = (process.env.AD_DEMO_EMAIL || "").trim()
      const demoPass = (process.env.AD_DEMO_PASSWORD || "").trim()
      const hasDemoLogin = Boolean(demoEmail && demoPass)
      if (!hasDemoLogin) {
        fullTimeline = fullTimeline.filter(
          s => !/\/login\b/i.test(s.route) && !/\/signin\b/i.test(s.route)
        )
        logCapture(options.logContext, {
          phase: "vf_timeline",
          tag: "[AD_CAPTURE:vf_demo_login]",
          status: "skipped",
          reason: "AD_DEMO_EMAIL_and_AD_DEMO_PASSWORD_not_both_set",
        })
      }
      fullTimeline = orderAndTrimNovaPulseAITimeline(fullTimeline, hasDemoLogin ? 6 : 4, hasDemoLogin)
    }
    const timeline = fullTimeline.slice(0, caps.maxTimelineSteps)
    const rawTotalFrames = duration * preset.fps
    let totalFrames = Math.min(rawTotalFrames, caps.maxFrames)
    if (novaPulseAISite && caps.maxFramesTimelineNovaPulseAI != null) {
      totalFrames = Math.min(totalFrames, caps.maxFramesTimelineNovaPulseAI)
    }
    const progressState = { lastPct: -10 }
    const wallBudgetMs = wallEnd - sessionStart

    logCapture(options.logContext, {
      phase: "capture_session",
      mode: "timeline",
      status: "start",
      fastPreview: options.fastPreview === true,
      novaPulseAICaptureProfile: novaPulseAISite,
      novaPulseAICaptureReason: vfCapture.reason,
      captureSiteHost: vfCapture.host,
      fallbackFromInteractive: options.fallbackFromInteractive === true,
      wallClockBudgetMs: caps.wallMs,
      timelineSteps: timeline.length,
      timelineStepsRawBeforeSlice: fullTimeline.length,
      frameBudget: totalFrames,
      frameBudgetUncapped: rawTotalFrames,
      maxFramesPerTimelineStep: caps.maxFramesPerTimelineStep,
    })
    options.onCaptureProgress?.(0)

    const segmentFrames = Math.min(
      Math.max(1, Math.floor(totalFrames / Math.max(1, timeline.length))),
      caps.maxFramesPerTimelineStep
    )
    let frameIndex = 0

    const framesByKind: Record<string, number> = {}
    const vfBump = (kind: string, n = 1) => {
      framesByKind[kind] = (framesByKind[kind] ?? 0) + n
    }
    let timelineHadLoginStep = false
    let timelineLoginVerified = false
    let timelineLoginStepIdx = -1
    let timelinePostLoginAppReached = false
    let countingPostLoginTimeline = false
    let postLoginFrameCountTl = 0
    const productTimelinePaths = new Set<string>()

    for (let stepIdx = 0; stepIdx < timeline.length; stepIdx++) {
      const step = timeline[stepIdx]!
      const wallDiag = {
        novaPulseAICaptureProfile: novaPulseAISite,
        novaPulseAICaptureReason: vfCapture.reason,
        captureSiteHost: vfCapture.host,
        fallbackFromInteractive: options.fallbackFromInteractive === true,
        timelineStepIndex: stepIdx,
        timelineStepsTotal: timeline.length,
        timelineStepLabel: step.label,
        framesCapturedSoFar: frameIndex,
        frameTarget: totalFrames,
        segmentFramesBudget: segmentFrames,
        remainingMs: wallEnd - Date.now(),
      }
      assertCaptureWall(wallEnd, "timeline step", {
        logContext: options.logContext,
        detail: wallDiag,
      })
      if (
        novaPulseAISite &&
        timelineLoginStepIdx >= 0 &&
        stepIdx > timelineLoginStepIdx &&
        timelinePostLoginAppReached
      ) {
        countingPostLoginTimeline = true
      }
      if (novaPulseAISite && stepIdx >= 2) {
        const remRatio = (wallEnd - Date.now()) / Math.max(1, wallBudgetMs)
        if (remRatio < 0.2) {
          logCapture(options.logContext, {
            phase: "timeline_vf_skip_remaining_steps",
            reason: "low_wall_time_reserve",
            skippedFromIndex: stepIdx,
            framesCapturedSoFar: frameIndex,
            remainingMs: wallEnd - Date.now(),
          })
          break
        }
      }
      const ok = await gotoCaptureNav(page, step.route, navBudget)
      if (!ok) continue

      pagesVisited.push(step.route)

      if (step.action) {
        try {
          await step.action(page)
        } catch {}
      }

      const tKind = vfTimelineFrameKind(step.route)
      if (novaPulseAISite && tKind === "timeline_login") {
        timelineHadLoginStep = true
        timelineLoginStepIdx = stepIdx
        const demoEmail = (process.env.AD_DEMO_EMAIL || "").trim()
        const demoPass = (process.env.AD_DEMO_PASSWORD || "").trim()
        if (demoEmail && demoPass) {
          try {
            timelineLoginVerified = await isNovaPulseAILoggedIn(page)
          } catch {
            timelineLoginVerified = false
          }
          if (timelineLoginVerified && options.vfSiteIngestion) {
            const lock = vfPostLoginAllowedPathKeys(options.vfSiteIngestion)
            const toolsU = segmentNavigationUrl(url, lock.toolsPath)
            const okNav = await gotoCaptureNav(page, toolsU, navBudget)
            let inApp = okNav && (await isNovaPulseAILoggedIn(page))
            if (okNav && !inApp) {
              await settle(page, Math.min(900, caps.settleMs * 2))
              inApp = await isNovaPulseAILoggedIn(page)
            }
            timelinePostLoginAppReached = Boolean(okNav && inApp)
            logCapture(options.logContext, {
              phase: "vf_timeline_post_login_app_nav",
              post_login_app_reached: timelinePostLoginAppReached,
              path: lock.toolsPath,
            })
          } else if (timelineLoginVerified) {
            timelinePostLoginAppReached = true
          }
          countingPostLoginTimeline = timelinePostLoginAppReached
          logCapture(options.logContext, {
            phase: "vf_timeline_demo_auth",
            demo_auth_success: timelineLoginVerified,
            post_login_app_reached: timelinePostLoginAppReached,
            path: capturePathKey(step.route),
          })
        }
      }

      const still = path.join(TMP_DIR, `${uid(step.label)}.png`)
      await page.screenshot({ path: still, type: "png", fullPage: false })
      screenshots.push(still)

      for (let i = 0; i < segmentFrames; i++) {
        if (frameIndex >= totalFrames) break
        if (i % 20 === 0) {
          assertCaptureWall(wallEnd, "timeline frames", {
            logContext: options.logContext,
            detail: {
              ...wallDiag,
              innerLoopIndex: i,
              framesCapturedSoFar: frameIndex,
            },
          })
        }
        emitCaptureProgress(options, frameIndex, totalFrames, progressState)

        if (i % 12 === 0 && i !== 0) {
          try {
            await page.mouse.move(
              140 + Math.random() * (preset.width - 280),
              100 + Math.random() * (preset.height - 200)
            )
          } catch {}
        }

        await captureFrame(page, framesDir, frameIndex)
        vfBump(tKind)
        if (countingPostLoginTimeline) postLoginFrameCountTl++
        if (novaPulseAISite && tKind === "timeline_product") {
          productTimelinePaths.add(capturePathKey(step.route))
        }
        frameIndex++
        await sleep(caps.frameIntervalMs)
      }

      await sleep(Math.min(step.waitMs, caps.stepWaitCapMs))
    }

    while (frameIndex < totalFrames) {
      assertCaptureWall(wallEnd, "timeline padding frames", {
        logContext: options.logContext,
        detail: {
          novaPulseAICaptureProfile: novaPulseAISite,
          novaPulseAICaptureReason: vfCapture.reason,
          captureSiteHost: vfCapture.host,
          fallbackFromInteractive: options.fallbackFromInteractive === true,
          framesCapturedSoFar: frameIndex,
          frameTarget: totalFrames,
          remainingMs: wallEnd - Date.now(),
        },
      })
      emitCaptureProgress(options, frameIndex, totalFrames, progressState)
      await captureFrame(page, framesDir, frameIndex)
      vfBump("padding")
      frameIndex++
      await sleep(caps.frameIntervalMs)
    }

    options.onCaptureProgress?.(100)
    await renderFramesToVideo(
      framesDir,
      outputPath,
      platform,
      options.logContext,
      options.fastPreview
    )

    logCapture(options.logContext, {
      phase: "capture_session",
      mode: "timeline",
      status: "end",
      durationMs: Date.now() - sessionStart,
      pagesVisited: pagesVisited.length,
    })

    const demoCfgT = novaPulseAIDemoLoginConfigured()
    const demoAttemptedT = novaPulseAISite && timelineHadLoginStep && demoCfgT
    const timelineEffectiveLogin =
      Boolean(demoAttemptedT && timelineLoginVerified && timelinePostLoginAppReached)
    const novaPulseAIDiagnosticsT: NovaPulseAICaptureDiagnostics | undefined = novaPulseAISite
      ? {
          captureMode: "timeline",
          framesByKind: { ...framesByKind },
          totalFrames: Math.max(1, frameIndex),
          demoLoginConfigured: demoCfgT,
          demoLoginAttempted: Boolean(demoAttemptedT),
          demoLoginSucceeded: timelineEffectiveLogin,
          postLoginAppReached: timelinePostLoginAppReached,
          postLoginFrameShare:
            frameIndex > 0 ? postLoginFrameCountTl / Math.max(1, frameIndex) : 0,
          maxTransformationTiles: 0,
          postLoginDistinctRoutes: productTimelinePaths.size,
          fallbackFromInteractive: options.fallbackFromInteractive === true,
        }
      : undefined

    if (novaPulseAISite && novaPulseAIDiagnosticsT) {
      const ttot = Object.values(framesByKind).reduce((a, b) => a + b, 0) || 1
      logCapture(options.logContext, {
        phase: "vf_capture_summary",
        mode: "timeline",
        used_logged_in_flow: novaPulseAIDiagnosticsT.demoLoginSucceeded,
        demo_auth_failed: demoAttemptedT && !timelineLoginVerified,
        runtime_share_pct: {
          login: Math.round(((framesByKind.timeline_login ?? 0) / ttot) * 1000) / 10,
          pricing: Math.round(((framesByKind.timeline_pricing ?? 0) / ttot) * 1000) / 10,
          product: Math.round(((framesByKind.timeline_product ?? 0) / ttot) * 1000) / 10,
          hero: Math.round(((framesByKind.timeline_hero ?? 0) / ttot) * 1000) / 10,
          padding: Math.round(((framesByKind.padding ?? 0) / ttot) * 1000) / 10,
        },
        distinct_product_paths: productTimelinePaths.size,
      })
    }

    return {
      videoPath: outputPath,
      duration,
      pagesVisited,
      screenshots,
      ...(novaPulseAIDiagnosticsT ? { novaPulseAIDiagnostics: novaPulseAIDiagnosticsT } : {}),
    }
  } finally {
    if (browser) {
      try { await browser.close() } catch {}
    }
  }
}