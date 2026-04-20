import type { AdSiteIngestion } from "./types"

function normalizeUrlHost(siteUrl: string): string {
  const raw = String(siteUrl || "").trim()
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    return new URL(withProto).hostname.replace(/^www\./i, "").toLowerCase()
  } catch {
    return ""
  }
}

function envTruthy(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes"
}

/** True for common local dev origins only (not arbitrary hosts). */
export function isLoopbackCaptureHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  return h === "localhost" || h === "127.0.0.1" || h === "::1"
}

export type NovaPulseAICaptureProfileReason =
  | "hostname_novapulseai"
  | "env_loopback_local_dev"
  | "off"

export type NovaPulseAICaptureProfileResolution = {
  active: boolean
  reason: NovaPulseAICaptureProfileReason
  /** Normalized hostname for logs (localhost, 127.0.0.1, …). */
  host: string
}

/**
 * Whether the **capture** stack should use NovaPulseAI-tuned caps/governor/timeline (hostname + optional dev env).
 * Off by default for loopback unless `AD_TREAT_LOCALHOST_AS_NOVAPULSEAI` is set — avoids treating unrelated local apps as VF.
 */
export function resolveNovaPulseAICaptureProfile(siteUrl: string): NovaPulseAICaptureProfileResolution {
  const host = normalizeUrlHost(siteUrl)
  const loopback = isLoopbackCaptureHost(host)
  const envRaw = process.env.AD_TREAT_LOCALHOST_AS_NOVAPULSEAI
  const envOn = envTruthy(envRaw)

  let resolution: NovaPulseAICaptureProfileResolution
  if (host.includes("novapulseai")) {
    resolution = { active: true, reason: "hostname_novapulseai", host }
  } else if (envOn && loopback) {
    resolution = { active: true, reason: "env_loopback_local_dev", host }
  } else {
    resolution = { active: false, reason: "off", host }
  }

  console.log(
    "[VF DETECT]",
    JSON.stringify({
      siteUrl: siteUrl.slice(0, 160),
      host,
      isLoopback: loopback,
      envFlag: envRaw ?? null,
      active: resolution.active,
      reason: resolution.reason,
    })
  )

  return resolution
}

/** True when `resolveNovaPulseAICaptureProfile` is active (novapulseai.* host or env loopback dev). */
export function detectNovaPulseAISiteUrl(siteUrl: string): boolean {
  return resolveNovaPulseAICaptureProfile(siteUrl).active
}

/**
 * True when the ad is for the NovaPulseAI creator product (domain or on-page copy).
 * Used to specialize script, scenes, interactions, and scoring without widening scope for all sites.
 */
export function detectNovaPulseAIProduct(ingestion: AdSiteIngestion): boolean {
  const host = normalizeUrlHost(ingestion.siteUrl)
  const textBlob = [
    ingestion.brandName,
    ingestion.headline,
    ingestion.title,
    ingestion.subheadline,
    ingestion.description,
  ]
    .filter(Boolean)
    .join(" ")
  return host.includes("novapulseai") || /novapulseai/i.test(textBlob)
}

/** Optional per-job overrides (staff-only on HTTP); merged with AD_DEMO_* env. */
export type NovaPulseDemoCredentialOverrides = {
  email?: string | null
  password?: string | null
}

/**
 * Resolves demo credentials: explicit overrides first, then AD_DEMO_EMAIL / AD_DEMO_PASSWORD.
 * Used for NovaPulseAI capture login steps (never for arbitrary third-party sites without this contract).
 */
export function resolveNovaPulseDemoCredentials(
  overrides?: NovaPulseDemoCredentialOverrides
): { email: string; password: string } | null {
  const e = (overrides?.email ?? process.env.AD_DEMO_EMAIL ?? "").trim()
  const p = (overrides?.password ?? process.env.AD_DEMO_PASSWORD ?? "").trim()
  if (!e || !p) return null
  return { email: e, password: p }
}

export function novaPulseAIDemoLoginConfigured(
  overrides?: NovaPulseDemoCredentialOverrides
): boolean {
  return resolveNovaPulseDemoCredentials(overrides) !== null
}
