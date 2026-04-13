/**
 * Clip and ad renders are served by the Express API (`/clips`, `/generated`).
 * In the browser, relative paths resolve to the page origin so `fetch` hits Next rewrites
 * (same-origin, CSP-simple). Use `toDirectApiMediaUrl` for new-tab `<a href>` where the
 * browser may issue Range requests — those are safest against the API host directly.
 */

export function getApiOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:5000"
  let base = raw.replace(/\/$/, "")
  if (base.endsWith("/api")) base = base.slice(0, -4)
  return base
}

function normalizedMediaPath(publicPath: string): string {
  return publicPath.startsWith("/") ? publicPath : `/${publicPath}`
}

/**
 * Same-origin URL (browser) or API origin (SSR) for fetch/blob preview and downloads via proxy.
 */
export function toAbsoluteMediaUrl(publicPath: string): string {
  if (publicPath.startsWith("http://") || publicPath.startsWith("https://")) {
    return publicPath
  }
  const path = normalizedMediaPath(publicPath)
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${path}`
  }
  return `${getApiOrigin()}${path}`
}

/** Direct API URL for opening media in a new tab (Range-friendly). */
export function toDirectApiMediaUrl(publicPath: string): string {
  if (publicPath.startsWith("http://") || publicPath.startsWith("https://")) {
    return publicPath
  }
  return `${getApiOrigin()}${normalizedMediaPath(publicPath)}`
}

export function filenameFromPublicPath(publicPath: string): string {
  const segment = publicPath.split("/").filter(Boolean).pop()
  return segment && segment.includes(".") ? segment : "clip.mp4"
}

/** Reliable download when `href` is cross-origin (avoids broken `download` attribute). */
export async function downloadMediaBlob(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { method: "GET", mode: "cors", credentials: "omit" })
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`)
  }
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    const a = document.createElement("a")
    a.href = objectUrl
    a.download = filename
    a.rel = "noopener"
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
