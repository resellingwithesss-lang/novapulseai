/**
 * Normalizes Chat Completions assistant `message.content` to plain text.
 * Newer API responses may return `content` as an array of `{ type: "text", text }` parts
 * instead of a string; calling `.trim()` on that shape throws and fails every retry.
 */
export function assistantMessageBodyToText(
  message: { content?: unknown; refusal?: string | null } | null | undefined
): string {
  if (!message) return ""

  const topRefusal =
    typeof message.refusal === "string" ? message.refusal.trim() : ""
  if (topRefusal) {
    throw new Error(`LLM refusal: ${topRefusal}`)
  }

  const c = message.content
  if (c == null) return ""
  if (typeof c === "string") return c

  if (Array.isArray(c)) {
    const out: string[] = []
    for (const part of c) {
      if (!part || typeof part !== "object") continue
      const p = part as Record<string, unknown>
      if (p.type === "refusal") {
        const r = typeof p.refusal === "string" ? p.refusal.trim() : ""
        if (r) throw new Error(`LLM refusal: ${r}`)
      }
      if (p.type === "text" && typeof p.text === "string") {
        out.push(p.text)
      }
    }
    return out.join("")
  }

  return ""
}
