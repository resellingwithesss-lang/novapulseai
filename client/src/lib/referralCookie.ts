const COOKIE = "np_ref"
const MAX_AGE_SEC = 30 * 24 * 60 * 60

export function normalizeReferralParam(raw: string | null): string | null {
  if (!raw) return null
  const t = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
  if (t.length < 4 || t.length > 32) return null
  return t
}

export function setReferralCookie(code: string) {
  if (typeof document === "undefined") return
  const n = normalizeReferralParam(code)
  if (!n) return
  document.cookie = `${COOKIE}=${encodeURIComponent(n)}; path=/; max-age=${MAX_AGE_SEC}; SameSite=Lax`
}

export function readReferralCookie(): string | null {
  if (typeof document === "undefined") return null
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]*)`))
  if (!m?.[1]) return null
  try {
    return normalizeReferralParam(decodeURIComponent(m[1]))
  } catch {
    return normalizeReferralParam(m[1])
  }
}

export function persistReferralFromSearchParams(searchParams: {
  get(name: string): string | null
}) {
  const ref = searchParams.get("ref")
  if (ref) setReferralCookie(ref)
}

export function referralCodeForAuth(
  searchParams: { get(name: string): string | null }
): string | undefined {
  const fromUrl = normalizeReferralParam(searchParams.get("ref"))
  const fromCookie = readReferralCookie()
  const code = fromUrl || fromCookie
  return code ?? undefined
}
