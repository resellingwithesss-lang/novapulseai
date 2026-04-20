import type { AdSiteIngestion, BuiltAdScene, AdSceneType } from "./types"
import type {
  AdInteractionStep,
  InteractiveAdScene,
  InteractiveFocalRegion,
  InteractiveSceneIntent,
  ProductDemoSceneKind,
} from "./interaction.types"
import { buildStepStartOffsetsMs } from "./interaction.storytiming"
import {
  detectNovaPulseAIProduct,
  resolveNovaPulseDemoCredentials,
  type NovaPulseDemoCredentialOverrides,
} from "./ad.product-profile"

function pathFromOptionalUrl(u: string | undefined): string | null {
  if (!u) return null
  try {
    const p = new URL(u).pathname
    return p && p !== "/" ? p : null
  } catch {
    return null
  }
}

/** Prefer real sign-in URLs for product demos (not register). */
function firstSignInPath(ingestion: AdSiteIngestion): string {
  const loginPath = pathFromOptionalUrl(ingestion.loginUrl)
  if (loginPath && /login|signin|sign-in/i.test(loginPath)) return loginPath

  const visualLogin = ingestion.visuals?.find(v => v.kind === "login")
  const visualPath = pathFromOptionalUrl(visualLogin?.url)
  if (visualPath && /login|signin|sign-in/i.test(visualPath)) return visualPath

  const tryPaths = ["/login", "/signin", "/sign-in"]
  return tryPaths[0]!
}

function firstExistingRegisterPath(ingestion: AdSiteIngestion): string {
  const loginPath = pathFromOptionalUrl(ingestion.loginUrl)
  if (loginPath && /register|signup|sign-up|join/i.test(loginPath)) return loginPath

  const visualLogin = ingestion.visuals?.find(v => v.kind === "login")
  const visualPath = pathFromOptionalUrl(visualLogin?.url)
  if (visualPath && /register|signup|sign-up|join|signin|login/i.test(visualPath)) {
    return visualPath
  }

  const fromCtas = (ingestion.ctaTexts || []).find(t =>
    /sign\s*up|register|get\s*started|create\s*(an\s*)?account|try\s*free/i.test(t)
  )
  if (fromCtas) return "/register"
  const tryPaths = ["/register", "/signup", "/sign-up", "/join", "/signin"]
  return tryPaths[0]!
}

function intentFromArc(t: AdSceneType): InteractiveSceneIntent {
  switch (t) {
    case "demo_auth":
      return "explain"
    case "hook":
    case "problem":
      return "attract"
    case "solution":
    case "feature":
      return "explain"
    case "transformation_proof":
    case "payoff":
      return "prove"
    case "cta":
      return "convert"
  }
}

function focalFor(arcType: AdSceneType, kind: ProductDemoSceneKind): InteractiveFocalRegion {
  if (arcType === "transformation_proof") return "result"
  if (kind === "signin" || kind === "signup") return "form"
  if (kind === "pricing") return "cta"
  if (kind === "result" || kind === "dashboard" || kind === "transformation_proof") return "result"
  if (kind === "tool_preview" || kind === "feature_walkthrough") return "result"
  if (arcType === "cta") return "cta"
  if (arcType === "hook" || arcType === "problem") return "hero"
  return "hero"
}

function mapSceneKind(adSceneType: AdSceneType, pagePath: string): ProductDemoSceneKind {
  const p = pagePath.toLowerCase()
  if (adSceneType === "demo_auth") return "signin"
  if (adSceneType === "transformation_proof") {
    if (p.includes("pricing")) return "pricing"
    if (p.includes("dashboard")) return "dashboard"
    if (p.includes("tool")) return "tool_preview"
    return "transformation_proof"
  }
  if (adSceneType === "payoff") {
    if (p.includes("pricing")) return "pricing"
    return "result"
  }

  if (p.includes("pricing")) return "pricing"
  if (p.includes("register") || p.includes("signup") || p.includes("sign-up")) return "signup"
  if (p.includes("login") || p.includes("signin")) return "signup"
  if (p.includes("dashboard")) return "dashboard"
  if (p.includes("tool")) return "tool_preview"
  if (adSceneType === "hook" || adSceneType === "problem") return "homepage"
  if (adSceneType === "solution" || adSceneType === "feature") return "feature_walkthrough"
  if (adSceneType === "cta") return p.includes("pricing") ? "pricing" : "signup"
  return "generic"
}

function ctaLabelHints(ingestion: AdSiteIngestion): string[] {
  const hints = [...(ingestion.ctaTexts || [])]
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 4)
  if (!hints.length) return ["get started", "start free", "try free", "sign up"]
  return hints
}

function pickFeatureHint(ingestion: AdSiteIngestion, fallback: string, novaPulseAI: boolean): string {
  if (novaPulseAI) {
    const pool = [
      ...ingestion.features,
      ...ingestion.valueProps,
      ...ingestion.headings,
      ingestion.headline || "",
    ]
      .filter(Boolean)
      .join(" ")
    if (/\bclips?\b/i.test(pool)) return "clip"
    if (/repurpose|repurpos/i.test(pool)) return "repurpose"
    if (/\bworkflow\b/i.test(pool)) return "workflow"
    if (/automat/i.test(pool)) return "automate"
    if (/export|publish|ready|post/i.test(pool)) return "export"
    return "create"
  }
  const raw =
    ingestion.features[0] ||
    ingestion.valueProps[0] ||
    ingestion.headings[0] ||
    ingestion.keyParagraphs[0] ||
    ""
  const cleaned = raw.trim()
  if (!cleaned) return fallback
  const word =
    cleaned.split(/\s+/).find(w => w.replace(/[^a-z0-9]/gi, "").length > 4) ||
    cleaned.split(/\s+/)[0] ||
    fallback
  return word.replace(/[^a-z0-9'-]/gi, "").slice(0, 20).toLowerCase() || fallback
}

/**
 * Build per-segment interaction steps from the structured ad arc + site ingestion.
 * Safe by default: no submit clicks unless caller sets allowDestructiveSubmit.
 */
export function buildInteractiveAdPlan(
  _siteUrl: string,
  ingestion: AdSiteIngestion,
  builtScenes: BuiltAdScene[],
  opts?: {
    allowDestructiveSubmit?: boolean
    allowNovaPulseAIDemoLoginSubmit?: boolean
    demoCredentialOverrides?: NovaPulseDemoCredentialOverrides
  }
): InteractiveAdScene[] {
  const allowSubmit = opts?.allowDestructiveSubmit === true
  const novaPulseAI = detectNovaPulseAIProduct(ingestion)
  const resolvedDemo = resolveNovaPulseDemoCredentials(opts?.demoCredentialOverrides)
  const npaiDemoCreds = Boolean(novaPulseAI && resolvedDemo)
  const demoEmail = resolvedDemo?.email ?? process.env.AD_DEMO_EMAIL ?? "demo@example.com"
  const demoPassword = resolvedDemo?.password ?? process.env.AD_DEMO_PASSWORD ?? "DemoPreview123!"
  const maySubmitSignin = allowSubmit || opts?.allowNovaPulseAIDemoLoginSubmit === true
  if (novaPulseAI && !npaiDemoCreds) {
    console.log(
      "[VF demo login]",
      JSON.stringify({
        status: "env_missing",
        message:
          "NovaPulseAI logged-in demo arc disabled: set AD_DEMO_EMAIL and AD_DEMO_PASSWORD (or pass staff-only demoLoginEmail/demoLoginPassword on the job) for capture sign-in + submit.",
      })
    )
  } else if (novaPulseAI && npaiDemoCreds && !maySubmitSignin) {
    console.log(
      "[VF demo login]",
      JSON.stringify({
        status: "submit_blocked",
        message: "Demo credentials present but submit not allowed (internal config).",
      })
    )
  }
  const hints = ctaLabelHints(ingestion)
  const primaryCta = hints[0] || "get started"
  const secondaryCta = hints[1] || hints[0] || "learn more"

  return builtScenes.map((scene, idx) => {
    const pagePath = scene.page?.startsWith("http") ? new URL(scene.page).pathname : scene.page || "/"
    const sceneType: ProductDemoSceneKind =
      scene.type === "demo_auth"
        ? "signin"
        : scene.type === "transformation_proof"
          ? "transformation_proof"
          : mapSceneKind(scene.type, pagePath)
    const vaguePath = !pagePath || pagePath === "/"
    const intent = intentFromArc(scene.type)
    const focalRegion = focalFor(scene.type, sceneType)

    let pageHint = pagePath
    if (scene.type === "demo_auth") {
      pageHint = firstSignInPath(ingestion)
    } else if (sceneType === "signup") {
      pageHint = novaPulseAI ? firstSignInPath(ingestion) : firstExistingRegisterPath(ingestion)
    } else if (vaguePath) {
      const pricing = pathFromOptionalUrl(ingestion.pricingUrl)
      const dash = pathFromOptionalUrl(ingestion.dashboardUrl)
      const tools = pathFromOptionalUrl(ingestion.toolsUrl)
      const featVisual = ingestion.visuals?.find(
        v => v.kind === "feature" || v.kind === "tools" || v.kind === "dashboard"
      )
      const featPath = pathFromOptionalUrl(featVisual?.url)

      if (sceneType === "pricing" && pricing) pageHint = pricing
      else if (sceneType === "dashboard" && dash) pageHint = dash
      else if ((sceneType === "tool_preview" || sceneType === "feature_walkthrough") && tools) {
        pageHint = tools
      } else if (sceneType === "result" || sceneType === "transformation_proof") {
        pageHint = dash || tools || featPath || "/"
      } else if (featPath && (sceneType === "feature_walkthrough" || sceneType === "generic")) {
        pageHint = featPath
      }
    }

    const steps: AdInteractionStep[] = []
    const featWord = pickFeatureHint(ingestion, primaryCta, novaPulseAI)

    switch (sceneType) {
      case "homepage": {
        if (scene.type === "problem") {
          steps.push({ type: "wait", ms: 420 })
          steps.push({ type: "scroll", amount: 380 })
          steps.push({ type: "wait", ms: 260 })
          steps.push({ type: "hover", label: featWord })
          steps.push({ type: "wait", ms: 280 })
          steps.push({ type: "scroll", amount: 340 })
          steps.push({ type: "move", label: secondaryCta })
        } else {
          steps.push({ type: "wait", ms: 480 })
          steps.push({ type: "scroll", amount: 300 })
          steps.push({ type: "wait", ms: 240 })
          if (novaPulseAI && npaiDemoCreds) {
            steps.push({ type: "hover", label: "sign" })
            steps.push({ type: "wait", ms: 260 })
            steps.push({ type: "move", label: "login" })
            steps.push({ type: "wait", ms: 320 })
          }
          steps.push({ type: "hover", label: primaryCta })
          steps.push({ type: "wait", ms: 360 })
          steps.push({ type: "move", label: primaryCta })
          steps.push({ type: "wait", ms: 280 })
          steps.push({ type: "scroll", amount: 260 })
        }
        break
      }

      case "signin": {
        const q = novaPulseAI ? 0.72 : 1
        steps.push({ type: "wait", ms: Math.round(520 * q) })
        steps.push({
          type: "waitForSelector",
          selector:
            "input[type='email'],input[name*='email' i],input[autocomplete='email'],input[type='password'],form",
          timeoutMs: 9000,
        })
        steps.push({ type: "scroll", amount: Math.round(140 * q) })
        steps.push({ type: "hover", label: "email" })
        steps.push({
          type: "type",
          inputKind: "email",
          value: demoEmail,
        })
        steps.push({ type: "wait", ms: Math.round(280 * q) })
        steps.push({ type: "hover", label: "password" })
        steps.push({
          type: "type",
          inputKind: "password",
          value: demoPassword,
        })
        steps.push({ type: "wait", ms: Math.round(420 * q) })
        steps.push({ type: "hover", label: "sign" })
        steps.push({ type: "wait", ms: Math.round(260 * q) })
        steps.push({ type: "wait", ms: maySubmitSignin && npaiDemoCreds ? Math.round(320 * q) : 520 })
        break
      }

      case "pricing": {
        steps.push({ type: "wait", ms: scene.type === "cta" ? 520 : 440 })
        steps.push({ type: "scroll", amount: 420 })
        steps.push({ type: "hover", label: "plan" })
        steps.push({ type: "wait", ms: 280 })
        steps.push({ type: "hover", label: "pricing" })
        steps.push({ type: "wait", ms: 220 })
        steps.push({ type: "scroll", amount: 280 })
        if (scene.type === "cta") {
          steps.push({ type: "move", label: "start" })
          steps.push({ type: "wait", ms: 420 })
          steps.push({ type: "hover", label: primaryCta })
        }
        break
      }

      case "signup": {
        const q = novaPulseAI ? 0.62 : 1
        steps.push({ type: "wait", ms: Math.round(480 * q) })
        steps.push({ type: "scroll", amount: Math.round(200 * q) })
        steps.push({ type: "hover", label: "email" })
        steps.push({
          type: "type",
          inputKind: "email",
          value: demoEmail,
        })
        steps.push({ type: "wait", ms: Math.round(240 * q) })
        steps.push({ type: "hover", label: "password" })
        steps.push({
          type: "type",
          inputKind: "password",
          value: demoPassword,
        })
        steps.push({ type: "wait", ms: Math.round(380 * q) })
        if (allowSubmit) {
          steps.push({ type: "click", selector: "button[type='submit']", allowSubmit: true })
          steps.push({ type: "waitForNavigation", timeoutMs: 10_000 })
        } else {
          steps.push({ type: "hover", label: "sign" })
          steps.push({ type: "wait", ms: 480 })
        }
        break
      }

      case "dashboard": {
        steps.push({ type: "wait", ms: novaPulseAI ? 460 : 520 })
        steps.push({ type: "scroll", amount: 320 })
        steps.push({ type: "waitForSelector", selector: "main,[role='main'],article", timeoutMs: 5000 })
        steps.push({ type: "hover", label: novaPulseAI ? "clip" : "workflow" })
        steps.push({ type: "wait", ms: 260 })
        if (novaPulseAI) {
          steps.push({ type: "hover", label: "workflow" })
          steps.push({ type: "wait", ms: 220 })
        }
        steps.push({ type: "scroll", amount: 280 })
        steps.push({ type: "move", label: primaryCta })
        break
      }

      case "transformation_proof": {
        const gridSelector =
          "main,[role='main'],article,[role='list'],[class*='grid'],[class*='gallery'],[class*='thumbnail'],[class*='card'],[class*='clip'],[class*='output'],[class*='batch'],[class*='variant'],[class*='preview']"
        /*1) Reveal — land shell, gentle scroll so multi-tile grid enters frame */
        steps.push({ type: "wait", ms: 480 })
        steps.push({
          type: "waitForSelector",
          selector: "main,[role='main'],article",
          timeoutMs: 7000,
        })
        steps.push({ type: "scroll", amount: 160 })
        steps.push({ type: "wait", ms: 560 })
        steps.push({ type: "scroll", amount: 240 })
        steps.push({ type: "wait", ms: 520 })
        steps.push({
          type: "waitForSelector",
          selector: gridSelector,
          timeoutMs: 9000,
        })
        steps.push({ type: "wait", ms: 640 })
        steps.push({ type: "scroll", amount: 300 })
        steps.push({ type: "wait", ms: 480 })
        steps.push({ type: "wait", ms: 820 })
        /* 2) Multiplication — many outputs visible at once */
        steps.push({ type: "scroll", amount: 220 })
        steps.push({ type: "wait", ms: 360 })
        steps.push({ type: "hover", label: "clip" })
        steps.push({ type: "wait", ms: 360 })
        steps.push({ type: "scroll", amount: 200 })
        steps.push({ type: "hover", label: "thumbnail" })
        steps.push({ type: "wait", ms: 380 })
        steps.push({ type: "hover", label: featWord })
        steps.push({ type: "wait", ms: 340 })
        steps.push({ type: "scroll", amount: 160 })
        steps.push({ type: "hover", label: "variant" })
        steps.push({ type: "wait", ms: 360 })
        steps.push({ type: "hover", label: "batch" })
        steps.push({ type: "wait", ms: 400 })
        steps.push({ type: "wait", ms: 840 })
        /* 3) Shipping — ready / export / download */
        steps.push({ type: "hover", label: "ready" })
        steps.push({ type: "wait", ms: 420 })
        steps.push({ type: "hover", label: "export" })
        steps.push({ type: "wait", ms: 480 })
        steps.push({ type: "hover", label: "download" })
        steps.push({ type: "wait", ms: 420 })
        steps.push({ type: "move", label: secondaryCta })
        steps.push({ type: "wait", ms: 520 })
        break
      }

      case "result": {
        steps.push({ type: "wait", ms: novaPulseAI ? 720 : 820 })
        steps.push({
          type: "waitForSelector",
          selector: "main,[role='main'],article,pre,code,[class*='output'],[class*='result']",
          timeoutMs: 7000,
        })
        steps.push({ type: "wait", ms: novaPulseAI ? 520 : 620 })
        if (novaPulseAI) {
          steps.push({ type: "hover", label: "clip" })
          steps.push({ type: "wait", ms: 480 })
        }
        steps.push({ type: "hover", label: featWord })
        steps.push({ type: "wait", ms: novaPulseAI ? 640 : 720 })
        steps.push({ type: "scroll", amount: 120 })
        steps.push({ type: "wait", ms: novaPulseAI ? 420 : 520 })
        steps.push({ type: "hover", label: "export" })
        steps.push({ type: "wait", ms: novaPulseAI ? 820 : 780 })
        if (novaPulseAI && scene.type === "payoff") {
          steps.push({ type: "scroll", amount: 100 })
          steps.push({ type: "wait", ms: 340 })
          steps.push({ type: "hover", label: "batch" })
          steps.push({ type: "wait", ms: 400 })
        }
        steps.push({ type: "move", label: secondaryCta })
        steps.push({ type: "wait", ms: novaPulseAI ? 960 : 900 })
        break
      }

      case "tool_preview":
      case "feature_walkthrough": {
        steps.push({ type: "wait", ms: novaPulseAI ? 380 : 460 })
        steps.push({ type: "scroll", amount: 300 })
        steps.push({ type: "hover", label: "create" })
        steps.push({ type: "wait", ms: 240 })
        if (novaPulseAI) {
          steps.push({ type: "hover", label: "clip" })
          steps.push({ type: "wait", ms: 200 })
        }
        steps.push({ type: "hover", label: featWord })
        steps.push({ type: "wait", ms: 260 })
        steps.push({ type: "scroll", amount: 260 })
        steps.push({ type: "move", label: primaryCta })
        steps.push({ type: "wait", ms: novaPulseAI ? 380 : 320 })
        steps.push({ type: "scroll", amount: 240 })
        break
      }

      default: {
        steps.push({ type: "wait", ms: 420 })
        steps.push({ type: "scroll", amount: 360 })
        steps.push({ type: "hover", label: featWord })
        steps.push({ type: "wait", ms: 260 })
        steps.push({ type: "move", label: primaryCta })
        break
      }
    }

    const stepStartOffsetsMs =
      steps.length > 0 && scene.type !== "demo_auth"
        ? buildStepStartOffsetsMs(steps, scene)
        : undefined

    return {
      sceneType,
      intent,
      focalRegion,
      pageHint,
      overlayText: scene.caption,
      duration: scene.duration,
      steps,
      stepStartOffsetsMs,
      builtSceneIndex: idx,
    }
  })
}
