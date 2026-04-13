/**
 * NovaPulseAI-only post-capture quality gate: rejects weak mixes (login/pricing/public filler)
 * before cinematic stitch / final render.
 */

import type { AdSceneType } from "./types"

/** Emitted on CaptureResult for NovaPulseAI profile captures. */
export type NovaPulseAICaptureDiagnostics = {
  captureMode: "interactive" | "timeline"
  framesByKind: Record<string, number>
  totalFrames: number
  demoLoginConfigured: boolean
  demoLoginAttempted: boolean
  demoLoginSucceeded: boolean
  /** Tools/dashboard navigation succeeded after session verification (required for logged_in). */
  postLoginAppReached?: boolean
  /** Share of captured frames that are strictly after successful in-app handoff. */
  postLoginFrameShare?: number
  maxTransformationTiles: number
  postLoginDistinctRoutes: number
  fallbackFromInteractive: boolean
}

export type NovaPulseAIQualityGateResult =
  | {
      ok: true
      flowMode: "logged_in" | "public_fallback"
      shares: NovaPulseAIFrameShares }
  | {
      ok: false
      reason: string
      flowMode: "logged_in" | "public_fallback"
      shares: NovaPulseAIFrameShares
      details: Record<string, unknown>
    }

export type NovaPulseAIFrameShares = {
  total: number
  loginShare: number
  pricingShare: number
  productSurfaceShare: number
  transformationShare: number
  marketingSurfaceShare: number
  paddingShare: number
}

const LOGIN_KINDS = ["signin", "timeline_login"] as const
const PRICING_KINDS = ["pricing", "timeline_pricing"] as const
const PRODUCT_KINDS = [
  "dashboard",
  "tool_preview",
  "feature_walkthrough",
  "result",
  "transformation_proof",
  "timeline_product",
] as const
const TRANSFORM_KINDS = ["transformation_proof"] as const
/** Hero + undifferentiated beats that often read as “marketing page” filler. */
const MARKETING_KINDS = [
  "homepage",
  "signup",
  "generic",
  "timeline_hero",
  "timeline_other",
] as const
const PADDING_KINDS = ["padding"] as const

function sumKinds(frames: Record<string, number>, kinds: readonly string[]): number {
  let n = 0
  for (const k of kinds) n += frames[k] ?? 0
  return n
}

export function aggregateNovaPulseAIFrameShares(
  framesByKind: Record<string, number>
): NovaPulseAIFrameShares {
  const total = Math.max(
    1,
    Object.values(framesByKind).reduce((a, b) => a + b, 0)
  )
  const login = sumKinds(framesByKind, LOGIN_KINDS)
  const pricing = sumKinds(framesByKind, PRICING_KINDS)
  const productSurface = sumKinds(framesByKind, PRODUCT_KINDS)
  const transformation = sumKinds(framesByKind, TRANSFORM_KINDS)
  const marketingSurface = sumKinds(framesByKind, MARKETING_KINDS)
  const padding = sumKinds(framesByKind, PADDING_KINDS)
  return {
    total,
    loginShare: login / total,
    pricingShare: pricing / total,
    productSurfaceShare: productSurface / total,
    transformationShare: transformation / total,
    marketingSurfaceShare: marketingSurface / total,
    paddingShare: padding / total,
  }
}

/** Thresholds tuned so login/pricing cannot dominate; proof + in-app must carry the ad. */
const MAX_LOGIN_SHARE_LOGGED_IN = 0.17
const MAX_LOGIN_SHARE_PUBLIC = 0.14
const MAX_PRICING_SHARE_LOGGED_IN = 0.15
const MAX_PRICING_SHARE_PUBLIC = 0.12
const MIN_PRODUCT_SURFACE_LOGGED_IN = 0.4
const MIN_PRODUCT_SURFACE_PUBLIC = 0.34
const MIN_TRANSFORM_SHARE_LOGGED_IN = 0.12
const MIN_TRANSFORM_SHARE_PUBLIC = 0.08
const MAX_MARKETING_SURFACE_PUBLIC = 0.52
const MAX_PADDING_SHARE = 0.38
const MIN_TILES_WHEN_TRANSFORM_PRESENT_LOGGED_IN = 4
const MIN_TILES_WHEN_TRANSFORM_PRESENT_PUBLIC = 3
const MIN_POST_LOGIN_ROUTES_LOGGED_IN = 2
/** Most of the recording must be in-app once login is the chosen path. */
const MIN_POST_LOGIN_FRAME_SHARE_LOGGED_IN = 0.5
const MIN_TOOLS_WORKFLOW_SHARE_LOGGED_IN = 0.09
const MIN_RESULTS_PROOF_SHARE_LOGGED_IN = 0.14

const TOOLS_WORKFLOW_KINDS = ["tool_preview", "feature_walkthrough"] as const
const RESULTS_PROOF_KINDS = ["result", "transformation_proof"] as const

/** Extra runtime breakdown for logs / cinematic metadata (percent of captured frames). */
export function novaPulseAICaptureSupplementalRuntimePct(d: NovaPulseAICaptureDiagnostics): {
  toolsWorkflowPct: number
  resultsProofPct: number
  postLoginFramePct: number
} {
  const total = Math.max(
    1,
    Object.values(d.framesByKind).reduce((a, b) => a + b, 0)
  )
  const tw = sumKinds(d.framesByKind, TOOLS_WORKFLOW_KINDS) / total
  const rp = sumKinds(d.framesByKind, RESULTS_PROOF_KINDS) / total
  return {
    toolsWorkflowPct: Math.round(tw * 1000) / 10,
    resultsProofPct: Math.round(rp * 1000) / 10,
    postLoginFramePct:
      d.postLoginFrameShare != null
        ? Math.round(d.postLoginFrameShare * 1000) / 10
        : 0,
  }
}

function fail(
  reason: string,
  flowMode: "logged_in" | "public_fallback",
  shares: NovaPulseAIFrameShares,
  details: Record<string, unknown>
): NovaPulseAIQualityGateResult {
  return { ok: false, reason, flowMode, shares, details }
}

export function validateNovaPulseAICaptureQuality(
  d: NovaPulseAICaptureDiagnostics
): NovaPulseAIQualityGateResult {
  const shares = aggregateNovaPulseAIFrameShares(d.framesByKind)

  const flowMode: "logged_in" | "public_fallback" =
    d.demoLoginConfigured && d.demoLoginAttempted && d.demoLoginSucceeded
      ? "logged_in"
      : "public_fallback"

  const baseDetails: Record<string, unknown> = {
    captureMode: d.captureMode,
    flowMode,
    demoLoginConfigured: d.demoLoginConfigured,
    demoLoginAttempted: d.demoLoginAttempted,
    demoLoginSucceeded: d.demoLoginSucceeded,
    fallbackFromInteractive: d.fallbackFromInteractive,
    postLoginDistinctRoutes: d.postLoginDistinctRoutes,
    post_login_app_reached: d.postLoginAppReached ?? null,
    post_login_frame_pct:
      d.postLoginFrameShare != null
        ? Math.round(d.postLoginFrameShare * 1000) / 10
        : null,
    maxTransformationTiles: d.maxTransformationTiles,
    shares: {
      login_pct: Math.round(shares.loginShare * 1000) / 10,
      pricing_pct: Math.round(shares.pricingShare * 1000) / 10,
      product_surface_pct: Math.round(shares.productSurfaceShare * 1000) / 10,
      transformation_pct: Math.round(shares.transformationShare * 1000) / 10,
      marketing_surface_pct: Math.round(shares.marketingSurfaceShare * 1000) / 10,
      padding_pct: Math.round(shares.paddingShare * 1000) / 10,
    },
  }

  /** Route-based fallback capture has no `transformation_proof` segment — gate on product routes + hero cap. */
  if (d.captureMode === "timeline") {
    const loginCap =
      flowMode === "logged_in" ? MAX_LOGIN_SHARE_LOGGED_IN : MAX_LOGIN_SHARE_PUBLIC
    const priceCap =
      flowMode === "logged_in" ? MAX_PRICING_SHARE_LOGGED_IN : MAX_PRICING_SHARE_PUBLIC
    const prodMin = flowMode === "logged_in" ? 0.38 : 0.35
    const heroOnly =
      (d.framesByKind.timeline_hero ?? 0) / Math.max(1, shares.total)

    if (shares.paddingShare > MAX_PADDING_SHARE) {
      return fail(
        "too_much_padding_incomplete_capture",
        flowMode,
        shares,
        { ...baseDetails, rule: "padding_share_cap", max_padding_share: MAX_PADDING_SHARE }
      )
    }
    if (shares.loginShare > loginCap + 1e-4) {
      return fail("login_scene_dominates", flowMode, shares, {
        ...baseDetails,
        rule: "max_login_runtime_share",
        cap: loginCap,
      })
    }
    if (shares.pricingShare > priceCap + 1e-4) {
      return fail("pricing_scene_dominates", flowMode, shares, {
        ...baseDetails,
        rule: "max_pricing_runtime_share",
        cap: priceCap,
      })
    }
    if (flowMode === "public_fallback" && shares.marketingSurfaceShare > MAX_MARKETING_SURFACE_PUBLIC) {
      return fail("public_marketing_pages_dominate", "public_fallback", shares, {
        ...baseDetails,
        rule: "max_marketing_surface_share",
        cap: MAX_MARKETING_SURFACE_PUBLIC,
      })
    }
    if (shares.productSurfaceShare + 1e-4 < prodMin) {
      return fail("timeline_weak_product_surface", flowMode, shares, {
        ...baseDetails,
        rule: "min_timeline_product_surface_share",
        min: prodMin,
      })
    }
    if (heroOnly > 0.44) {
      return fail("timeline_hero_dominates", flowMode, shares, {
        ...baseDetails,
        rule: "max_timeline_hero_share",
        cap: 0.44,
        hero_share: heroOnly,
      })
    }
    if (flowMode === "logged_in" && d.postLoginDistinctRoutes < MIN_POST_LOGIN_ROUTES_LOGGED_IN) {
      return fail("logged_in_but_insufficient_in_app_routes", "logged_in", shares, {
        ...baseDetails,
        rule: "min_post_login_distinct_routes",
        min: MIN_POST_LOGIN_ROUTES_LOGGED_IN,
      })
    }
    if (flowMode === "logged_in") {
      if (d.postLoginAppReached !== true) {
        return fail("logged_in_without_post_login_app_navigation", "logged_in", shares, {
          ...baseDetails,
          rule: "post_login_tools_nav_required",
        })
      }
      const plShare = d.postLoginFrameShare ?? 0
      if (plShare + 1e-4 < MIN_POST_LOGIN_FRAME_SHARE_LOGGED_IN) {
        return fail("insufficient_runtime_after_login", "logged_in", shares, {
          ...baseDetails,
          rule: "min_post_login_frame_share",
          min: MIN_POST_LOGIN_FRAME_SHARE_LOGGED_IN,
          observed: plShare,
        })
      }
      const tlProd =
        (d.framesByKind.timeline_product ?? 0) / Math.max(1, shares.total)
      if (tlProd + 1e-4 < 0.26) {
        return fail("timeline_weak_in_app_product_after_login", "logged_in", shares, {
          ...baseDetails,
          rule: "min_timeline_product_share_logged_in",
          min: 0.26,
          observed: tlProd,
        })
      }
    }
    if (d.demoLoginConfigured && d.demoLoginAttempted && !d.demoLoginSucceeded) {
      if (shares.loginShare > MAX_LOGIN_SHARE_PUBLIC + 0.04) {
        return fail(
          "demo_login_failed_login_footage_dominates",
          "public_fallback",
          shares,
          {
            ...baseDetails,
            rule: "after_failed_demo_login_login_must_not_dominate",
            max_login_share: MAX_LOGIN_SHARE_PUBLIC + 0.04,
          }
        )
      }
    }
    return { ok: true, flowMode, shares }
  }

  if (d.demoLoginConfigured && d.demoLoginAttempted && !d.demoLoginSucceeded) {
    if (shares.loginShare > MAX_LOGIN_SHARE_PUBLIC + 0.04) {
      return fail(
        "demo_login_failed_login_footage_dominates",
        "public_fallback",
        shares,
        {
          ...baseDetails,
          rule: "after_failed_demo_login_login_must_not_dominate",
          max_login_share: MAX_LOGIN_SHARE_PUBLIC + 0.04,
        }
      )
    }
  }

  if (shares.paddingShare > MAX_PADDING_SHARE) {
    return fail(
      "too_much_padding_incomplete_capture",
      flowMode,
      shares,
      { ...baseDetails, rule: "padding_share_cap", max_padding_share: MAX_PADDING_SHARE }
    )
  }

  const loginCap =
    flowMode === "logged_in" ? MAX_LOGIN_SHARE_LOGGED_IN : MAX_LOGIN_SHARE_PUBLIC
  if (shares.loginShare > loginCap + 1e-4) {
    return fail("login_scene_dominates", flowMode, shares, {
      ...baseDetails,
      rule: "max_login_runtime_share",
      cap: loginCap,
    })
  }

  const priceCap =
    flowMode === "logged_in" ? MAX_PRICING_SHARE_LOGGED_IN : MAX_PRICING_SHARE_PUBLIC
  if (shares.pricingShare > priceCap + 1e-4) {
    return fail("pricing_scene_dominates", flowMode, shares, {
      ...baseDetails,
      rule: "max_pricing_runtime_share",
      cap: priceCap,
    })
  }

  if (flowMode === "public_fallback" && shares.marketingSurfaceShare > MAX_MARKETING_SURFACE_PUBLIC) {
    return fail("public_marketing_pages_dominate", "public_fallback", shares, {
      ...baseDetails,
      rule: "max_marketing_surface_share",
      cap: MAX_MARKETING_SURFACE_PUBLIC,
    })
  }

  const productMin =
    flowMode === "logged_in" ? MIN_PRODUCT_SURFACE_LOGGED_IN : MIN_PRODUCT_SURFACE_PUBLIC
  if (shares.productSurfaceShare + 1e-4 < productMin) {
    return fail("insufficient_tools_results_or_proof_surface", flowMode, shares, {
      ...baseDetails,
      rule: "min_product_surface_share",
      min: productMin,
    })
  }

  const xfMin =
    flowMode === "logged_in" ? MIN_TRANSFORM_SHARE_LOGGED_IN : MIN_TRANSFORM_SHARE_PUBLIC
  if (shares.transformationShare + 1e-4 < xfMin) {
    return fail("transformation_proof_too_thin", flowMode, shares, {
      ...baseDetails,
      rule: "min_transformation_share",
      min: xfMin,
    })
  }

  const xfFrames = sumKinds(d.framesByKind, TRANSFORM_KINDS)
  const minTiles =
    flowMode === "logged_in"
      ? MIN_TILES_WHEN_TRANSFORM_PRESENT_LOGGED_IN
      : MIN_TILES_WHEN_TRANSFORM_PRESENT_PUBLIC
  if (xfFrames > 12 && d.maxTransformationTiles + 1e-4 < minTiles) {
    return fail("transformation_proof_low_output_density", flowMode, shares, {
      ...baseDetails,
      rule: "min_visible_tiles_when_transformation_segment_present",
      minTiles,
      xfFrames,
    })
  }

  if (flowMode === "logged_in" && d.postLoginDistinctRoutes < MIN_POST_LOGIN_ROUTES_LOGGED_IN) {
    return fail("logged_in_but_insufficient_in_app_routes", "logged_in", shares, {
      ...baseDetails,
      rule: "min_post_login_distinct_routes",
      min: MIN_POST_LOGIN_ROUTES_LOGGED_IN,
    })
  }

  if (flowMode === "logged_in") {
    if (d.postLoginAppReached !== true) {
      return fail("logged_in_without_post_login_app_navigation", "logged_in", shares, {
        ...baseDetails,
        rule: "post_login_tools_nav_required",
      })
    }
    const plShare = d.postLoginFrameShare ?? 0
    if (plShare + 1e-4 < MIN_POST_LOGIN_FRAME_SHARE_LOGGED_IN) {
      return fail("insufficient_runtime_after_login", "logged_in", shares, {
        ...baseDetails,
        rule: "min_post_login_frame_share",
        min: MIN_POST_LOGIN_FRAME_SHARE_LOGGED_IN,
        observed: plShare,
      })
    }
    const twShare = sumKinds(d.framesByKind, TOOLS_WORKFLOW_KINDS) / shares.total
    if (twShare + 1e-4 < MIN_TOOLS_WORKFLOW_SHARE_LOGGED_IN) {
      return fail("insufficient_tools_workflow_surface_logged_in", "logged_in", shares, {
        ...baseDetails,
        rule: "min_tools_workflow_share",
        min: MIN_TOOLS_WORKFLOW_SHARE_LOGGED_IN,
        observed: twShare,
      })
    }
    const rpShare = sumKinds(d.framesByKind, RESULTS_PROOF_KINDS) / shares.total
    if (rpShare + 1e-4 < MIN_RESULTS_PROOF_SHARE_LOGGED_IN) {
      return fail("insufficient_results_or_proof_logged_in", "logged_in", shares, {
        ...baseDetails,
        rule: "min_results_proof_share",
        min: MIN_RESULTS_PROOF_SHARE_LOGGED_IN,
        observed: rpShare,
      })
    }
  }

  return { ok: true, flowMode, shares }
}

/**
 * Optional: reject obviously weak *planned* stitch weights for VF public fallback * (script still contains demo_auth even when capture is public).
 */
export function validateNovaPulseAIPlannedSceneMix(
  sceneTypes: AdSceneType[] | undefined,
  sceneDurations: number[] | undefined,
  flowMode: "logged_in" | "public_fallback"
): { ok: true } | { ok: false; reason: string; details: Record<string, unknown> } {
  if (!sceneTypes?.length || !sceneDurations?.length) return { ok: true }
  if (sceneTypes.length !== sceneDurations.length) return { ok: true }

  const total = sceneDurations.reduce((a, b) => a + Math.max(0, Number(b) || 0), 0) || 1
  let auth = 0
  let pricingLike = 0
  let proof = 0
  for (let i = 0; i < sceneTypes.length; i++) {
    const t = sceneTypes[i]!
    const dur = Math.max(0, Number(sceneDurations[i]) || 0)
    if (t === "demo_auth") auth += dur
    if (t === "cta") pricingLike += dur
    if (t === "transformation_proof" || t === "payoff") proof += dur
  }

  if (flowMode === "public_fallback") {
    if (auth / total > 0.13) {
      return {
        ok: false,
        reason: "planned_demo_auth_overweighted_for_public_fallback",
        details: { auth_share: auth / total, cap: 0.13 },
      }
    }
    if (pricingLike / total > 0.2) {
      return {
        ok: false,
        reason: "planned_cta_pricing_overweighted_for_public_fallback",
        details: { cta_share: pricingLike / total, cap: 0.2 },
      }
    }
    if (proof / total + 1e-4 < 0.22) {
      return {
        ok: false,
        reason: "planned_proof_beats_too_thin_for_public_fallback",
        details: { proof_share: proof / total, min: 0.22 },
      }
    }
  } else {
    if (auth / total > 0.14) {
      return {
        ok: false,
        reason: "planned_demo_auth_overweighted_even_when_logged_in",
        details: { auth_share: auth / total, cap: 0.14 },
      }
    }
  }

  return { ok: true }
}

/** Reject fragment-reel stitches: too short, too many scenes, or many micro-trims (normal VF only). */
export function validateNovaPulseAIStitchContinuity(
  scenes: { duration: number; kind: AdSceneType; variant: number }[],
  outputDurationSec: number,
  opts: { fastPreview: boolean; novaPulseAINormal: boolean }
): { ok: true } | { ok: false; reason: string; details: Record<string, unknown> } {
  if (!opts.novaPulseAINormal || opts.fastPreview) return { ok: true }
  if (outputDurationSec + 1e-3 < 15) {
    return {
      ok: false,
      reason: "vf_final_stitch_duration_below_15s",
      details: { outputDurationSec, minSec: 15 },
    }
  }
  const primary = scenes.filter(s => s.variant === 0)
  if (primary.length > 8) {
    return {
      ok: false,
      reason: "vf_too_many_primary_scenes_fragmented",
      details: { primarySceneCount: primary.length, max: 8 },
    }
  }
  const tiny = primary.filter(
    s => s.duration < 1.22 && s.kind !== "hook" && s.kind !== "demo_auth"
  )
  if (tiny.length >= 4) {
    return {
      ok: false,
      reason: "vf_too_many_micro_beats",
      details: { microBeatCount: tiny.length, max: 3 },
    }
  }
  const meat = primary.filter(s =>
    ["feature", "solution", "payoff", "transformation_proof", "problem"].includes(s.kind)
  )
  if (meat.length >= 2) {
    const avg = meat.reduce((a, s) => a + s.duration, 0) / meat.length
    if (avg < 1.52) {
      return {
        ok: false,
        reason: "vf_primary_beats_too_short_avg",
        details: { avgSec: avg, minAvgSec: 1.52 },
      }
    }
  }
  return { ok: true }
}
