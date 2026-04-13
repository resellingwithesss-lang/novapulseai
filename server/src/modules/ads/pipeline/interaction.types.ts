/**
 * Interaction-driven product-demo capture: scripted browser sessions
 * with human-like pacing (used by website.capture interactive mode).
 */

/** Marketing beat — drives motion pacing, dwell, and capture emphasis. */
export type InteractiveSceneIntent = "attract" | "explain" | "prove" | "convert"

/** Where to emphasize framing during capture (digital zoom / crop). */
export type InteractiveFocalRegion = "hero" | "form" | "nav" | "result" | "cta"

export type ProductDemoSceneKind =
  | "homepage"
  /** Prefer /login over register; may submit when NovaPulseAI demo creds are configured */
  | "signin"
  | "signup"
  | "pricing"
  | "dashboard"
  | "tool_preview"
  | "feature_walkthrough"
  /** Payoff: outcome / tool output / dashboard value */
  | "result"
  /** NovaPulseAI: emphasize clip grid, thumbnails, batch/export in one segment */
  | "transformation_proof"
  | "generic"

export type AdInteractionStep =
  | { type: "visit"; url: string }
  | { type: "scroll"; amount: number }
  | { type: "hover"; label?: string; selector?: string }
  | { type: "move"; label?: string; selector?: string }
  | {
      type: "click"
      label?: string
      selector?: string
      /** If false, skips clicks that look like form submit (default safe). */
      allowSubmit?: boolean
    }
  | {
      type: "type"
      label?: string
      selector?: string
      value: string
      /** Resolved via semantic fallback chain when selector is omitted. */
      inputKind?: "email" | "password" | "text"
    }
  | { type: "wait"; ms: number }
  | { type: "waitForNavigation"; timeoutMs?: number }
  | { type: "waitForSelector"; selector: string; timeoutMs?: number }

export interface InteractiveAdScene {
  sceneType: ProductDemoSceneKind
  intent: InteractiveSceneIntent
  /** Path (e.g. /pricing) or full URL; capture navigates here at segment start. */
  pageHint: string
  /** Caption / beat label for logs and future overlays. */
  overlayText: string
  duration: number
  steps: AdInteractionStep[]
  /** Optional framing hint for cinematic crop / emphasis during capture. */
  focalRegion?: InteractiveFocalRegion
  /**
   * When length matches `steps`, each step starts no earlier than this offset (ms)
   * from segment record start — aligned to narration keywords, scaled to capture wall time.
   */
  stepStartOffsetsMs?: number[]
  /** Index in built ad scenes (optional). */
  builtSceneIndex?: number
}

export type InteractionTimingProfile = "cinematic" | "snappy"

export interface InteractionCaptureOptions {
  /** When false (default), never click final signup/login submit on external sites. */
  allowDestructiveSubmit?: boolean
  /** Multiplier on human delays (1 = default; >1 slower / more premium). */
  pacingMultiplier?: number
  timingProfile?: InteractionTimingProfile
  /** Current segment intent (merged from InteractiveAdScene during capture). */
  sceneIntent?: InteractiveSceneIntent
  focalRegion?: InteractiveFocalRegion
  /** Wall-clock pressure: tighter waits and selector caps (budget mode). */
  capturePressure?: "normal" | "degraded" | "severe"
  /** Shorter waitForSelector caps and waits — transformation / budget mode. */
  novaPulseAILeanCapture?: boolean
}
