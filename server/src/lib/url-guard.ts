import net from "net"
import { promises as dnsPromises } from "dns"

/**
 * Synchronous SSRF guard for user-supplied URLs that will be fetched server-side
 * (Puppeteer, yt-dlp, axios, etc.). Blocks obvious private/reserved targets
 * without DNS lookups. DNS-rebinding is not fully defeated here — downstream
 * clients (e.g. Chromium) perform their own name resolution — but this prevents
 * the trivial "http://127.0.0.1:5432" / "http://169.254.169.254/" class of
 * attacks. For the outbound choke point pair with `assertPublicHttpUrlWithDns`
 * below, which additionally resolves the hostname and rejects private results.
 *
 * Callers that must allow loopback in local development should gate on
 * `isLoopbackIngestionAllowed()` (NODE_ENV + AD_TREAT_LOCALHOST_AS_NOVAPULSEAI)
 * to stay consistent with the existing capture-profile behaviour in
 * `modules/ads/pipeline/ad.product-profile.ts`.
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
])

const LOOPBACK_HOSTNAMES = new Set(["localhost", "ip6-localhost"])

function isReservedIPv4(ip: string): boolean {
  const parts = ip.split(".")
  if (parts.length !== 4) return false
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = nums as [number, number, number, number]

  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // RFC 1918
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local + AWS/GCP metadata
  if (a === 172 && b >= 16 && b <= 31) return true // RFC 1918
  if (a === 192 && b === 168) return true // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT RFC 6598
  if (a >= 224) return true // multicast + reserved
  return false
}

function isReservedIPv6(ip: string): boolean {
  const norm = ip.toLowerCase().replace(/^\[|\]$/g, "")
  if (norm === "::" || norm === "::1") return true
  if (norm === "0:0:0:0:0:0:0:0" || norm === "0:0:0:0:0:0:0:1") return true
  if (norm.startsWith("fe80:")) return true // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(norm)) return true // ULA fc00::/7
  if (/^ff[0-9a-f]{2}:/.test(norm)) return true // multicast
  if (norm.startsWith("::ffff:")) {
    const v4 = norm.slice("::ffff:".length)
    if (net.isIPv4(v4) && isReservedIPv4(v4)) return true
  }
  return false
}

export type AssertPublicHttpUrlOptions = {
  /** Maximum raw-input length. Defaults to 2048. */
  maxLength?: number
  /** In dev-only flows, permit localhost / 127.0.0.1 / ::1. */
  allowLoopback?: boolean
  /** Accept bare hostnames by defaulting to https://. */
  allowSchemeless?: boolean
}

export class UnsafeUrlError extends Error {
  code: "UNSAFE_URL"

  constructor(public reason: string) {
    super(`Unsafe URL: ${reason}`)
    this.name = "UnsafeUrlError"
    this.code = "UNSAFE_URL"
  }
}

/**
 * Parse, validate, and return a normalized absolute URL suitable for
 * server-side navigation/fetch. Throws `UnsafeUrlError` when the target is
 * unsafe (non-http, credentials, private/loopback IP, cloud metadata host).
 */
export function assertPublicHttpUrl(
  input: unknown,
  opts: AssertPublicHttpUrlOptions = {}
): string {
  const maxLength = opts.maxLength ?? 2048
  const raw = typeof input === "string" ? input.trim() : ""
  if (!raw) throw new UnsafeUrlError("empty URL")
  if (raw.length > maxLength) {
    throw new UnsafeUrlError(`URL exceeds ${maxLength} characters`)
  }

  const candidate =
    opts.allowSchemeless && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new UnsafeUrlError("invalid URL")
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(
      `protocol "${url.protocol.replace(/:$/, "")}" not allowed`
    )
  }

  if (url.username || url.password) {
    throw new UnsafeUrlError("credentials in URL not allowed")
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (!hostname) throw new UnsafeUrlError("missing hostname")

  if (net.isIPv4(hostname)) {
    if (isReservedIPv4(hostname)) {
      if (opts.allowLoopback && hostname === "127.0.0.1") {
        return sanitize(url)
      }
      throw new UnsafeUrlError(`IP ${hostname} is reserved/private`)
    }
  } else if (net.isIPv6(hostname)) {
    if (isReservedIPv6(hostname)) {
      if (opts.allowLoopback && hostname === "::1") {
        return sanitize(url)
      }
      throw new UnsafeUrlError(`IPv6 ${hostname} is reserved/private`)
    }
  } else {
    if (BLOCKED_HOSTNAMES.has(hostname)) {
      if (opts.allowLoopback && LOOPBACK_HOSTNAMES.has(hostname)) {
        return sanitize(url)
      }
      throw new UnsafeUrlError(`hostname "${hostname}" not allowed`)
    }
    // Unqualified single-label names (e.g. intranet "gitlab") can resolve to
    // internal services. Permit only when loopback dev is explicitly allowed.
    if (!hostname.includes(".")) {
      if (opts.allowLoopback) return sanitize(url)
      throw new UnsafeUrlError(`hostname "${hostname}" is not fully qualified`)
    }
  }

  return sanitize(url)
}

function sanitize(url: URL): string {
  url.hash = ""
  url.username = ""
  url.password = ""
  return url.toString()
}

/**
 * Resolve a hostname via the OS resolver and reject if ANY A/AAAA record
 * points into a private/reserved/link-local/loopback range. This is the
 * runtime half of the SSRF guard: the sync `assertPublicHttpUrl` only
 * inspects literal IPs, so hostnames like `internal.corp.example` that A-record
 * into RFC1918 space need this check to be refused before outbound navigation.
 *
 * Caveats:
 * - IP literals are a no-op here; the sync guard already validated them.
 * - Chromium resolves DNS itself for the actual request, so a hostile authority
 *   could in theory rebind between our check and Chromium's lookup. Closing
 *   that window requires pinning an IP into Chromium (e.g. --host-resolver-rules
 *   or per-request interception) and is out of scope for this guard.
 * - Cross-origin redirects followed by Chromium are NOT revalidated here.
 */
export async function assertPublicHostResolves(
  hostname: string,
  opts: { allowLoopback?: boolean } = {}
): Promise<void> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (!host) throw new UnsafeUrlError("missing hostname")
  if (net.isIP(host)) return

  let records: Array<{ address: string; family: number }>
  try {
    records = await dnsPromises.lookup(host, { all: true, verbatim: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new UnsafeUrlError(`DNS lookup failed for "${host}": ${msg}`)
  }
  if (!records.length) {
    throw new UnsafeUrlError(`DNS lookup returned no records for "${host}"`)
  }

  for (const { address, family } of records) {
    const ip = address.toLowerCase()
    if (family === 4) {
      if (!net.isIPv4(ip)) {
        throw new UnsafeUrlError(`DNS returned malformed IPv4 for "${host}"`)
      }
      if (isReservedIPv4(ip)) {
        if (opts.allowLoopback && ip === "127.0.0.1") continue
        throw new UnsafeUrlError(
          `hostname "${host}" resolved to reserved IPv4 ${ip}`
        )
      }
    } else if (family === 6) {
      if (!net.isIPv6(ip)) {
        throw new UnsafeUrlError(`DNS returned malformed IPv6 for "${host}"`)
      }
      if (isReservedIPv6(ip)) {
        if (
          opts.allowLoopback &&
          (ip === "::1" || ip === "0:0:0:0:0:0:0:1")
        ) {
          continue
        }
        throw new UnsafeUrlError(
          `hostname "${host}" resolved to reserved IPv6 ${ip}`
        )
      }
    } else {
      throw new UnsafeUrlError(
        `DNS returned unexpected address family ${family} for "${host}"`
      )
    }
  }
}

/**
 * Combined guard: run the synchronous `assertPublicHttpUrl` validation, then
 * resolve the resulting hostname and refuse if it points at private space.
 * Intended to be called ONCE at the true outbound choke point (just before
 * launching a Puppeteer navigation / issuing an axios request).
 */
export async function assertPublicHttpUrlWithDns(
  input: unknown,
  opts: AssertPublicHttpUrlOptions = {}
): Promise<string> {
  const safe = assertPublicHttpUrl(input, opts)
  const hostname = new URL(safe).hostname.replace(/^\[|\]$/g, "")
  await assertPublicHostResolves(hostname, { allowLoopback: opts.allowLoopback })
  return safe
}

/**
 * True only in local development when the operator has opted into treating
 * loopback as the NovaPulseAI UI (same flag the capture profile honours).
 */
export function isLoopbackIngestionAllowed(): boolean {
  if (process.env.NODE_ENV === "production") return false
  const v = (process.env.AD_TREAT_LOCALHOST_AS_NOVAPULSEAI ?? "")
    .trim()
    .toLowerCase()
  return v === "1" || v === "true" || v === "yes"
}
