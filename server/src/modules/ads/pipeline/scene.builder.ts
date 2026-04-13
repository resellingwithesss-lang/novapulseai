import type {
  AdSiteIngestion,
  AdSceneType,
  BuiltAdScene,
  SceneTransition,
  StructuredAdScript,
} from "./types"
import type { NarrativeMode, ScriptEmphasis } from "./ad.variant-presets"
import { detectNovaPulseAIProduct, novaPulseAIDemoLoginConfigured } from "./ad.product-profile"

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

const MIN_SCENE_SEC = 1.2
/** ≥3×0.8s phases for reveal / multiplication / shipping in capture + storytiming. */
const MIN_TRANSFORMATION_SCENE_SEC = 2.55
const CAPTION_MAX_WORDS = 6
const CAPTION_MAX_BEATS = 4

function captionHasPunch(s: string): boolean {
  if (/^(→|[\d]+|no |skip |one |many )/i.test(s)) return true
  if (
    /\b(clip|clips|post|export|batch|idea|ideas|ready|repurpose|render|ship|automate|output)\b/i.test(
      s
    )
  )
    return true
  return false
}

/** Conversion-oriented: outcome, contrast, or before→after — not neutral description. */
function captionSells(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  if (/^(→)/.test(t)) return true
  if (/\b(less|more|no |stop |start |ship|post|ready|without|skip )\b/i.test(t)) return true
  if (/\b(one|single)\b.*\b(many|batch|clips)\b/i.test(t)) return true
  if (captionHasPunch(t) && !/\b(showing|features?|dashboard|section|interface|screen)\b/i.test(t))
    return true
  return false
}

function conversionCaptionFallback(seed: string): string {
  const low = seed.toLowerCase()
  if (/edit|cut|trim|timeline/i.test(low)) return "Stop editing. Start posting."
  if (/hour|time|slow|manual/i.test(low)) return "Less work. More clips."
  if (/free|trial|pay|plan/i.test(low)) return "No edit grind needed"
  return "One idea → many clips"
}

/**
 * Tighten one caption line: strip filler, prefer nouns/verbs, keep ≤6 words, editorial punch.
 */
export function refineCaptionBeat(text: string): string {
  let t = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
  if (!t) return ""

  t = t.replace(
    /\b(this helps you|you can easily|allows you to|in order to|a lot of|make sure to|be able to)\b/gi,
    ""
  )
  t = t.replace(/\s+/g, " ").trim()

  const filler = new Set([
    "this",
    "that",
    "just",
    "very",
    "really",
    "easily",
    "simply",
    "your",
    "you",
    "can",
    "will",
    "get",
    "like",
    "also",
    "even",
  ])

  const words = t.split(/\s+/).filter(Boolean)
  const kept: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    const lw = w.toLowerCase().replace(/[^a-z0-9']/gi, "")
    if (i > 0 && words.length > 4 && filler.has(lw)) continue
    kept.push(w)
    if (kept.length >= CAPTION_MAX_WORDS) break
  }

  t = kept.join(" ").trim()
  if (t.length < 2) return captionFor(text.replace(/\s+/g, " ").trim(), CAPTION_MAX_WORDS)

  if (/^(showing|here is|this is|our |the product|a tool)/i.test(t)) {
    t = conversionCaptionFallback(text)
  }

  if (!captionSells(t)) {
    const low = text.toLowerCase()
    if (/clip|batch|output/i.test(low)) t = "More clips. Less work."
    else if (/edit/i.test(low)) t = "Stop editing. Start posting."
    else if (/idea|one input|single/i.test(low)) t = "One idea → many clips"
    else t = conversionCaptionFallback(text)
  } else if (!captionHasPunch(t) && t.split(/\s+/).length > 4) {
    t = conversionCaptionFallback(text)
  }

  if (/\b(seamlessly|instantly)\s*$/i.test(t) || /\bcompresses\s+your\s+workflow\s+by\s*$/i.test(t)) {
    t = conversionCaptionFallback(text)
  }

  return captionFor(t, CAPTION_MAX_WORDS).replace(/…$/u, "")
}

/**
 * Split VO into 2–4 short on-screen lines (max ~6 words each) for vertical/social readability.
 */
export function formatCaptions(voLine: string): string[] {
  const raw = String(voLine || "")
    .replace(/\s+/g, " ")
    .trim()
  if (!raw) return []

  const pieces = raw
    .split(/\s*(?:[.!?]+|[;:]|(?:\s+[-–—]\s+)|(?:\s*,\s+))\s*/u)
    .map(p => p.replace(/^[.!?,;:]+/u, "").trim())
    .filter(Boolean)

  const chunks: string[] = []
  for (const piece of pieces.length ? pieces : [raw]) {
    const words = piece.split(/\s+/).filter(Boolean)
    for (let i = 0; i < words.length; i += CAPTION_MAX_WORDS) {
      const slice = words.slice(i, i + CAPTION_MAX_WORDS)
      if (slice.length) chunks.push(slice.join(" "))
    }
  }

  const merged: string[] = []
  for (const c of chunks) {
    const wc = c.split(/\s+/).length
    const last = merged[merged.length - 1]
    if (last && wc <= 2 && last.split(/\s+/).length + wc <= CAPTION_MAX_WORDS) {
      merged[merged.length - 1] = `${last} ${c}`
    } else {
      merged.push(c)
    }
  }

  const refined = merged
    .slice(0, CAPTION_MAX_BEATS)
    .map(b => refineCaptionBeat(b))
    .filter(Boolean)

  if (refined.length >= 2) return refined
  if (refined.length === 1) return refined
  return [refineCaptionBeat(captionFor(raw, CAPTION_MAX_WORDS))]
}

function toPath(href: string | undefined, fallback: string): string {
  if (!href) return fallback
  try {
    const u = new URL(href)
    return u.pathname + u.search || fallback
  } catch {
    return href.startsWith("/") ? href : fallback
  }
}

function pickPageForType(
  type: AdSceneType,
  featureIndex: number,
  ingestion: AdSiteIngestion
): string {
  const vf = detectNovaPulseAIProduct(ingestion)
  const hero = toPath(
    ingestion.visuals.find(v => v.kind === "hero" || v.kind === "other")?.url,
    "/"
  )
  const tools = toPath(ingestion.toolsUrl, "/tools")
  const results = toPath(ingestion.dashboardUrl, "/dashboard")
  const pricing = toPath(ingestion.pricingUrl, "/pricing")

  if (vf) {
    switch (type) {
      case "hook":
        return hero
      case "demo_auth":
        return toPath(ingestion.loginUrl, "/login")
      case "problem":
        return toPath(ingestion.dashboardUrl || ingestion.toolsUrl, results || tools)
      case "solution":
        return tools
      case "transformation_proof":
        return results || tools
      case "feature":
        return tools
      case "payoff":
        return results || tools
      case "cta":
        return pricing || tools
      default:
        return hero
    }
  }

  switch (type) {
    case "hook":
    case "problem":
      return hero
    case "solution":
      return toPath(ingestion.toolsUrl || ingestion.dashboardUrl, "/")
    case "transformation_proof":
      return toPath(ingestion.toolsUrl || ingestion.dashboardUrl, "/dashboard")
    case "feature": {
      const cycle = [ingestion.pricingUrl, ingestion.toolsUrl, ingestion.dashboardUrl, undefined]
      const pick = cycle[featureIndex % cycle.length]
      const fallback = ["/pricing", "/tools", "/dashboard", "/"][featureIndex % 4]!
      return toPath(pick, fallback)
    }
    case "payoff":
      return toPath(ingestion.dashboardUrl || ingestion.toolsUrl, "/dashboard")
    case "cta":
      return toPath(ingestion.pricingUrl || ingestion.loginUrl, "/pricing")
    default:
      return "/"
  }
}

function captionFor(text: string, maxWords = 7): string {
  const words = text.replace(/[.!?]+$/g, "").split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return words.join(" ")
  const hang =
    /^(into|to|from|for|the|a|an|and|or|by|with|your|our|that|this|at|in|on|of|as)$/i
  const slice = words.slice(0, maxWords)
  while (slice.length >= 3 && hang.test(slice[slice.length - 1]!)) {
    slice.pop()
  }
  return slice.join(" ")
}

/** Keeps VO shorter on the transformation beat so picture does the selling. */
function voiceoverForTransformationBeat(raw: string, maxChars = 118): string {
  const t = raw.replace(/\s+/g, " ").trim()
  if (!t) return t
  const firstSentence = t.split(/(?<=[.!?])\s+/)[0] || t
  const pick = firstSentence.length >= 20 && firstSentence.length <= maxChars ? firstSentence : t
  if (pick.length <= maxChars) return pick
  return `${pick.slice(0, maxChars - 1).trim()}…`
}

function transitionFor(i: number, total: number, sceneType?: AdSceneType): SceneTransition {
  if (sceneType === "transformation_proof") return "crossfade"
  if (sceneType === "demo_auth") return "fade"
  if (i === 0) return "zoom"
  if (i === total - 1) return "fade"
  return i % 2 === 0 ? "crossfade" : "fade"
}

function buildTypesOrder(
  featureCount: number,
  narrativeMode: NarrativeMode,
  includeTransformationProof: boolean,
  opts?: { novaPulseAI?: boolean; npaiDemoLogin?: boolean }
): AdSceneType[] {
  const feats = Array.from({ length: featureCount }, () => "feature" as AdSceneType)
  const xf = includeTransformationProof ? (["transformation_proof"] as AdSceneType[]) : []
  const vf = opts?.novaPulseAI === true && includeTransformationProof
  const auth: AdSceneType[] =
    vf && opts?.npaiDemoLogin ? (["demo_auth"] as AdSceneType[]) : []

  /** Transformation only after workflow beats so capture stays inside the product first. */
  if (vf) {
    if (narrativeMode === "result_first") {
      return ["hook", "payoff", ...auth, "problem", "solution", ...feats, ...xf, "cta"]
    }
    return ["hook", ...auth, "problem", "solution", ...feats, ...xf, "payoff", "cta"]
  }

  if (narrativeMode === "result_first") {
    return ["hook", "payoff", ...xf, "problem", "solution", ...feats, "cta"]
  }
  return ["hook", ...xf, "problem", "solution", ...feats, "payoff", "cta"]
}

function weightForType(
  type: AdSceneType,
  featureCount: number,
  emphasis: ScriptEmphasis,
  pacing: "snappy" | "standard" | "deliberate",
  creatorProductDemo?: boolean,
  novaPulseAITransformation?: boolean
): number {
  let w = 0
  switch (type) {
    case "hook":
      w = 0.1
      break
    case "demo_auth":
      w = 0.085
      break
    case "problem":
      w = 0.14
      break
    case "solution":
      w = 0.16
      break
    case "transformation_proof":
      w = 0.165
      break
    case "payoff":
      w = 0.12
      break
    case "cta":
      w = 0.12
      break
    case "feature":
      w = 0.36 / Math.max(1, featureCount)
      break
  }

  if (emphasis === "proof") {
    if (type === "payoff") w *= 1.55
    if (type === "transformation_proof") w *= 1.42
    if (type === "problem") w *= 0.78
    if (type === "feature") w *= 1.08
  }
  if (emphasis === "features" && type === "feature") w *= 1.38
  if (emphasis === "features" && type === "problem") w *= 0.86
  if (emphasis === "speed") {
    if (type === "solution") w *= 1.28
    if (type === "cta") w *= 1.22
    if (type === "problem") w *= 0.76
    if (type === "hook") w *= 1.12
  }
  if (emphasis === "flow") {
    if (type === "solution") w *= 1.12
    if (type === "problem") w *= 1.06
    if (type === "hook") w *= 1.04
  }

  if (pacing === "snappy") {
    if (type === "hook" || type === "cta") w *= 1.14
    if (type === "problem") w *= 0.88
  }
  if (pacing === "deliberate") {
    if (type === "payoff" || type === "solution" || type === "transformation_proof") w *= 1.14
    if (type === "hook") w *= 0.9
  }

  if (creatorProductDemo) {
    if (type === "transformation_proof") w *= 1.48
    if (type === "payoff") w *= 1.22
    if (type === "solution") w *= 1.08
    if (type === "feature") w *= 1.04
    if (type === "cta") w *= 1.05
    if (type === "problem") w *= 0.94
  }

  if (novaPulseAITransformation) {
    if (type === "transformation_proof") w *= 1.12
    if (type === "problem") w *= 0.9
    if (type === "demo_auth") w *= 0.88
  }

  return w
}

export interface SceneBuildProfile {
  narrativeMode?: NarrativeMode
  emphasis?: ScriptEmphasis
  pacing?: "snappy" | "standard" | "deliberate"
  /** Heavier dwell on proof/solution for creator SaaS demos (e.g. NovaPulseAI). */
  creatorProductDemo?: boolean
}

/**
 * Turn structured copy into timed scenes. Durations sum to `durationSeconds`.
 */
export function buildAdScenes(
  structured: StructuredAdScript,
  ingestion: AdSiteIngestion,
  durationSeconds: number,
  profile?: SceneBuildProfile
): BuiltAdScene[] {
  const d = clamp(durationSeconds, 10, 120)
  const featureCount = structured.features.length
  const narrativeMode = profile?.narrativeMode ?? "classic"
  const emphasis = profile?.emphasis ?? "balanced"
  const pacing = profile?.pacing ?? "standard"
  const creatorProductDemo = profile?.creatorProductDemo === true
  const novaPulseAI = detectNovaPulseAIProduct(ingestion)
  const includeTransformationProof = creatorProductDemo && novaPulseAI
  const npaiDemoLogin = novaPulseAI && novaPulseAIDemoLoginConfigured()

  const typesOrder = buildTypesOrder(featureCount, narrativeMode, includeTransformationProof, {
    novaPulseAI,
    npaiDemoLogin,
  })
  const rawWeights = typesOrder.map(t =>
    weightForType(t, featureCount, emphasis, pacing, creatorProductDemo, includeTransformationProof)
  )
  const sumW = rawWeights.reduce((a, b) => a + b, 0)
  const scaled = typesOrder.map((type, i) => ({
    type,
    w: (rawWeights[i]! / sumW) * d,
  }))

  const scenes: BuiltAdScene[] = []
  let featureIdx = 0

  let transformFeatureOffset = 0
  let transformText = ""
  if (includeTransformationProof) {
    if (structured.features.length >= 2) {
      transformText = (structured.features[0] || "").trim()
      transformFeatureOffset = 1
    } else {
      transformText = (
        structured.features[0] ||
        structured.payoff ||
        structured.solution ||
        ""
      ).trim()
      transformFeatureOffset = 0
    }
  }

  for (let i = 0; i < scaled.length; i++) {
    const item = scaled[i]!
    const type = item.type
    const durCap =
      type === "transformation_proof"
        ? d * 0.65
        : type === "payoff"
          ? d * 0.52
          : type === "demo_auth"
            ? d * 0.36
            : d * 0.48
    let dur = clamp(
      item.w,
      type === "transformation_proof" ? MIN_TRANSFORMATION_SCENE_SEC : MIN_SCENE_SEC,
      durCap
    )
    if (novaPulseAI) {
      if (type === "hook") dur *= 0.88
      else if (type === "demo_auth") dur *= 0.92
      else if (type === "problem") dur *= 0.94
      else if (type === "transformation_proof") dur *= 1.12
      else if (type === "cta") dur *= 0.9
    }
    if (type === "transformation_proof") {
      dur = Math.max(dur, d * 0.18)
      dur = Math.max(dur, MIN_TRANSFORMATION_SCENE_SEC)
      dur = Math.min(dur, durCap)
    }
    let text = ""
    let visual = ""
    let pagePath = "/"

    switch (type) {
      case "hook":
        text = structured.hook
        visual = "Hero frame — product identity"
        pagePath = pickPageForType(type, 0, ingestion)
        break
      case "demo_auth": {
        const hookLine = structured.hook.replace(/\s+/g, " ").trim()
        const shortProblem = structured.problem.replace(/\s+/g, " ").trim().split(/[.!?]/)[0] || ""
        text =
          shortProblem && shortProblem.length > 12
            ? `Sign in to your workspace. ${shortProblem}`
            : "Sign in with the demo account and step into the real NovaPulseAI workflow."
        visual = "Sign in — demo credentials (AD_DEMO_EMAIL / AD_DEMO_PASSWORD)"
        pagePath = pickPageForType(type, 0, ingestion)
        break
      }
      case "problem":
        text = structured.problem
        visual = "Site section — pain / context"
        pagePath = pickPageForType(type, 0, ingestion)
        break
      case "transformation_proof":
        text = voiceoverForTransformationBeat(
          transformText || structured.payoff || structured.solution || structured.hook
        )
        visual =
          "MAGIC BEAT — full clip grid / gallery visible; scan multiple thumbnails & variants; land on export or ready state (mute-readable)"
        pagePath = pickPageForType(type, 0, ingestion)
        break
      case "solution":
        text = structured.solution
        visual = creatorProductDemo
          ? "Creator workflow — repurposing & automation UI"
          : "Product UI / workflow"
        pagePath = pickPageForType(type, 0, ingestion)
        break
      case "feature": {
        const fi = featureIdx
        const idx = Math.min(
          fi + transformFeatureOffset,
          Math.max(0, structured.features.length - 1)
        )
        text = structured.features[idx] || structured.features[0] || ""
        visual = creatorProductDemo
          ? `Proof beat ${fi + 1} — tools, outputs, or clip batch`
          : `Feature highlight ${fi + 1} — UI capture`
        pagePath = pickPageForType(type, fi, ingestion)
        featureIdx++
        break
      }
      case "payoff":
        text = structured.payoff
        visual = creatorProductDemo
          ? "Multi-clip grid / batch view — publish-ready proof"
          : "Outcome / dashboard"
        pagePath = pickPageForType(type, 0, ingestion)
        break
      case "cta":
        text = structured.cta
        visual = creatorProductDemo ? "CTA — start shipping clips" : "CTA — pricing or signup"
        pagePath = pickPageForType(type, 0, ingestion)
        break
    }

    if (!text.trim()) continue

    let captionBeats: string[]
    if (type === "transformation_proof") {
      captionBeats = formatCaptions(text)
      if (captionBeats.length < 2) {
        captionBeats = ["One idea", "→ 10 clips", "Ready to post", "No editing"]
          .map(refineCaptionBeat)
          .filter(Boolean)
      }
    } else {
      captionBeats = formatCaptions(text)
    }
    const caption = captionBeats[0] || captionFor(text, 6)

    scenes.push({
      type,
      text: text.trim(),
      caption: caption.trim() || captionFor(text, 6),
      ...(captionBeats.length > 0 ? { captionBeats } : {}),
      visual,
      visualKind: ingestion.visuals.length ? "site_capture" : "gradient_fallback",
      duration: dur,
      transition: transitionFor(scenes.length, scaled.length, type),
      page: pagePath,
    })
  }

  const total = scenes.reduce((a, s) => a + s.duration, 0)
  if (total <= 0) return scenes
  const drift = d - total
  if (Math.abs(drift) > 0.05 && scenes.length) {
    const last = scenes[scenes.length - 1]!
    if (drift < 0) {
      last.duration = clamp(last.duration + drift, MIN_SCENE_SEC, d)
    } else if (novaPulseAI) {
      const xf = scenes.find(s => s.type === "transformation_proof")
      if (xf) {
        const room = Math.max(0, d * 0.65 - xf.duration)
        const add = Math.min(drift, room)
        xf.duration += add
        const rem = d - scenes.reduce((a, s) => a + s.duration, 0)
        if (Math.abs(rem) > 0.05 && last.type !== "transformation_proof") {
          last.duration = clamp(last.duration + rem, MIN_SCENE_SEC, d)
        }
      } else {
        last.duration = clamp(last.duration + drift, MIN_SCENE_SEC, d)
      }
    } else {
      last.duration = clamp(last.duration + drift, MIN_SCENE_SEC, d)
    }
  }

  if (novaPulseAI && includeTransformationProof) {
    const xf = scenes.find(s => s.type === "transformation_proof")
    const xfFloor = npaiDemoLogin ? 0.25 : 0.18
    if (xf && xf.duration < d * xfFloor - 1e-3) {
      const need = d * xfFloor - xf.duration
      const donors = scenes.filter(
        s =>
          s.type !== "transformation_proof" &&
          s.type !== "cta" &&
          s.type !== "demo_auth" &&
          s.type !== "hook"
      )
      let budget = need
      for (const s of donors) {
        if (budget <= 0) break
        const take = Math.min(budget, Math.max(0, s.duration - MIN_SCENE_SEC))
        if (take > 0) {
          s.duration -= take
          budget -= take
        }
      }
      xf.duration = Math.min(d * 0.65, xf.duration + need - budget)
    }
  }

  if (novaPulseAI && includeTransformationProof && npaiDemoLogin) {
    const drift2 = d - scenes.reduce((a, s) => a + s.duration, 0)
    if (drift2 > 0.06) {
      const xf = scenes.find(s => s.type === "transformation_proof")
      const po = scenes.find(s => s.type === "payoff")
      if (xf && po) {
        const addX = Math.min(drift2 * 0.62, d * 0.05)
        const addP = Math.min(drift2 - addX, d * 0.04)
        xf.duration = Math.min(d * 0.65, xf.duration + addX)
        po.duration = Math.min(d * 0.52, po.duration + addP)
      } else if (xf) {
        xf.duration = Math.min(d * 0.65, xf.duration + drift2)
      }
    }
  }

  return scenes
}

/** Top hook line on the graded video — short, readable in ~2s; VO may stay full-length. */
export function novaPulseAIHookOverlay(hook: string): string {
  let t = String(hook || "")
    .replace(/\s+/g, " ")
    .trim()
  if (!t) return t
  t = t.replace(/^meet\s+[^:]+:\s*/i, "").trim() || t
  const first = (t.split(/(?<=[.!?])\s+/)[0] || t).trim()
  if (first.split(/\s+/).length <= 9) return first
  return captionFor(first, 8)
}

/** CTA overlay: drop “watch …”, tighten em-dash ramble; keeps offer if present. */
export function novaPulseAICtaOverlay(cta: string): string {
  let t = String(cta || "")
    .replace(/\s+/g, " ")
    .trim()
  if (!t) return t
  t = t.replace(/\s*[—–-]\s*watch\s+[^.!?]+/gi, "")
  t = t.replace(/\bwatch\s+/gi, "")
  t = t.replace(/\s+/g, " ").trim()
  if (t.split(/\s+/).length > 16) {
    const head = t.split(/(?<=[.!?])\s+/)[0] || t
    return captionFor(head, 12)
  }
  return t
}

function routeNorm(p: string | undefined): string {
  if (!p) return "/"
  try {
    if (/^https?:\/\//i.test(p)) return new URL(p).pathname || "/"
    return p.split("?")[0] || "/"
  } catch {
    return "/"
  }
}

function canonicalPageForSceneType(
  type: AdSceneType,
  hero: string,
  login: string,
  tools: string,
  results: string,
  pricing: string
): string {
  switch (type) {
    case "demo_auth":
      return login
    case "cta":
      return pricing
    case "transformation_proof":
    case "payoff":
      return results
    case "solution":
    case "feature":
      return tools
    default:
      return hero
  }
}

/**
 * Final NovaPulseAI guardrail: transformation share, caption sell-test, ≤4 canonical routes.
 */
export function applyNovaPulseAIQualityPass(
  scenes: BuiltAdScene[],
  totalSec: number,
  ingestion: AdSiteIngestion
): BuiltAdScene[] {
  if (!detectNovaPulseAIProduct(ingestion) || scenes.length === 0) return scenes

  const xf = scenes.find(s => s.type === "transformation_proof")
  const loggedInArc = scenes.some(s => s.type === "demo_auth")
  const xfMinShare = loggedInArc ? 0.25 : 0.18
  if (xf) {
    const share = xf.duration / Math.max(0.5, totalSec)
    if (share < xfMinShare - 1e-4) {
      const need = totalSec * xfMinShare - xf.duration
      if (need > 0) {
        const donors = scenes.filter(
          s =>
            s.type !== "transformation_proof" &&
            s.type !== "cta" &&
            s.type !== "demo_auth" &&
            s.type !== "hook"
        )
        let budget = need
        for (const s of donors) {
          if (budget <= 0) break
          const take = Math.min(budget, Math.max(0, s.duration - MIN_SCENE_SEC))
          if (take > 0) {
            s.duration -= take
            budget -= take
          }
        }
        xf.duration = Math.min(totalSec * 0.65, xf.duration + need - budget)
      }
    }
  }

  const tools = pickPageForType("solution", 0, ingestion)
  const results = pickPageForType("transformation_proof", 0, ingestion)
  const hero = pickPageForType("hook", 0, ingestion)
  const login = pickPageForType("demo_auth", 0, ingestion)
  const pricing = pickPageForType("cta", 0, ingestion)

  const distinct = new Set(scenes.map(s => routeNorm(s.page)))
  const maxRoutes = scenes.some(s => s.type === "demo_auth") ? 5 : 4
  if (distinct.size > maxRoutes) {
    for (const s of scenes) {
      s.page = canonicalPageForSceneType(s.type, hero, login, tools, results, pricing)
    }
  }

  let pastAuth = false
  for (const s of scenes) {
    if (s.type === "demo_auth") pastAuth = true
    const beats = s.captionBeats?.length ? [...s.captionBeats] : s.caption ? [s.caption] : []
    if (!beats.length) continue
    const next = beats.map(b => {
      const w = b.split(/\s+/).length
      let x = w > CAPTION_MAX_WORDS ? refineCaptionBeat(b) : b
      if (s.type === "feature" && /:\s*\S/.test(x)) {
        const after = x.split(/:\s*/, 2)[1]?.trim()
        if (after && after.length > 6) x = refineCaptionBeat(after)
      }
      if (pastAuth && s.type !== "demo_auth" && s.type !== "hook") {
        if (
          /\b(engine|intelligence|module|dashboard|feature)\b/i.test(x) ||
          (s.type === "feature" && /:/.test(b))
        ) {
          x = refineCaptionBeat(
            /clip|post|batch/i.test(s.text) ? "More clips. Less work." : "One idea → many clips"
          )
        }
      }
      if (!captionSells(x)) x = refineCaptionBeat(conversionCaptionFallback(`${s.text} ${b}`))
      return x
    })
    s.captionBeats = next.length > 1 ? next : undefined
    s.caption = next[0] || s.caption
  }

  const drift = totalSec - scenes.reduce((a, s) => a + s.duration, 0)
  if (Math.abs(drift) > 0.05 && scenes.length) {
    const last = scenes[scenes.length - 1]!
    last.duration = clamp(last.duration + drift, MIN_SCENE_SEC, totalSec)
  }

  return scenes
}
