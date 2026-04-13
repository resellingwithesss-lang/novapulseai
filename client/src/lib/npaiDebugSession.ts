/**
 * Dev-only: mirror debug events into sessionStorage so we still have runtime
 * evidence when the server cannot write debug-a5148d.log (Cursor sync, perms).
 */
export function npaiDebugSessionAppend(
  event: string,
  data: Record<string, unknown>
) {
  if (process.env.NODE_ENV !== "development") return
  if (typeof sessionStorage === "undefined") return
  try {
    const entry = { event, data, ts: Date.now() }
    sessionStorage.setItem("novapulseai_debug_a5148d_last", JSON.stringify(entry))
    const raw = sessionStorage.getItem("novapulseai_debug_a5148d_ring")
    const ring: Record<string, unknown>[] = raw ? JSON.parse(raw) : []
    ring.push(entry)
    while (ring.length > 50) ring.shift()
    sessionStorage.setItem("novapulseai_debug_a5148d_ring", JSON.stringify(ring))
  } catch {
    /* quota / private mode */
  }
}
