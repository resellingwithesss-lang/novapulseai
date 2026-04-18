import puppeteer, { Browser, Page } from "puppeteer"
import { puppeteerLaunchOptions } from "../../lib/puppeteer-launch"
import fs from "fs"
import path from "path"
import crypto from "crypto"
import type { AdSiteIngestion } from "./pipeline/types"
import {
  assertPublicHttpUrl,
  assertPublicHostResolves,
  isLoopbackIngestionAllowed,
} from "../../lib/url-guard"
import { installNavigationSsrfGuard } from "../../lib/puppeteer-ssrf-guard"

export interface WebsiteAnalysis {
  siteUrl: string
  brandName?: string
  /** document.title */
  title?: string
  headline?: string
  subheadline?: string
  description?: string
  /** h1–h3 and key section titles */
  headings?: string[]
  /** Substantive body paragraphs (trimmed). */
  keyParagraphs?: string[]
  /** Short bullets / value statements for ads. */
  valueProps?: string[]
  keyBenefits?: string[]
  features?: string[]
  testimonials?: string[]
  socialProof?: string[]
  ctaTexts?: string[]
  /** Heuristic voice hint (e.g. professional, playful). */
  toneHint?: string
  /** Hero + key section screenshots from crawl. */
  pageCaptures?: CapturedPage[]
  primaryColorHex?: string
  secondaryColorHex?: string
  accentColorHex?: string
  detectedPages?: string[]
  loginUrl?: string
  toolsUrl?: string
  pricingUrl?: string
  dashboardUrl?: string
  capturedAt?: number
}

export interface CapturedPage {
  url: string
  image: string
  type: "landing" | "pricing" | "feature" | "tools" | "dashboard" | "login" | "other"
  score: number
}

const VIEWPORT = { width: 1600, height: 1200 }
const OUTPUT_DIR = path.resolve("./tmp/site-analyzer")
const MAX_PAGES = 12
const PAGE_TIMEOUT = 30000
const PAGE_SETTLE = 900

const PRIORITY_ROUTES = [
  "/",
  "/pricing",
  "/login",
  "/signin",
  "/tools",
  "/dashboard",
  "/features",
  "/product"
]

const BLOCKED = [
  "register",
  "auth/reset",
  "admin",
  "settings",
  "billing/checkout"
]

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID()}.png`
}

function normalize(url: string) {
  try {
    const u = new URL(url)
    u.hash = ""
    u.search = ""
    return u.href
  } catch {
    return url
  }
}

function normalizeInput(url: string) {
  // SSRF guard on the analyzer entry point. `analyzeWebsite` is invoked from
  // ads.routes with an already-validated siteUrl, but it is also re-exported
  // and could be reused by other tooling; keep the guard at this boundary.
  const safe = assertPublicHttpUrl(url, {
    allowSchemeless: true,
    allowLoopback: isLoopbackIngestionAllowed(),
  })
  return normalize(safe)
}

function sameOrigin(a: string, b: string) {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

function blocked(link: string) {
  const l = link.toLowerCase()
  return BLOCKED.some(k => l.includes(k))
}

async function configure(page: Page) {
  await page.setViewport(VIEWPORT)
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
}

async function stabilize(page: Page) {
  await page.evaluate(() => {
    const selectors = [
      "[class*=cookie]",
      "[class*=popup]",
      "[class*=modal]",
      "[class*=consent]",
      "[role=dialog]"
    ]

    for (const s of selectors) {
      document.querySelectorAll(s).forEach(el => {
        const e = el as HTMLElement
        e.style.display = "none"
      })
    }
  })

  await sleep(PAGE_SETTLE)
}

async function analyzeContent(page: Page) {
  return page.evaluate(() => {
    const text = document.body.innerText || ""
    const docTitle = document.title?.trim() || ""

    const headingEls = Array.from(document.querySelectorAll("h1,h2,h3"))
    const headings = headingEls
      .map(h => (h.textContent || "").trim())
      .filter(t => t.length > 2 && t.length < 180)

    const h1 = headings[0] || document.querySelector("h1")?.textContent?.trim() || ""
    const h2 = headings[1] || document.querySelector("h2")?.textContent?.trim() || ""

    const paragraphs = Array.from(document.querySelectorAll("article p, main p, p"))
      .map(p => (p.textContent || "").trim())
      .filter(t => t.length > 40 && t.length < 600)
      .slice(0, 12)

    const listItems = Array.from(document.querySelectorAll("li"))
      .map(li => (li.textContent || "").trim())
      .filter(t => t.length > 8 && t.length < 220)

    const buttons = Array.from(document.querySelectorAll("button,a"))
      .map(b => (b.textContent || "").trim())
      .filter(Boolean)

    const testimonials = Array.from(document.querySelectorAll("[class*=testimonial],[class*=review]"))
      .map(t => (t.textContent || "").trim())
      .filter(Boolean)

    const features = Array.from(document.querySelectorAll("[class*=feature],[class*=tool],[class*=card]"))
      .map(f => (f.textContent || "").trim())
      .filter(Boolean)

    const metaDescription =
      document.querySelector("meta[name=description]")?.getAttribute("content") || ""
    const ogTitle = document.querySelector("meta[property='og:title']")?.getAttribute("content") || ""
    const themeColor =
      document.querySelector("meta[name='theme-color']")?.getAttribute("content") || ""

    return {
      docTitle: ogTitle || docTitle,
      headline: h1,
      subheadline: h2,
      description: metaDescription,
      headings,
      paragraphs,
      listItems,
      features,
      testimonials,
      ctas: buttons.filter(b => /start|get|try|demo|login|sign in|pricing|tool|free|sign up|join/i.test(b)),
      pricing: /pricing|\$|€|£|per month|\/mo|credit|plan/i.test(text),
      themeColor,
    }
  })
}

async function discover(page: Page, origin: string) {
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a"))
      .map(a => (a as HTMLAnchorElement).href)
      .filter(Boolean)
  })

  return [...new Set(
    links
      .map(normalize)
      .filter(l => sameOrigin(origin, l))
      .filter(l => !blocked(l))
  )]
}

function classify(url: string): CapturedPage["type"] {
  const u = url.toLowerCase()
  if (u.includes("pricing")) return "pricing"
  if (u.includes("login") || u.includes("signin")) return "login"
  if (u.includes("tool")) return "tools"
  if (u.includes("dashboard")) return "dashboard"
  if (u.includes("feature")) return "feature"

  try {
    const p = new URL(u)
    if (p.pathname === "/") return "landing"
  } catch {}

  return "other"
}

async function screenshot(page: Page, file: string) {
  await page.screenshot({ path: file, type: "png", fullPage: true })
}

function pickColorFromBrand(metaHex?: string) {
  const hex = metaHex && /^#[0-9a-fA-F]{3,8}$/.test(metaHex.trim()) ? metaHex.trim() : null
  return {
    primaryColorHex: hex || "#d946ef",
    secondaryColorHex: "#7c3aed",
    accentColorHex: "#ffffff"
  }
}

function inferToneHint(sample: string): string {
  const t = sample.toLowerCase()
  if (/enterprise|security|compliance|scale/i.test(t)) return "professional"
  if (/love|feel|story|journey/i.test(t)) return "emotional"
  if (/free|instant|now|today|off/i.test(t)) return "direct"
  if (/beautiful|design|minimal/i.test(t)) return "clean"
  return "confident"
}

function deriveValueProps(listItems: string[], paragraphs: string[]): string[] {
  const fromLists = listItems
    .map(s => s.replace(/\s+/g, " ").trim())
    .filter(s => s.length < 140)
  const fromPara = paragraphs
    .map(p => p.split(/[.!?]/)[0]?.trim())
    .filter(Boolean)
    .filter(s => s.length > 20 && s.length < 160) as string[]
  return [...new Set([...fromLists, ...fromPara])].slice(0, 12)
}

export function analysisToSiteIngestion(analysis: WebsiteAnalysis): AdSiteIngestion {
  const captures = analysis.pageCaptures ?? []
  const visuals = captures.map(p => ({
    url: p.url,
    screenshotPath: p.image,
    kind:
      p.type === "landing"
        ? ("hero" as const)
        : p.type === "pricing"
          ? ("pricing" as const)
          : p.type === "feature"
            ? ("feature" as const)
            : p.type === "login"
              ? ("login" as const)
              : p.type === "tools"
                ? ("tools" as const)
                : p.type === "dashboard"
                  ? ("dashboard" as const)
                  : ("other" as const),
  }))

  return {
    siteUrl: analysis.siteUrl,
    brandName: analysis.brandName,
    title: analysis.title,
    headline: analysis.headline,
    subheadline: analysis.subheadline,
    description: analysis.description,
    headings: analysis.headings ?? [],
    keyParagraphs: analysis.keyParagraphs ?? [],
    valueProps: analysis.valueProps ?? analysis.keyBenefits ?? [],
    features: analysis.features ?? [],
    tone: analysis.toneHint ?? "confident",
    visuals,
    primaryColorHex: analysis.primaryColorHex,
    secondaryColorHex: analysis.secondaryColorHex,
    accentColorHex: analysis.accentColorHex,
    pricingUrl: analysis.pricingUrl,
    loginUrl: analysis.loginUrl,
    toolsUrl: analysis.toolsUrl,
    dashboardUrl: analysis.dashboardUrl,
    capturedAt: analysis.capturedAt,
    ctaTexts: analysis.ctaTexts,
  }
}

export async function analyzeWebsite(url: string): Promise<WebsiteAnalysis> {
  ensureDir(OUTPUT_DIR)
  const normalized = normalizeInput(url)
  const origin = new URL(normalized).origin

  // Runtime SSRF choke point: the sync guard above catches literal IPs and
  // known loopback hostnames, but a hostname like `intranet.corp.example`
  // that A-records into RFC1918 space only surfaces here. Crawl targets are
  // constrained to the same origin (`sameOrigin(origin, ...)` in `discover`),
  // so resolving the origin host once is sufficient for this flow; cross-
  // origin redirects followed by Chromium are not revalidated by this guard.
  await assertPublicHostResolves(new URL(normalized).hostname, {
    allowLoopback: isLoopbackIngestionAllowed(),
  })

  let browser: Browser | null = null

  try {
    browser = await puppeteer.launch(puppeteerLaunchOptions())

    const page = await browser.newPage()
    await configure(page)
    // Navigation-time SSRF guard: closes DNS-rebinding TOCTOU and cross-origin
    // 3xx redirects into private space. Installed before any `page.goto`.
    await installNavigationSsrfGuard(page, {
      allowLoopback: isLoopbackIngestionAllowed(),
      onBlock: ({ url: blockedUrl, reason }) => {
        console.warn(
          "[ads:analyzer] navigation blocked by SSRF guard",
          JSON.stringify({ url: blockedUrl, reason })
        )
      },
    })

    const visited = new Set<string>()
    const queue = PRIORITY_ROUTES.map(r => new URL(r, origin).href)
    const pages: CapturedPage[] = []

    let brandName = ""
    let pageTitle = ""
    let headline = ""
    let subheadline = ""
    let description = ""
    const features: string[] = []
    const testimonials: string[] = []
    const ctas: string[] = []
    const allHeadings: string[] = []
    const allParagraphs: string[] = []
    const allListItems: string[] = []
    let themeColorMeta = ""

    while (queue.length && visited.size < MAX_PAGES) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)

      try {
        await page.goto(current, { waitUntil: "networkidle2", timeout: PAGE_TIMEOUT })
        await stabilize(page)
        const data = await analyzeContent(page)

        if (!pageTitle && data.docTitle) pageTitle = data.docTitle
        if (!headline && data.headline) headline = data.headline
        if (!subheadline && data.subheadline) subheadline = data.subheadline
        if (!description && data.description) description = data.description
        if (data.themeColor && !themeColorMeta) themeColorMeta = data.themeColor

        allHeadings.push(...data.headings)
        allParagraphs.push(...data.paragraphs)
        allListItems.push(...data.listItems)
        features.push(...data.features)
        testimonials.push(...data.testimonials)
        ctas.push(...data.ctas)

        const file = path.join(OUTPUT_DIR, unique("page"))
        await screenshot(page, file)

        pages.push({
          url: current,
          image: file,
          type: classify(current),
          score: data.features.length * 3 + data.testimonials.length * 2 + (data.pricing ? 8 : 0)
        })

        const links = await discover(page, origin)
        for (const link of links) {
          if (!visited.has(link) && queue.length < MAX_PAGES * 2) queue.push(link)
        }
      } catch {}
    }

    if (!brandName) {
      try {
        const host = new URL(origin).hostname
        brandName = host.replace("www.", "").split(".")[0]
      } catch {}
    }

    const routes = {
      pricingUrl: pages.find(p => p.type === "pricing")?.url,
      loginUrl: pages.find(p => p.type === "login")?.url,
      toolsUrl: pages.find(p => p.type === "tools")?.url,
      dashboardUrl: pages.find(p => p.type === "dashboard")?.url
    }

    const uniqueHeadings = [...new Set(allHeadings.map(h => h.replace(/\s+/g, " ").trim()))].slice(0, 20)
    const uniqueParagraphs = [...new Set(allParagraphs.map(p => p.replace(/\s+/g, " ").trim()))].slice(0, 10)
    const valueProps = deriveValueProps(allListItems, uniqueParagraphs)
    const toneSample = [headline, description, ...valueProps.slice(0, 3)].join(" ")

    return {
      siteUrl: origin,
      brandName,
      title: pageTitle,
      headline,
      subheadline,
      description,
      headings: uniqueHeadings,
      keyParagraphs: uniqueParagraphs,
      valueProps,
      keyBenefits: valueProps.length ? valueProps.slice(0, 10) : [...new Set(features)].slice(0, 10),
      features: [...new Set(features)].slice(0, 15),
      testimonials: [...new Set(testimonials)].slice(0, 10),
      socialProof: [],
      ctaTexts: [...new Set(ctas)].slice(0, 12),
      toneHint: inferToneHint(toneSample),
      pageCaptures: pages,
      detectedPages: pages.map(p => p.url),
      ...pickColorFromBrand(themeColorMeta),
      ...routes,
      capturedAt: Date.now()
    }
  } finally {
    if (browser) {
      try { await browser.close() } catch {}
    }
  }
}