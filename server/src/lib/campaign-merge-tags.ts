import { escapeHtml } from "./email-templates"

export type CampaignMergeRecipient = {
  email: string
  displayName: string | null
  plan: string
  credits: number
  subscriptionStatus: string
}

function firstName(displayName: string | null | undefined): string {
  const trimmed = (displayName || "").trim()
  if (!trimmed) return "there"
  return trimmed.split(/\s+/)[0] ?? "there"
}

/** Safe for HTML bodies — user-controlled fields are escaped. */
export function applyCampaignMergeTagsHtml(
  template: string,
  r: CampaignMergeRecipient,
  appUrl: string
): string {
  const pairs: Record<string, string> = {
    "{{name}}": escapeHtml(firstName(r.displayName)),
    "{{first_name}}": escapeHtml(firstName(r.displayName)),
    "{{display_name}}": escapeHtml(trimmedDisplay(r.displayName)),
    "{{email}}": escapeHtml(r.email),
    "{{plan}}": escapeHtml(r.plan),
    "{{credits}}": escapeHtml(String(Math.max(0, Math.floor(r.credits)))),
    "{{subscription_status}}": escapeHtml(r.subscriptionStatus),
    "{{app_url}}": escapeHtml(appUrl),
  }
  let out = template
  for (const [token, value] of Object.entries(pairs)) {
    out = out.split(token).join(value)
  }
  return out
}

/** Plain-text / subject lines — no HTML entities. */
export function applyCampaignMergeTagsPlain(
  template: string,
  r: CampaignMergeRecipient,
  appUrl: string
): string {
  const pairs: Record<string, string> = {
    "{{name}}": plainChunk(firstName(r.displayName)),
    "{{first_name}}": plainChunk(firstName(r.displayName)),
    "{{display_name}}": plainChunk(trimmedDisplay(r.displayName)),
    "{{email}}": plainChunk(r.email),
    "{{plan}}": plainChunk(r.plan),
    "{{credits}}": String(Math.max(0, Math.floor(r.credits))),
    "{{subscription_status}}": plainChunk(r.subscriptionStatus),
    "{{app_url}}": appUrl,
  }
  let out = template
  for (const [token, value] of Object.entries(pairs)) {
    out = out.split(token).join(value)
  }
  return out
}

function trimmedDisplay(displayName: string | null | undefined): string {
  const t = (displayName || "").trim()
  return t || "there"
}

function plainChunk(s: string): string {
  return s.replace(/[\r\n\u0000]/g, " ").slice(0, 500)
}
