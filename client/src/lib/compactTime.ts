/** Short relative hint for list metadata (not a full timestamp replacement). */
export function formatCompactRelative(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const diff = Date.now() - t
  const minute = 60_000
  const day = 86_400_000
  if (diff < minute) return "just now"
  if (diff < day) return "today"
  if (diff < 2 * day) return "yesterday"
  const days = Math.floor(diff / day)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
