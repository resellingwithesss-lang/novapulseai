/**
 * Defensive parsing of persisted AdJob.script JSON (older jobs may omit fields).
 */

export type StoredScoreBreakdown = {
  hook?: number
  clarity?: number
  specificity?: number
  novelty?: number
  payoff?: number
  pacing?: number
  cta?: number
}

export type StoredAdVariant = {
  id?: string
  label?: string
  score?: number
  totalScore?: number
  hook?: string
  cta?: string
  narration?: string
  narrativeMode?: string
  emphasis?: string
  hookPattern?: string
  interactionPacingMul?: number
  scoreBreakdown?: StoredScoreBreakdown
  explanation?: string
  heuristicNotes?: string[]
  heuristicAdjustmentSummary?: string
  passesThresholds?: boolean
  llmBreakdown?: StoredScoreBreakdown
  heuristicBreakdown?: StoredScoreBreakdown
  builtScenes?: unknown[]
  scenes?: unknown[]
  structured?: unknown
}

export type StoredScoreSelection = {
  usedThresholdGate?: boolean
  note?: string
}

export type ParsedStoredAdScript = {
  hook?: string
  cta?: string
  narration?: string
  adVariants?: StoredAdVariant[]
  selectedVariantId?: string
  variantId?: string
  variantLabel?: string
  scoreSelection?: StoredScoreSelection
  builtScenes?: unknown[]
  scenes?: unknown[]
  structured?: unknown
}

export function parseStoredAdScript(raw: unknown): ParsedStoredAdScript | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== "object") return null
  const s = raw as Record<string, unknown>

  const adVariantsRaw = s.adVariants
  const adVariants = Array.isArray(adVariantsRaw)
    ? adVariantsRaw
        .map(v => (v && typeof v === "object" ? (v as StoredAdVariant) : null))
        .filter((x): x is StoredAdVariant => x !== null)
    : undefined

  return {
    hook: typeof s.hook === "string" ? s.hook : undefined,
    cta: typeof s.cta === "string" ? s.cta : undefined,
    narration: typeof s.narration === "string" ? s.narration : undefined,
    adVariants,
    selectedVariantId:
      typeof s.selectedVariantId === "string" ? s.selectedVariantId : undefined,
    variantId: typeof s.variantId === "string" ? s.variantId : undefined,
    variantLabel: typeof s.variantLabel === "string" ? s.variantLabel : undefined,
    scoreSelection:
      s.scoreSelection && typeof s.scoreSelection === "object"
        ? (s.scoreSelection as StoredScoreSelection)
        : undefined,
    builtScenes: Array.isArray(s.builtScenes) ? s.builtScenes : undefined,
    scenes: Array.isArray(s.scenes) ? s.scenes : undefined,
    structured: s.structured,
  }
}

/** Fallback labels when older stored jobs omit narrativeMode / emphasis. */
export const VARIANT_PRESET_FALLBACK: Record<
  string,
  { narrativeMode: string; emphasis: string }
> = {
  flow: { narrativeMode: "classic", emphasis: "flow" },
  proof: { narrativeMode: "result_first", emphasis: "proof" },
  features: { narrativeMode: "classic", emphasis: "features" },
  speed: { narrativeMode: "classic", emphasis: "speed" },
}

export function resolveVariantMeta(v: StoredAdVariant): {
  narrativeMode: string
  emphasis: string
} {
  const id = v.id ?? ""
  const fb = id ? VARIANT_PRESET_FALLBACK[id] : undefined
  return {
    narrativeMode: v.narrativeMode ?? fb?.narrativeMode ?? "—",
    emphasis: v.emphasis ?? fb?.emphasis ?? "—",
  }
}

const BREAKDOWN_KEYS: (keyof StoredScoreBreakdown)[] = [
  "hook",
  "clarity",
  "specificity",
  "novelty",
  "payoff",
  "pacing",
  "cta",
]

export function formatBreakdownLines(b?: StoredScoreBreakdown | null): string[] {
  if (!b) return []
  return BREAKDOWN_KEYS.map(key => {
    const n = b[key]
    if (typeof n !== "number" || Number.isNaN(n)) return `${key}: —`
    return `${key}: ${Math.round(n)}`
  })
}

function nonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0
}

/** Mirrors server validation: hook/cta, scenes, narration/voice text. */
export function variantRerenderable(v: StoredAdVariant): boolean {
  if (!nonEmpty(v.hook) || !nonEmpty(v.cta)) return false
  const builtOk = Array.isArray(v.builtScenes) && v.builtScenes.length > 0
  const scenesOk = Array.isArray(v.scenes) && v.scenes.length > 0
  if (!builtOk && !scenesOk) return false
  if (nonEmpty(v.narration)) return true
  if (scenesOk) {
    const hasText = v.scenes!.some(
      x =>
        x &&
        typeof x === "object" &&
        nonEmpty((x as { text?: string }).text)
    )
    if (hasText) return true
  }
  if (builtOk) {
    const hasText = (v.builtScenes as { text?: string }[]).some(s =>
      nonEmpty(s?.text)
    )
    if (hasText) return true
  }
  return false
}
