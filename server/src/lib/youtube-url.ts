/**
 * Source of truth for the YouTube URL hostname allowlist and the canonical
 * validator used by the clip pipeline.
 *
 * The client-side clipper page (`client/src/app/dashboard/tools/clipper/page.tsx`)
 * keeps an inline copy of the hostname set for fast in-form feedback. That
 * duplication is covered by a drift test in
 * `server/src/tests/clip/youtube-url.test.ts`, which reads the client source
 * and asserts the two sets stay identical. If you change the allowlist here,
 * update the client literal to match.
 *
 * This module deliberately does NOT depend on `url-guard.ts`. The SSRF guard
 * in `assertPublicHttpUrl` still runs downstream in `downloadYoutubeVideo`;
 * what we need here is narrow allowlist / shape validation with reason-specific
 * error messages suitable for surfacing to end users.
 */

/** Maximum URL length accepted before parsing (matches the SSRF guard default). */
export const YOUTUBE_URL_MAX_LENGTH = 2048

/**
 * Canonical YouTube hostnames accepted by the clip ingest pipeline.
 * yt-dlp and youtube-transcript both accept every entry here.
 */
export const YOUTUBE_HOSTS: readonly string[] = Object.freeze([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
])

const YOUTUBE_HOST_SET: ReadonlySet<string> = new Set(YOUTUBE_HOSTS)

export type YoutubeUrlRejectReason =
  | "empty"
  | "too_long"
  | "parse_failed"
  | "bad_scheme"
  | "host_not_allowed"

export type YoutubeUrlValidation =
  | { ok: true; url: string }
  | { ok: false; reason: YoutubeUrlRejectReason; detail?: string }

/**
 * Validate a user-supplied YouTube URL string. Trims whitespace, prepends
 * `https://` when the scheme is missing, and rejects anything that is not on
 * the canonical YouTube hostname allowlist. Returns the normalized absolute
 * URL on success so downstream code (job store, yt-dlp, SSRF guard) always
 * sees a well-formed value.
 */
export function validateYoutubeUrl(raw: unknown): YoutubeUrlValidation {
  if (typeof raw !== "string") return { ok: false, reason: "empty" }
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, reason: "empty" }
  if (trimmed.length > YOUTUBE_URL_MAX_LENGTH) {
    return { ok: false, reason: "too_long" }
  }

  // Only prepend `https://` when the value has NO scheme at all (e.g. a bare
  // `youtube.com/watch?v=…`). If the user already supplied a scheme — including
  // non-http ones like `javascript:`, `ftp:`, `data:` — keep it so the protocol
  // check below can reject it with a specific `bad_scheme` reason instead of
  // producing a mangled `https://javascript:alert(1)` that only fails to parse.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  const normalized = hasScheme ? trimmed : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    return { ok: false, reason: "parse_failed" }
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      reason: "bad_scheme",
      detail: parsed.protocol.replace(/:$/, ""),
    }
  }

  const host = parsed.hostname.toLowerCase()
  if (!YOUTUBE_HOST_SET.has(host)) {
    return { ok: false, reason: "host_not_allowed", detail: host }
  }

  return { ok: true, url: normalized }
}

/** Convenience boolean wrapper for call sites that do not need the reason. */
export function isAllowedYoutubeUrl(raw: unknown): boolean {
  return validateYoutubeUrl(raw).ok
}

/**
 * Render a user-facing rejection reason. Kept in this module so the message
 * strings never drift away from the enum of reasons the validator can emit.
 */
export function youtubeUrlRejectionMessage(result: YoutubeUrlValidation): string {
  if (result.ok) return ""
  // tsconfig has `strict: false`, so discriminated-union narrowing on a
  // boolean discriminant does not always kick in. The `if (result.ok)` guard
  // above proves the shape; `Extract` makes it explicit for the compiler.
  const failure = result as Extract<YoutubeUrlValidation, { ok: false }>
  const allowed = YOUTUBE_HOSTS.join(", ")
  switch (failure.reason) {
    case "empty":
      return "Please paste a YouTube link (youtube.com, youtu.be, or a supported subdomain)."
    case "too_long":
      return `YouTube URL is too long (max ${YOUTUBE_URL_MAX_LENGTH} characters).`
    case "parse_failed":
      return "That does not look like a URL. Paste the full watch or share link, e.g. https://youtu.be/VIDEO_ID."
    case "bad_scheme":
      return failure.detail
        ? `Only http:// or https:// links are accepted (got "${failure.detail}:"). Paste a normal YouTube URL.`
        : "Only http:// or https:// links are accepted. Paste a normal YouTube URL."
    case "host_not_allowed":
      return failure.detail
        ? `"${failure.detail}" is not a recognized YouTube domain. Use one of: ${allowed}.`
        : `Host is not a recognized YouTube domain. Use one of: ${allowed}.`
  }
}
