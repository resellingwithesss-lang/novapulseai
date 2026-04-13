/** Count non-empty string lines in content pack `payload` arrays (client-side only). */

export type PackLineCounts = {
  hooks: number
  scripts: number
  titles: number
  captions: number
  ctas: number
  clipAngles: number
  total: number
}

const KEYS = ["hooks", "scripts", "titles", "captions", "ctas", "clipAngles"] as const

export function countPackPayloadLines(payload: unknown): PackLineCounts {
  const p = payload as Record<string, unknown> | null | undefined
  const out: PackLineCounts = {
    hooks: 0,
    scripts: 0,
    titles: 0,
    captions: 0,
    ctas: 0,
    clipAngles: 0,
    total: 0,
  }
  if (!p || typeof p !== "object") return out

  let total = 0
  for (const k of KEYS) {
    const raw = p[k]
    const arr = Array.isArray(raw) ? raw : []
    const n = arr.filter((x) => typeof x === "string" && x.trim().length > 0).length
    out[k] = n
    total += n
  }
  out.total = total
  return out
}

/** Short scan line, e.g. "6 hooks · 2 scripts · 4 titles" */
export function formatPackCountsChips(c: PackLineCounts): string[] {
  if (c.total === 0) return []
  const chips: string[] = []
  if (c.hooks) chips.push(`${c.hooks} hook${c.hooks === 1 ? "" : "s"}`)
  if (c.scripts) chips.push(`${c.scripts} script${c.scripts === 1 ? "" : "s"}`)
  if (c.titles) chips.push(`${c.titles} title${c.titles === 1 ? "" : "s"}`)
  if (c.captions) chips.push(`${c.captions} caption${c.captions === 1 ? "" : "s"}`)
  if (c.ctas) chips.push(`${c.ctas} CTA${c.ctas === 1 ? "" : "s"}`)
  if (c.clipAngles) chips.push(`${c.clipAngles} angle${c.clipAngles === 1 ? "" : "s"}`)
  return chips
}

function truncatePreview(s: string, maxLen: number) {
  const t = s.trim()
  if (!t) return ""
  if (t.length <= maxLen) return t
  return `${t.slice(0, maxLen - 1).trimEnd()}…`
}

function firstStringIn(payload: Record<string, unknown>, key: string): string | null {
  const raw = payload[key]
  const arr = Array.isArray(raw) ? raw : []
  const hit = arr.find((x) => typeof x === "string" && (x as string).trim().length > 0)
  return typeof hit === "string" ? hit.trim() : null
}

/** First hook if present; otherwise first title, angle, script beat, caption, or CTA — else topic teaser. */
/** True when no hooks, titles, scripts, etc. contain non-empty strings. */
export function isPackPayloadLinesEmpty(payload: unknown): boolean {
  return countPackPayloadLines(payload).total === 0
}

/** Card / list hint when the save has topic + metadata but no line bodies yet. */
export function packSparseCardHint(topic: string): string {
  const t = topic.trim()
  if (t) {
    return "No hooks or scripts in this save yet—your topic is still the anchor. Open the pack to route lines into tools, or regenerate when you are ready."
  }
  return "This save has the shell but no filled lines yet. Open it to continue in tools or run a fresh pack."
}

export function packCardPreviewLine(payload: unknown, topicFallback: string, maxLen = 102): string {
  const topic = (topicFallback || "").trim()
  const p = payload as Record<string, unknown> | null
  if (!p || typeof p !== "object") return truncatePreview(topic, maxLen) || "Pack topic on file."

  const hook = firstStringIn(p, "hooks")
  if (hook) return truncatePreview(hook, maxLen)

  const title = firstStringIn(p, "titles")
  if (title) return `Title line: ${truncatePreview(title, Math.max(24, maxLen - 14))}`

  const angle = firstStringIn(p, "clipAngles")
  if (angle) return `Clip angle: ${truncatePreview(angle, Math.max(24, maxLen - 14))}`

  const script = firstStringIn(p, "scripts")
  if (script) return `Script beat: ${truncatePreview(script, Math.max(24, maxLen - 14))}`

  const cap = firstStringIn(p, "captions")
  if (cap) return `Caption: ${truncatePreview(cap, Math.max(24, maxLen - 11))}`

  const cta = firstStringIn(p, "ctas")
  if (cta) return `CTA: ${truncatePreview(cta, Math.max(24, maxLen - 6))}`

  if (topic) return truncatePreview(topic, maxLen)
  return "Pack topic on file."
}

/**
 * Short label for the preview strip. Pass `cardTopic` when the card has a topic string
 * so empty payloads do not read as “Topic” when there is no topic line to show.
 */
export function packCardPreviewLabel(payload: unknown, cardTopic = ""): string {
  const counts = countPackPayloadLines(payload)
  if (counts.total === 0) {
    return (cardTopic || "").trim() ? "Topic" : "Brief"
  }
  const p = payload as Record<string, unknown> | null
  if (!p || typeof p !== "object") return "Preview"
  if (firstStringIn(p, "hooks")) return "Lead hook"
  if (firstStringIn(p, "titles")) return "Inside"
  if (firstStringIn(p, "clipAngles")) return "Inside"
  if (firstStringIn(p, "scripts")) return "Inside"
  if (firstStringIn(p, "captions")) return "Inside"
  if (firstStringIn(p, "ctas")) return "Inside"
  return "Topic"
}

/** @deprecated Prefer {@link packCardPreviewLine} for cards. */
export function firstPackHookPreview(payload: unknown, maxLen = 96): string | null {
  const p = payload as { hooks?: unknown } | null | undefined
  const hooks = Array.isArray(p?.hooks) ? p.hooks : []
  const first = hooks.find((x) => typeof x === "string" && x.trim())
  if (typeof first !== "string") return null
  const t = first.trim()
  if (t.length <= maxLen) return t
  return `${t.slice(0, maxLen - 1).trimEnd()}…`
}
