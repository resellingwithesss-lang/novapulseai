import { z } from "zod"
import { openai } from "../../../lib/openai"
import type { AdSiteIngestion } from "./types"
import type { StructuredAdScript } from "./types"
import type {
  AdCreativeMode,
  HookPattern,
  NarrativeMode,
  ScriptEmphasis,
} from "./ad.variant-presets"
import { detectNovaPulseAIProduct } from "./ad.product-profile"

const SCRIPT_MODEL = "gpt-4o"
const MAX_ATTEMPTS = 3

/** Per-completion wall-clock cap so a stuck `chat.completions.create` cannot hang the worker indefinitely. */
const SCRIPT_LLM_TIMEOUT_MS = (() => {
  const raw = Number(process.env.AD_SCRIPT_LLM_TIMEOUT_MS ?? "55000")
  if (!Number.isFinite(raw)) return 55_000
  return Math.min(120_000, Math.max(25_000, Math.floor(raw)))
})()

const PROMPT_WARN_CHARS = 72_000
const MAX_PARAGRAPH_BLOCK_CHARS = 10_000
const MAX_SINGLE_PARAGRAPH_CHARS = 2_000
const MAX_VISUAL_URL_IN_PROMPT = 220

/** Optional correlation for server logs (job DB id + HTTP request id). */
export type AdScriptGenLogContext = {
  requestId: string
  jobDbId: string
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  }) as Promise<T>
}

/** LLM controls for a single performance variant. */
export interface StructuredScriptGenOptions {
  hookPattern: HookPattern
  emphasis: ScriptEmphasis
  narrativeMode: NarrativeMode
  toneModifier: string
  variantTemperatureBump?: number
  /** Drives prompt + platform notes; default cinematic. */
  creativeMode?: AdCreativeMode
}

const structuredSchema = z.object({
  hook: z.string(),
  problem: z.string(),
  solution: z.string(),
  features: z.array(z.string()).min(1).max(5),
  payoff: z.string(),
  cta: z.string(),
})

function sanitize(s: string, max: number): string {
  const t = String(s ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 3)}...`
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

function truncateUrlForPrompt(url: string): string {
  const u = String(url ?? "")
  if (u.length <= MAX_VISUAL_URL_IN_PROMPT) return u
  return `${u.slice(0, MAX_VISUAL_URL_IN_PROMPT - 1)}…`
}

function clampParagraphBlock(paragraphs: string[]): string {
  let used = 0
  const parts: string[] = []
  for (const raw of paragraphs.slice(0, 5)) {
    const p =
      raw.length > MAX_SINGLE_PARAGRAPH_CHARS
        ? `${raw.slice(0, MAX_SINGLE_PARAGRAPH_CHARS - 1)}…`
        : raw
    if (!p.trim()) continue
    if (used + p.length + 1 > MAX_PARAGRAPH_BLOCK_CHARS) break
    parts.push(p)
    used += p.length + 1
  }
  return parts.join("\n")
}

/** Spoken brand for VO; NovaPulseAI sites get an explicit professional product name. */
function resolveSpokenBrand(ingestion: AdSiteIngestion): {
  spokenName: string
  novaPulseAIProduct: boolean
} {
  if (detectNovaPulseAIProduct(ingestion)) {
    return { spokenName: "NovaPulseAI", novaPulseAIProduct: true }
  }

  const fromBrand = (ingestion.brandName || "").trim()
  if (fromBrand) {
    return { spokenName: fromBrand, novaPulseAIProduct: false }
  }

  let host = ""
  try {
    host = new URL(ingestion.siteUrl).hostname.replace(/^www\./i, "").toLowerCase()
  } catch {
    host = ""
  }
  const seg = host.split(".")[0] || ""
  const pretty =
    seg.length > 0 ? seg.charAt(0).toUpperCase() + seg.slice(1) : "this product"
  return { spokenName: pretty, novaPulseAIProduct: false }
}

function hookPatternBlock(pattern: HookPattern, ingestion: AdSiteIngestion): string {
  const ctx = [ingestion.headline, ingestion.valueProps[0], ingestion.features[0], ingestion.headings[0]]
    .filter(Boolean)
    .join(" · ")

  const map: Record<HookPattern, string> = {
    manual_pain: `HOOK STYLE — Manual pain / still-doing-it: Open like "You're still [doing X manually]?" or "Still [wasting time on Y]?" Derive X/Y only from site facts (headings, value props, description). Must feel specific to THIS product, not generic SaaS. Context: ${ctx || "use site facts"}`,
    replace_process: `HOOK STYLE — Replacement / speed: Open like "This replaces [tedious thing] in seconds" or "[Old way] → [this] in one flow." Name the old way from what the site clearly replaces. Context: ${ctx || "use site facts"}`,
    missed_truth: `HOOK STYLE — Missed leverage: Open like "Most people miss this when [task]" or "The part everyone skips when [task]." Task must match the site's audience. Context: ${ctx || "use site facts"}`,
    tested_for_you: `HOOK STYLE — Social proof angle (honest): "We stress-tested the workflow so you don't have to" or "Here's what actually saves time" — no fake reviews; frame as process clarity from the product's promise. Context: ${ctx || "use site facts"}`,
    result_tease: `HOOK STYLE — Result-first tease: Open with the OUTCOME (what you get / see / ship) in one punchy line — curiosity without fake metrics. Then the rest of the arc explains how. Context: ${ctx || "use site facts"}`,
    curiosity_gap: `HOOK STYLE — Curiosity gap: First line creates tension or a question the viewer needs answered; second clause hints the product resolves it. Must use concrete words from the site. Context: ${ctx || "use site facts"}`,
  }
  return map[pattern]
}

function emphasisBlock(emphasis: ScriptEmphasis): string {
  switch (emphasis) {
    case "proof":
      return `VARIANT EMPHASIS — PROOF: Payoff and features must feel verifiable from the site (capabilities, outputs, workflow). Prefer "you see / you get / you ship" over abstract hype.`
    case "features":
      return `VARIANT EMPHASIS — FEATURES: Each feature line is a sharp capability callout tied to headings or feature snippets; minimal filler between them.`
    case "speed":
      return `VARIANT EMPHASIS — SPEED: Stress time saved, steps removed, and friction cut; keep clauses short and urgent without sounding scammy.`
    case "flow":
      return `VARIANT EMPHASIS — FLOW: Problem → solution should feel like one continuous user journey (tabs, tools, handoffs) the product fixes.`
    default:
      return `VARIANT EMPHASIS — BALANCED: Mix pain, mechanism, and outcome evenly.`
  }
}

function narrativeBlock(mode: NarrativeMode): string {
  if (mode === "result_first") {
    return `NARRATIVE MODE — RESULT-FIRST: The hook must tease the end state first (what "good" looks like). Keep "problem" shorter — frame as what used to block that outcome, not a long rant. "Solution" bridges how the product delivers the hook's promise. Payoff reinforces the same win in fresh words.`
  }
  return `NARRATIVE MODE — CLASSIC: Hook → tension → resolution → proof → CTA.`
}

function novaPulseAICreatorAdBlock(
  novaPulseAIProduct: boolean,
  creativeMode: AdCreativeMode | undefined
): string {
  if (!novaPulseAIProduct) return ""
  const ugc = creativeMode === "ugc_social"
  return `
NOVAPULSEAI — CREATOR PRODUCT AD (mandatory framing):
- This is NOT a generic SaaS explainer. NovaPulseAI is a **content creation + repurposing + automation** system for **creators**: ship faster, cut manual editing/admin, turn one idea or long-form source into **multiple ready-to-post clips**, move from creation to publishing with less friction.
- **hook**: Win the first 1–2 seconds; premium, human, persuasive — still obey the HOOK STYLE above and the BRANDED OPENING for NovaPulseAI.
- **problem**: Name **creator-native** friction grounded in SITE FACTS (manual cutting/reformatting, slow turnaround, tool chaos, can't ship enough posts) — not vague "efficiency."
- **solution**: Show NovaPulseAI as the **system** that compresses the workflow (repurpose, automate steps, batch outputs) — something you **use**, not a dashboard tour with no payoff.
- **features** (2–4 lines): Sharp, visualizable capabilities; when site facts allow, at least one line must imply **multiple outputs** or **ready-to-post / publish-ready clips**; another should touch **repurposing, automation, or speed** — use the site's own words.
- **Transformation moment (for video)**: Write so a **single beat** can show **one input becoming a grid of clips** (batch, thumbnails, export-ready) — not a slow generic nav tour; the **first feature line** should often work as that proof beat.
- **payoff**: Make the result undeniable: **more clips ready to post with less grind** (honest language; no fake stats or reviews).
- **cta**: Creator motion + outcome (ship a batch of clips, see outputs in one flow, try the workflow) — still obey CTA RULES below.
${ugc ? "- UGC / short-form: tighter beats and casual energy, but keep the **multi-clip + repurposing + automation** promise central.\n" : "- Cinematic: **high-end product demo** — polished paid-social spot for a premium creator tool; aspirational, clear, never robotic corporate voice.\n"}`
}

function ugcCreativeBlock(mode: AdCreativeMode | undefined): string {
  if (mode !== "ugc_social") return ""
  return `

CREATIVE MODE — UGC / SHORT-FORM NATIVE (not a polished TV spot):
- Win the first 1–2 seconds: blunt contrast, a sharp outcome tease, or a relatable "you still doing X?" — grounded in site facts.
- Shorter clauses: prefer beats under ~14 spoken words; punch over polish.
- Sound like a real creator: casual, direct, "here's what actually works" — avoid corporate filler and slow cinematic buildup.
- Pain → result: name friction fast, prove payoff early; skip long elegant transitions in the copy.
- CTA: conversational ("try it", "see for yourself", "peep the site") — still specific to the product, not generic "sign up".
- Every claim must remain grounded in SITE FACTS below.`
}

function buildUserPrompt(
  ingestion: AdSiteIngestion,
  tone: string,
  durationSeconds: number,
  platform: string,
  gen: StructuredScriptGenOptions
): string {
  const ugc = gen.creativeMode === "ugc_social"
  const platformGuide =
    platform === "youtube"
      ? ugc
        ? "YouTube 16:9 UGC: hook in first 2s; direct; minimal flourish."
        : "YouTube16:9: slightly more explanatory hook; clarity over hype."
      : platform === "instagram"
        ? ugc
          ? "Instagram 1:1 UGC: feed-native; bold first frame; tight lines."
          : "Instagram 1:1: premium, concise; strong first line; aesthetic confidence."
        : ugc
          ? "TikTok 9:16 UGC: brutal scroll-stop in second one; rumor of proof immediately; zero filler."
          : "TikTok 9:16: pattern-interrupt hook in first 2–3 seconds; punchy clauses; stop the scroll."

  const headings = ingestion.headings.slice(0, 10).join(" | ")
  const paragraphs = clampParagraphBlock(ingestion.keyParagraphs)
  const valueProps = ingestion.valueProps.slice(0, 8).join(" | ")
  const feats = ingestion.features.slice(0, 8).join(" | ")
  const visuals = ingestion.visuals
    .slice(0, 5)
    .map(v => `${v.kind}:${truncateUrlForPrompt(v.url)}`)
    .join("\n")

  const brand = resolveSpokenBrand(ingestion)
  const npaiBlock = novaPulseAICreatorAdBlock(brand.novaPulseAIProduct, gen.creativeMode)
  const brandIntroRules = brand.novaPulseAIProduct
    ? `BRANDED OPENING (required for this product):
- Spoken product name: **NovaPulseAI** (exact spelling, one word).
- The "hook" MUST naturally include **NovaPulseAI** once in the first sentence or two, in a professional ad tone — e.g. "Meet NovaPulseAI…", "This is NovaPulseAI…", "NovaPulseAI helps you…", "With NovaPulseAI, you can…". Pick one pattern that fits the HOOK STYLE above.
- Do not stuff the name into every field; use it in the hook and at most once more in solution or CTA if it reads naturally.`
    : `SPOKEN PRODUCT NAME:
- Prefer naming the product as «${brand.spokenName}» in the hook's opening when it fits the HOOK STYLE (e.g. "Meet ${brand.spokenName}…", "With ${brand.spokenName}, you…").
- Use the name at most twice across the whole JSON; keep the hook ad-worthy, not a dry company bio.`
  const ctaLabels = (ingestion.ctaTexts || []).slice(0, 6).join(" | ") || "none detected"

  const toneBlend = gen.toneModifier.trim()
    ? `User-selected tone: ${tone}. This variant also applies: ${gen.toneModifier}. Blend them — do not ignore the user tone.`
    : `Tone: ${tone}`

  return `You write high-converting paid social scripts (performance creative), not generic brand poetry.

${platformGuide}
Total video length target: ~${durationSeconds} seconds (voice will be recorded to fit; keep total spoken content appropriate).

${toneBlend}

${hookPatternBlock(gen.hookPattern, ingestion)}

${emphasisBlock(gen.emphasis)}

${narrativeBlock(gen.narrativeMode)}
${ugcCreativeBlock(gen.creativeMode)}
${npaiBlock}
${brandIntroRules}

Product origin URL: ${ingestion.siteUrl}

FACTS FROM THE SITE (must ground every claim — no invented stats, awards, or fake testimonials):
Brand name: ${ingestion.brandName || "unknown — infer carefully from domain only"}
Page title: ${ingestion.title || ""}
Primary headline: ${ingestion.headline || ""}
Subheadline: ${ingestion.subheadline || ""}
Meta description: ${ingestion.description || ""}
Headings: ${headings || "none"}
Key paragraphs:
${paragraphs || "none"}
Value props / bullets: ${valueProps || "none"}
Feature snippets: ${feats || "none"}
CTA labels seen on site (mirror language when natural): ${ctaLabels}
Detected page captures (use to imply visuals):${visuals || "none"}

Return JSON ONLY with this shape:
{
  "hook": "one or two short sentences — must follow the HOOK STYLE above",
  "problem": "relatable pain tied to the audience this site serves",
  "solution": "how this product/site addresses it (concrete, not buzzwords)",
  "features": ["2-4 tight lines — each one a single benefit tied to site content"],
  "payoff": "outcome / transformation (no fake numbers)",
  "cta": "single strong spoken CTA — see CTA rules below"
}

CTA RULES (critical):
- Do NOT use "Get started" or "Sign up" alone as the full CTA.
- Prefer specific motion + outcome + optional time: examples: "See your first result in under a minute", "Try it free — no card", "Launch your first workflow today", "Watch it replace three tabs in one pass".
- Align wording with on-site CTA labels when they fit; otherwise stay close in spirit.
- Match the blended tone (user + variant).

Rules:
- features array: 2 to 4 items only.
- Each string: spoken-aloud friendly; short clauses.
- No competitor names. No fake percentages or reviews.
- If facts are thin, stay honest and aspirational without lying.
`
}

const DEFAULT_GEN: StructuredScriptGenOptions = {
  hookPattern: "curiosity_gap",
  emphasis: "balanced",
  narrativeMode: "classic",
  toneModifier: "",
  creativeMode: "cinematic",
}

export async function generateStructuredAdScript(
  ingestion: AdSiteIngestion,
  tone: string,
  durationSeconds: number,
  platform: string,
  genOptions?: Partial<StructuredScriptGenOptions>,
  logContext?: AdScriptGenLogContext
): Promise<StructuredAdScript> {
  const gen: StructuredScriptGenOptions = {
    ...DEFAULT_GEN,
    ...genOptions,
    hookPattern: genOptions?.hookPattern ?? DEFAULT_GEN.hookPattern,
    emphasis: genOptions?.emphasis ?? DEFAULT_GEN.emphasis,
    narrativeMode: genOptions?.narrativeMode ?? DEFAULT_GEN.narrativeMode,
    toneModifier: genOptions?.toneModifier ?? DEFAULT_GEN.toneModifier,
    creativeMode: genOptions?.creativeMode ?? DEFAULT_GEN.creativeMode,
  }
  const prompt = buildUserPrompt(ingestion, tone, durationSeconds, platform, gen)
  const tempBump = gen.variantTemperatureBump ?? 0
  const logPrefix = logContext
    ? `[ads:script:llm] requestId=${logContext.requestId} jobDbId=${logContext.jobDbId}`
    : `[ads:script:llm]`

  const vf = detectNovaPulseAIProduct(ingestion)
  const vfSystem = !vf
    ? ""
    : gen.creativeMode !== "ugc_social"
      ? " Prioritize a premium cinematic product-demo for creators (repurposing, automation, multiple publish-ready clips); avoid generic enterprise workflow copy."
      : " This product is NovaPulseAI — creator-focused repurposing and multi-clip automation; avoid generic SaaS filler."

  const systemContent =
    gen.creativeMode === "ugc_social"
      ? `You write feed-native UGC ad scripts for TikTok/Reels: punchy, creator-voice, no corporate poetry. Output valid JSON only. Ground all claims in the provided site facts.${vfSystem}`
      : `You are a senior creative director for paid social. Output valid JSON only. Ground all claims in the provided site facts.${vfSystem}`

  const payloadChars = systemContent.length + prompt.length
  const startedAtIso = new Date().toISOString()
  const keyOk = Boolean(process.env.OPENAI_API_KEY?.trim())
  console.log(
    `${logPrefix} phase=start ts=${startedAtIso} site=${ingestion.siteUrl} model=${SCRIPT_MODEL} ` +
      `userPromptChars=${prompt.length} payloadChars=${payloadChars} OPENAI_API_KEY=${keyOk ? "set" : "MISSING"} ` +
      `timeoutMs=${SCRIPT_LLM_TIMEOUT_MS}`
  )
  if (prompt.length > PROMPT_WARN_CHARS) {
    console.warn(
      `${logPrefix} warn=large_user_prompt userPromptChars=${prompt.length} (may slow or fail the model)`
    )
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const attemptStart = Date.now()
    try {
      console.log(
        `${logPrefix} phase=llm_request attempt=${attempt + 1}/${MAX_ATTEMPTS} ` +
          `temperature=${(0.7 + attempt * 0.04 + tempBump).toFixed(3)} ts=${new Date().toISOString()}`
      )

      const completion = await withTimeout(
        openai.chat.completions.create({
          model: SCRIPT_MODEL,
          temperature: 0.7 + attempt * 0.04 + tempBump,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemContent },
            { role: "user", content: prompt },
          ],
        }),
        SCRIPT_LLM_TIMEOUT_MS,
        "openai.chat.completions.create(structured ad script)"
      )

      const raw = completion.choices?.[0]?.message?.content || "{}"
      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(raw)
      } catch (parseErr) {
        const pe = parseErr instanceof Error ? parseErr.message : String(parseErr)
        throw new Error(`LLM returned non-JSON: ${pe}`)
      }
      const parsed = structuredSchema.parse(parsedJson)
      const durationMs = Date.now() - attemptStart
      console.log(
        `${logPrefix} phase=llm_success attempt=${attempt + 1}/${MAX_ATTEMPTS} durationMs=${durationMs} ` +
          `ts=${new Date().toISOString()}`
      )

      return {
        hook: sanitize(parsed.hook, 220),
        problem: sanitize(parsed.problem, 320),
        solution: sanitize(parsed.solution, 360),
        features: parsed.features.map(f => sanitize(f, 200)).slice(0, 4),
        payoff: sanitize(parsed.payoff, 280),
        cta: sanitize(parsed.cta, 200),
      }
    } catch (err) {
      const durationMs = Date.now() - attemptStart
      const msg = err instanceof Error ? err.message : String(err)
      const timedOut = /timed out after/i.test(msg)
      const phase = timedOut ? "llm_timeout" : "llm_or_parse_failed"
      console.warn(
        `${logPrefix} phase=${phase} attempt=${attempt + 1}/${MAX_ATTEMPTS} durationMs=${durationMs} error=${msg}`
      )
      if (attempt < MAX_ATTEMPTS - 1) await sleep(400 * (attempt + 1))
    }
  }

  const ended = new Date().toISOString()
  console.error(`${logPrefix} phase=exhausted_attempts ts=${ended} attempts=${MAX_ATTEMPTS}`)
  throw new Error(
    `Ad script generation failed after ${MAX_ATTEMPTS} attempts (timeout, invalid JSON, validation, or API error). See server logs tagged ads:script:llm.`
  )
}
