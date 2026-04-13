/**
 * Executes AdInteractionStep sequences with human-like pacing for product-demo capture.
 */

import type { Page, ElementHandle } from "puppeteer"
import type {
  AdInteractionStep,
  InteractionCaptureOptions,
  InteractiveSceneIntent,
} from "./pipeline/interaction.types"

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}

function intentWaitFactor(intent: InteractiveSceneIntent | undefined): number {
  switch (intent) {
    case "attract":
      return 0.74
    case "explain":
      return 1.08
    case "prove":
      return 1.45
    case "convert":
      return 1.28
    default:
      return 1
  }
}

function shouldPreHoverSettle(opts: InteractionCaptureOptions): boolean {
  const intent = opts.sceneIntent
  if (intent === "convert" || intent === "prove") return Math.random() < 0.78
  if (intent === "explain") return Math.random() < 0.55
  return Math.random() < 0.42
}

function scaleMs(ms: number, opts: InteractionCaptureOptions): number {
  const m = opts.pacingMultiplier ?? (opts.timingProfile === "cinematic" ? 1.15 : 1)
  const intentJ =
    opts.sceneIntent === "attract" ? 0.88 + Math.random() * 0.22 : 0.9 + Math.random() * 0.24
  return Math.max(40, Math.floor(ms * m * intentJ))
}

async function hideNoise(page: Page) {
  await page.evaluate(() => {
    const selectors = [
      "[class*=cookie]",
      "[class*=consent]",
      "[class*=intercom]",
      "[class*=chat]",
      "[role=dialog]",
      "iframe[title*=chat]",
    ]
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        const node = el as HTMLElement
        node.style.display = "none"
        node.style.visibility = "hidden"
      })
    }
  })
}

/** Cubic ease-in-out for variable cursor speed along the path. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

async function moveAlongBezier(
  page: Page,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  opts: InteractionCaptureOptions
) {
  const steps = 26 + Math.floor(Math.random() * 16)
  const c1 = {
    x: startX + (endX - startX) * 0.32 + (Math.random() - 0.5) * 110,
    y: startY + (endY - startY) * 0.12 + (Math.random() - 0.5) * 110,
  }
  const c2 = {
    x: startX + (endX - startX) * 0.68 + (Math.random() - 0.5) * 110,
    y: startY + (endY - startY) * 0.88 + (Math.random() - 0.5) * 110,
  }

  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    const t = easeInOutCubic(u)
    const inv = 1 - t
    const px =
      inv * inv * inv * startX +
      3 * inv * inv * t * c1.x +
      3 * inv * t * t * c2.x +
      t * t * t * endX
    const py =
      inv * inv * inv * startY +
      3 * inv * inv * t * c1.y +
      3 * inv * t * t * c2.y +
      t * t * t * endY

    const midEmphasis = Math.sin(u * Math.PI)
    const delay =
      (3 + Math.floor(Math.random() * 9)) * (0.82 + midEmphasis * 0.45) * (0.9 + Math.random() * 0.25)
    await page.mouse.move(px, py)
    await sleep(scaleMs(delay, opts))
  }
}

async function settleAfterOvershoot(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  opts: InteractionCaptureOptions
) {
  const n = 5 + Math.floor(Math.random() * 4)
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const px = fromX + (toX - fromX) * t
    const py = fromY + (toY - fromY) * t
    await page.mouse.move(px, py)
    await sleep(scaleMs(5 + Math.floor(Math.random() * 8), opts))
  }
}

async function moveMouseHuman(
  page: Page,
  targetX: number,
  targetY: number,
  opts: InteractionCaptureOptions
) {
  const start = { x: 70 + Math.random() * 240, y: 60 + Math.random() * 170 }
  const doOvershoot = Math.random() < 0.62
  const mag = 9 + Math.random() * 16
  const angle = Math.random() * Math.PI * 2
  const ox = Math.cos(angle) * mag
  const oy = Math.sin(angle) * mag

  const viaX = doOvershoot ? targetX + ox : targetX
  const viaY = doOvershoot ? targetY + oy : targetY

  await moveAlongBezier(page, start.x, start.y, viaX, viaY, opts)
  if (doOvershoot && (Math.abs(viaX - targetX) > 2 || Math.abs(viaY - targetY) > 2)) {
    await settleAfterOvershoot(page, viaX, viaY, targetX, targetY, opts)
  }
}

async function smoothScroll(page: Page, total: number, opts: InteractionCaptureOptions) {
  const cap = Math.min(total, 820)
  let done = 0
  const intent = opts.sceneIntent
  let chunkBase = opts.timingProfile === "cinematic" ? 48 : 78
  if (intent === "prove") chunkBase = 34
  if (intent === "attract") chunkBase = 56
  if (intent === "convert") chunkBase = 42
  let iter = 0
  while (done < cap && iter < 48) {
    iter++
    const progress = done / Math.max(cap, 1)
    const ease = 0.5 - 0.5 * Math.cos(Math.min(1, progress) * Math.PI)
    if (
      Math.random() < (intent === "prove" ? 0.16 : 0.3) &&
      done > cap * 0.1 &&
      done < cap * 0.9
    ) {
      await sleep(scaleMs(150 + Math.random() * 260, opts))
    }
    const chunk = (chunkBase + Math.random() * 88) * (0.72 + ease * 0.55)
    await page.mouse.wheel({ deltaY: chunk })
    done += chunk
    await sleep(scaleMs(88 + Math.random() * 95 + ease * 40, opts))
  }
}

async function findBySelector(page: Page, selector: string): Promise<ElementHandle<Element> | null> {
  const parts = selector.split(",").map(s => s.trim()).filter(Boolean)
  for (const sel of parts) {
    try {
      const el = await page.$(sel)
      if (!el) continue
      const ok = await el.evaluate(node => {
        const r = (node as HTMLElement).getBoundingClientRect()
        return r.width > 2 && r.height > 2
      })
      if (ok) return el
      await el.dispose().catch(() => {})
    } catch {
      /* next */
    }
  }
  return null
}

const INPUT_SEMANTIC: Record<"email" | "password" | "text", string> = {
  email: [
    "input[type='email']",
    "input[autocomplete='email']",
    "input[name*='email']",
    "input[id*='email']",
    "input[placeholder*='email']",
    "input[placeholder*='Email']",
  ].join(","),
  password: [
    "input[type='password']",
    "input[autocomplete='current-password']",
    "input[name*='pass']",
    "input[id*='pass']",
    "input[placeholder*='password']",
  ].join(","),
  text: "textarea,input[type='text'],input[type='search'],input:not([type])",
}

async function findBySemanticInput(
  page: Page,
  kind: "email" | "password" | "text"
): Promise<ElementHandle<Element> | null> {
  return findBySelector(page, INPUT_SEMANTIC[kind])
}

/** Prefer visible controls: text, aria-label, roles, associated labels. */
async function findByLabel(page: Page, label: string): Promise<ElementHandle<Element> | null> {
  const handle = await page.evaluateHandle((text: string) => {
    const t = text.toLowerCase().trim()
    if (!t) return null

    const scoreMatch = (el: Element): boolean => {
      const e = el as HTMLElement
      const txt = (e.textContent || "").trim().toLowerCase()
      const val = ((el as HTMLInputElement).value || "").toLowerCase()
      const aria = (e.getAttribute("aria-label") || "").toLowerCase()
      const title = (e.getAttribute("title") || "").toLowerCase()
      const hay = `${txt} ${val} ${aria} ${title}`
      return hay.includes(t)
    }

    const selectors =
      "a,button,[role='button'],[role='link'],[role='menuitem'],[role='tab'],input[type='submit'],input[type='button'],summary"
    const nodes = Array.from(document.querySelectorAll(selectors))
    for (const el of nodes) {
      if (!scoreMatch(el)) continue
      const r = (el as HTMLElement).getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      const vis = (el as HTMLElement).offsetParent !== null || el.tagName === "BUTTON"
      if (vis || t.length < 4) return el
    }

    for (const lab of Array.from(document.querySelectorAll("label"))) {
      if (!(lab.textContent || "").toLowerCase().includes(t)) continue
      const htmlFor = lab.getAttribute("for")
      if (htmlFor) {
        const ctrl = document.getElementById(htmlFor)
        if (ctrl) return ctrl
      }
      const inner = lab.querySelector("input,textarea,button,select")
      if (inner) return inner
    }

    return null
  }, label)

  const el = handle.asElement()
  if (el) return el as ElementHandle<Element>
  try {
    await handle.dispose()
  } catch {}
  return null
}

async function resolveElement(
  page: Page,
  step: { selector?: string; label?: string }
): Promise<ElementHandle<Element> | null> {
  if (step.selector) {
    const el = await findBySelector(page, step.selector)
    if (el) return el
  }
  if (step.label) return findByLabel(page, step.label)
  return null
}

async function hoverElement(page: Page, el: ElementHandle<Element>, opts: InteractionCaptureOptions) {
  const box = await el.boundingBox()
  if (!box) return
  await moveMouseHuman(page, box.x + box.width / 2, box.y + box.height / 2, opts)
  const base = opts.sceneIntent === "prove" || opts.sceneIntent === "convert" ? 220 : 165
  await sleep(scaleMs(base + Math.random() * 160, opts))
}

async function clickElement(page: Page, el: ElementHandle<Element>, opts: InteractionCaptureOptions) {
  const box = await el.boundingBox()
  if (!box) return
  await moveMouseHuman(page, box.x + box.width / 2, box.y + box.height / 2, opts)

  if (shouldPreHoverSettle(opts)) {
    await sleep(scaleMs(55 + Math.random() * 140, opts))
    const jitter = 4 + Math.random() * 7
    await page.mouse.move(box.x + box.width / 2 + jitter, box.y + box.height / 2 - jitter * 0.4)
    await sleep(scaleMs(70 + Math.random() * 110, opts))
  } else {
    await sleep(scaleMs(75 + Math.random() * 120, opts))
  }

  await page.mouse.down()
  await sleep(scaleMs(42 + Math.random() * 58, opts))
  await page.mouse.up()
  const post =
    opts.sceneIntent === "prove"
      ? 150 + Math.random() * 200
      : opts.sceneIntent === "attract"
        ? 65 + Math.random() * 95
        : 95 + Math.random() * 165
  await sleep(scaleMs(post, opts))
}

async function isSubmitLike(el: ElementHandle<Element>): Promise<boolean> {
  return el.evaluate(node => {
    const n = node as HTMLElement
    const tag = n.tagName.toLowerCase()
    if (tag === "input") {
      const t = (n as HTMLInputElement).type?.toLowerCase()
      if (t === "submit") return true
    }
    const txt = `${(n.textContent || "").trim()} ${((n as HTMLInputElement).value || "").trim()}`.toLowerCase()
    return /submit|sign\s*up|create\s*account|register|complete|pay\s*now/.test(txt)
  })
}

export async function runInteractionStep(
  page: Page,
  step: AdInteractionStep,
  opts: InteractionCaptureOptions
): Promise<void> {
  await hideNoise(page)

  switch (step.type) {
    case "visit":
      await page.goto(step.url, {
        waitUntil: "networkidle2",
        timeout: 45_000,
      })
      await sleep(scaleMs(320 * intentWaitFactor(opts.sceneIntent), opts))
      return

    case "wait": {
      let intentF = intentWaitFactor(opts.sceneIntent)
      if (opts.capturePressure === "severe") intentF *= 0.52
      else if (opts.capturePressure === "degraded") intentF *= 0.7
      if (opts.novaPulseAILeanCapture) intentF *= 0.82
      await sleep(scaleMs(step.ms * intentF, opts))
      return
    }

    case "waitForNavigation": {
      const ms = Math.min(22_000, Math.max(2_000, step.timeoutMs ?? 12_000))
      try {
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: ms })
      } catch {}
      return
    }

    case "waitForSelector": {
      try {
        let ms = Math.min(18_000, Math.max(1_000, step.timeoutMs ?? 10_000))
        if (opts.novaPulseAILeanCapture) ms = Math.min(ms, 4_800)
        else if (opts.capturePressure === "severe") ms = Math.min(ms, 4_200)
        else if (opts.capturePressure === "degraded") ms = Math.min(ms, 6_500)
        await page.waitForSelector(step.selector, { timeout: ms })
      } catch {}
      return
    }

    case "scroll":
      await smoothScroll(page, step.amount, opts)
      return

    case "move": {
      const el = await resolveElement(page, step)
      if (!el) return
      const box = await el.boundingBox()
      if (!box) return
      await moveMouseHuman(page, box.x + box.width / 2, box.y + box.height / 2, opts)
      if (Math.random() < 0.55) {
        await sleep(scaleMs(45 + Math.random() * 120, opts))
      }
      return
    }

    case "hover": {
      const el = await resolveElement(page, step)
      if (!el) return
      await hoverElement(page, el, opts)
      return
    }

    case "click": {
      const el = await resolveElement(page, step)
      if (!el) return
      const submitLike = await isSubmitLike(el)
      if (
        submitLike &&
        !opts.allowDestructiveSubmit &&
        step.allowSubmit !== true
      ) {
        await hoverElement(page, el, opts)
        return
      }
      await clickElement(page, el, opts)
      return
    }

    case "type": {
      let el: ElementHandle<Element> | null = null
      if (step.selector) el = await findBySelector(page, step.selector)
      if (!el && step.inputKind) el = await findBySemanticInput(page, step.inputKind)
      if (!el) el = await resolveElement(page, step)
      if (!el) return
      await hoverElement(page, el, opts)
      await page.keyboard.down("Control")
      await page.keyboard.press("A")
      await page.keyboard.up("Control")
      await page.keyboard.press("Backspace")
      const baseDelay = opts.timingProfile === "cinematic" ? 44 : 32
      for (const ch of step.value) {
        const burst = Math.random() < 0.08 ? 12 : 0
        await sleep(burst)
        const delay = scaleMs(baseDelay + Math.floor(Math.random() * 36), opts)
        await page.keyboard.type(ch, { delay })
      }
      await sleep(scaleMs(110 + Math.random() * 130, opts))
      return
    }

    default:
      return
  }
}
