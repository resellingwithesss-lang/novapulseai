/**
 * User-facing copy for AI Ad Generator — never expose operator/debug strings.
 */

export function stripInternalAdsIds(message: string): string {
  return message
    .replace(/\bJob ID:\s*[\w-]+/gi, "")
    .replace(/\bRequest ID:\s*[\w-]+/gi, "")
    .replace(/\(\s*Job ID:\s*[\w-]+\s*\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

export function mapAdsErrorForUser(raw: string | null | undefined): {
  headline: string
  body: string
} | null {
  if (!raw?.trim()) return null
  const lower = raw.toLowerCase()

  let headline = "We couldn't generate your ad this time"
  let body =
    "Try a different product page, a shorter length, or another style. Your credits are only used when a run completes successfully."

  if (lower.includes("check server logs") || lower.includes("server logs")) {
    body =
      "Something went wrong on our side. Please try again in a few minutes, or use another landing page."
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    headline = "That took too long"
    body =
      "Try a shorter video length or a simpler page. Heavy sites sometimes need a second attempt."
  }
  if (
    lower.includes("ffmpeg") ||
    lower.includes("encode") ||
    lower.includes("render") ||
    lower.includes("cinematic stitch")
  ) {
    headline = "We couldn't finish the video"
    body = "Try again, or pick a different style. If it persists, use a shorter duration."
  }
  if (
    lower.includes("capture") ||
    lower.includes("puppeteer") ||
    lower.includes("browser") ||
    lower.includes("website capture")
  ) {
    headline = "We couldn't read that page"
    body =
      "Some sites block automated visits. Try your main marketing URL, or a simpler public landing page."
  }
  if (
    (lower.includes("script") && (lower.includes("fail") || lower.includes("llm"))) ||
    lower.includes("ai script generation failed")
  ) {
    headline = "We couldn't write the ad"
    body =
      "Use a page with a clear headline and offer. Then generate again — no filming needed on your side."
  }
  if (lower.includes("expired") || lower.includes("no longer recoverable")) {
    headline = "This run expired"
    body = "Start a fresh generation from your product URL whenever you're ready."
  }
  if (lower.includes("cancel")) {
    headline = "Generation was stopped"
    body = "Tap Generate when you want to try again."
  }
  if (lower.includes("not found") && lower.includes("job")) {
    headline = "We lost track of that ad"
    body = "Start a new generation from your product URL."
  }
  if (lower.includes("forbidden") || lower.includes("elite") || lower.includes("plan limit")) {
    headline = "Upgrade to keep going"
    body = "AI Ad Generator is part of Elite. You can compare plans anytime."
  }
  if (lower.includes("invalid url") || lower.includes("invalid request")) {
    headline = "Check your link"
    body = "Enter a full URL starting with https://"
  }
  if (
    lower.includes("unable to retrieve") ||
    lower.includes("retrieve job state") ||
    lower.includes("could not load job") ||
    lower.includes("failed to load job") ||
    lower.includes("failed to load")
  ) {
    headline = "We couldn't load that run"
    body = "Start a fresh generation — your last request may have finished or timed out."
  }
  if (lower.includes("polling failed")) {
    headline = "We lost connection briefly"
    body = "Check your network and try generating again. Nothing is billed until a run completes."
  }
  if (lower.includes("no output url") || lower.includes("no output")) {
    headline = "We couldn't prepare the video file"
    body = "Try again with a shorter length or another style."
  }
  if (lower.includes("fast preview") || lower.includes("operator accounts")) {
    headline = "That option isn't available on your account"
    body = "Use standard generation, or open the team console if you have access."
  }

  return { headline, body }
}

export function formatAdsErrorForUserDisplay(raw: string | null | undefined): string | null {
  const mapped = mapAdsErrorForUser(raw)
  if (mapped) return `${mapped.headline}\n${mapped.body}`
  if (!raw?.trim()) return null
  return stripInternalAdsIds(raw)
}
