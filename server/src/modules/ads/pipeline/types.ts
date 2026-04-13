/**
 * Shared types for the ad generation pipeline:
 * ingestion → structured script → timed scenes → capture/render.
 */

export type AdSceneType =
  | "hook"
  /** NovaPulseAI: explicit sign-in to demo account (AD_DEMO_EMAIL / AD_DEMO_PASSWORD) before in-app beats */
  | "demo_auth"
  | "problem"
  | "solution"
  /** NovaPulseAI: one input → multiple outputs / grid / batch proof beat */
  | "transformation_proof"
  | "feature"
  | "payoff"
  | "cta"

export type SceneTransition = "fade" | "crossfade" | "zoom"

export type VisualKind = "site_capture" | "ui_mockup" | "gradient_fallback"

export interface SiteVisualAsset {
  url: string
  screenshotPath: string
  kind: "hero" | "pricing" | "feature" | "login" | "tools" | "dashboard" | "other"
}

/** Normalized output from website ingestion (URL → structured facts + captures). */
export interface AdSiteIngestion {
  siteUrl: string
  brandName?: string
  title?: string
  headline?: string
  subheadline?: string
  description?: string
  headings: string[]
  keyParagraphs: string[]
  valueProps: string[]
  features: string[]
  /** Heuristic read of voice (LLM refines in script). */
  tone: string
  visuals: SiteVisualAsset[]
  primaryColorHex?: string
  secondaryColorHex?: string
  accentColorHex?: string
  pricingUrl?: string
  loginUrl?: string
  toolsUrl?: string
  dashboardUrl?: string
  capturedAt?: number
  /** CTA button labels from crawl — used to target hovers/clicks. */
  ctaTexts?: string[]
}

/** Marketing arc produced by the LLM (not raw VO — scene builder splits timing). */
export interface StructuredAdScript {
  hook: string
  problem: string
  solution: string
  features: string[]
  payoff: string
  cta: string
}

/** One timed beat for capture, VO, and captions. */
export interface BuiltAdScene {
  type: AdSceneType
  /** Voiceover line for this beat. */
  text: string
  /** On-screen caption (short). */
  caption: string
  /** 2–4 punchy caption lines for this beat (TikTok-style); overrides single `caption` in final render timing. */
  captionBeats?: string[]
  /** Human-readable visual intent (logging / future asset selection). */
  visual: string
  visualKind: VisualKind
  duration: number
  transition: SceneTransition
  /** Hint for website capture route (path or full URL). */
  page?: string
}
