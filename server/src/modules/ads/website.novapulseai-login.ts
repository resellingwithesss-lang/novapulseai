/**
 * NovaPulseAI demo login verification: deterministic submit + success detection + one retry.
 * All waits use caller-provided deadlines (no new global timeouts).
 */

import type { Page } from "puppeteer"

export type VfLoginLogContext = { requestId: string; jobDbId: string }

function sleep(ms: number) {
  return new Promise<void>(res => setTimeout(res, ms))
}

function logVF(ctx: VfLoginLogContext | undefined, payload: Record<string, unknown>) {
  const base = ctx
    ? `[ads:npai-login] requestId=${ctx.requestId} jobDbId=${ctx.jobDbId}`
    : "[ads:npai-login]"
  console.log(base, JSON.stringify({ ...payload, ts: new Date().toISOString() }))
}

const LOGIN_INPUT_SELECTORS = [
  "input[type='email']",
  "input[name*='email' i]",
  "input[id*='email' i]",
  "input[autocomplete='email']",
  "input[type='text'][name*='user' i]",
].join(",")

const PASSWORD_SELECTORS = "input[type='password']"

const APP_SHELL_SELECTORS = [
  "[data-app-root]",
  "[data-testid='app-shell']",
  "nav[aria-label*='main' i]",
  "[class*='sidebar']",
  "[class*='SideNav']",
  "aside[role='navigation']",
  "[href*='/dashboard']",
  "[href*='/tools']",
  "[href*='/workflow']",
].join(",")

export async function vfLoginFormVisible(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(
      (loginSel, passSel) => {
        const e = document.querySelector(loginSel)
        const p = document.querySelector(passSel)
        return Boolean(
          e &&
            p &&
            (e as HTMLElement).offsetParent !== null &&
            (p as HTMLElement).offsetParent !== null
        )
      },
      LOGIN_INPUT_SELECTORS,
      PASSWORD_SELECTORS
    )
  } catch {
    return false
  }
}

/** True when the password field is gone or hidden and an app shell / main workspace is visible. */
export async function isNovaPulseAILoggedIn(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(passSel => {
      const pwd = document.querySelector(passSel) as HTMLElement | null
      if (pwd && pwd.offsetParent !== null) return false
      return Boolean(
        document.querySelector("[data-app-root]") ||
          document.querySelector("[data-testid='app-shell']") ||
          document.querySelector("a[href*='/dashboard'],a[href*='/tools'],a[href*='/workflow']") ||
          (document.querySelector("main,[role='main']") &&
            document.querySelector("[class*='sidebar'],aside,nav"))
      )
    }, PASSWORD_SELECTORS)
  } catch {
    return false
  }
}

async function findSubmitHandle(page: Page) {
  const selectors = [
    "button[type='submit']",
    "input[type='submit']",
    "button[data-testid*='submit' i]",
  ]
  for (const sel of selectors) {
    const el = await page.$(sel)
    if (!el) continue
    const ok = await page
      .evaluate(
        (node: Element) => {
          const t = (node.textContent || "").toLowerCase()
          return (
            /sign|log|continue|submit|enter|in\b/.test(t) || node.nodeName === "INPUT"
          )
        },
        el as never
      )
      .catch(() => true)
    if (ok) return el
  }
  return page.$("button[type='submit']")
}

/**
 * After scripted sign-in steps, verify session; retry submit once if still on login form.
 * Respects `deadlineMs` wall (typically segment budget remainder).
 */
export type VfDemoLoginResult = {
  ok: boolean
  /** Observed login form (email+password visible) before submit path ran. */
  loginFormDetected: boolean
  /** Click or Enter was used to submit at least once while the form was visible. */
  submitAttempted: boolean
}

export async function finalizeNovaPulseAIDemoLogin(
  page: Page,
  ctx: VfLoginLogContext | undefined,
  deadlineMs: number
): Promise<VfDemoLoginResult> {
  const t0 = Date.now()
  const timeLeft = () => Math.max(0, deadlineMs - (Date.now() - t0))
  let loginFormDetected = false
  let submitAttempted = false

  logVF(ctx, { event: "demo_auth_attempted", deadlineMs })

  if (await isNovaPulseAILoggedIn(page)) {
    logVF(ctx, { event: "demo_auth_success", note: "already_in_app" })
    return { ok: true, loginFormDetected: true, submitAttempted: false }
  }

  const waitAppOrNav = async (ms: number) => {
    const budget = Math.min(ms, timeLeft())
    if (budget < 400) return
    try {
      await Promise.race([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: budget }).catch(() => {}),
        page.waitForSelector(APP_SHELL_SELECTORS.split(",")[0]!, { timeout: budget }).catch(() => {}),
        page.waitForFunction(
          () => !document.querySelector("input[type='password']"),
          { timeout: budget }
        ).catch(() => {}),
      ])
    } catch {
      /* ignore */
    }
  }

  /* up to 3 submit passes — replay Enter once if still on form */
  for (let attempt = 0; attempt < 3 && timeLeft() > 800; attempt++) {
    if (await isNovaPulseAILoggedIn(page)) {
      logVF(ctx, { event: "demo_auth_success", attempt })
      return { ok: true, loginFormDetected, submitAttempted }
    }

    if (!(await vfLoginFormVisible(page))) {
      await waitAppOrNav(Math.min(6000, timeLeft()))
      if (await isNovaPulseAILoggedIn(page)) {
        logVF(ctx, { event: "demo_auth_success", attempt, note: "post_wait" })
        return { ok: true, loginFormDetected, submitAttempted }
      }
      break
    }

    loginFormDetected = true

    try {
      await page.waitForSelector(LOGIN_INPUT_SELECTORS, { timeout: Math.min(8000, timeLeft()) })
    } catch {
      logVF(ctx, { event: "demo_auth_failed", reason: "email_selector_timeout", attempt })
      return { ok: false, loginFormDetected, submitAttempted }
    }

    const submit = await findSubmitHandle(page)
    if (submit) {
      try {
        const box = await submit.boundingBox()
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 })
          await sleep(120 + Math.floor(Math.random() * 140))
        }
        await submit.click({ delay: 50 })
        submitAttempted = true
      } catch {
        try {
          await page.keyboard.press("Enter")
          submitAttempted = true
        } catch {
          /* ignore */
        }
      }
    } else {
      try {
        await page.keyboard.press("Enter")
        submitAttempted = true
      } catch {
        /* ignore */
      }
    }

    await waitAppOrNav(Math.min(10_000, timeLeft()))
    await sleep(280)

    if (await isNovaPulseAILoggedIn(page)) {
      logVF(ctx, { event: "demo_auth_success", attempt })
      return { ok: true, loginFormDetected, submitAttempted }
    }
  }

  logVF(ctx, {
    event: "demo_auth_failed",
    reason: "not_logged_in_after_retry",
    remainingMs: timeLeft(),
    loginFormDetected,
    submitAttempted,
  })
  return { ok: false, loginFormDetected, submitAttempted }
}

export function vfPostLoginAllowedPathKeys(ingestion: {
  toolsUrl?: string
  dashboardUrl?: string
  pricingUrl?: string
  siteUrl: string
}): { keys: Set<string>; toolsPath: string; resultsPath: string; pricingPath: string; heroPath: string } {
  const origin = (() => {
    try {
      return new URL(ingestion.siteUrl).origin
    } catch {
      return ""
    }
  })()

  const pathOf = (href: string | undefined, fallback: string) => {
    if (!href) return fallback
    try {
      const u = href.startsWith("http") ? new URL(href) : new URL(href, origin || "https://npai.local")
      return `${u.pathname}${u.search || ""}` || fallback
    } catch {
      return href.startsWith("/") ? href : fallback
    }
  }

  const toolsPath = pathOf(ingestion.toolsUrl, "/tools")
  const resultsPath = pathOf(ingestion.dashboardUrl, "/dashboard")
  const pricingPath = pathOf(ingestion.pricingUrl, "/pricing")
  const heroPath = "/"

  const keys = new Set(
    [toolsPath, resultsPath, pricingPath, "/library", "/studio", "/app", "/clips"].filter(
      (p, i, a) => a.indexOf(p) === i
    )
  )
  return { keys, toolsPath, resultsPath, pricingPath, heroPath }
}
