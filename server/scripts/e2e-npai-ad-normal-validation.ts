/**
 * One-shot NovaPulseAI ad pipeline check (normal mode): analyze → scenes → interactive plan
 * → buildCinematicAssets (capture + VF quality gate + stitch + 15s probe rules).
 *
 * Run from server/: npx ts-node scripts/e2e-npai-ad-normal-validation.ts
 *
 * Env:
 *   NPAI_E2E_URL          default https://novapulseai.ai
 *   NPAI_E2E_DURATION     default 24
 *   NPAI_E2E_FAST_PREVIEW true = skip VF capture gate + shorter stitch rules
 *   AD_DEMO_EMAIL / AD_DEMO_PASSWORD for logged-in path
 */
import "dotenv/config"
import { spawn } from "child_process"
import { analyzeWebsite, analysisToSiteIngestion } from "../src/modules/ads/website.analyzer"
import { buildAdScenes, applyNovaPulseAIQualityPass } from "../src/modules/ads/pipeline/scene.builder"
import { buildInteractiveAdPlan } from "../src/modules/ads/pipeline/interaction.plan"
import { buildCinematicAssets } from "../src/modules/ads/rendering/cinematic.pipeline"
import {
  detectNovaPulseAIProduct,
  novaPulseAIDemoLoginConfigured,
} from "../src/modules/ads/pipeline/ad.product-profile"
import type { StructuredAdScript } from "../src/modules/ads/pipeline/types"

function ffprobeDuration(file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ])
    let out = ""
    p.stdout.on("data", d => {
      out += d.toString()
    })
    p.on("close", () => resolve(Number(out.trim()) || 0))
    p.on("error", reject)
  })
}

async function main() {
  const siteUrl = process.env.NPAI_E2E_URL || "https://novapulseai.ai"
  const fastPreview = process.env.NPAI_E2E_FAST_PREVIEW === "true"
  const duration = Number(process.env.NPAI_E2E_DURATION || "24")
  const requestId = "e2e-npai-validation"
  const jobDbId = "e2e-npai-local"

  const demoConfigured = novaPulseAIDemoLoginConfigured()
  console.log(
    "[e2e-npai] start",
    JSON.stringify({
      siteUrl,
      fastPreview,
      duration,
      demoLoginConfigured: demoConfigured,
      ts: new Date().toISOString(),
    })
  )

  const analysis = await analyzeWebsite(siteUrl)
  const ingestion = analysisToSiteIngestion(analysis)
  const npaiProduct = detectNovaPulseAIProduct(ingestion)
  if (!npaiProduct) {
    console.warn("[e2e-npai] warn: detectNovaPulseAIProduct=false — gates may not match production VF jobs")
  }

  const structured: StructuredAdScript = {
    hook: "One video becomes ten clips with NovaPulseAI.",
    problem: "Posting consistently burns hours of editing.",
    solution: "Automate repurposing and batch-ready clips in one workflow.",
    features: [
      "Workflow builds publish-ready variants fast.",
      "Grid of outputs proves one input becomes many clips.",
    ],
    payoff: "Ship more posts without living in the editor.",
    cta: "Start free at novapulseai.ai.",
  }

  let built = buildAdScenes(structured, ingestion, duration, {
    creatorProductDemo: true,
    pacing: "standard",
  })
  if (npaiProduct) {
    built = applyNovaPulseAIQualityPass(built, duration, ingestion)
  }

  const interactivePlan =
    built.length > 0
      ? buildInteractiveAdPlan(siteUrl, ingestion, built, {
          allowDestructiveSubmit: process.env.AD_ALLOW_DESTRUCTIVE_SUBMIT === "true",
          allowNovaPulseAIDemoLoginSubmit: npaiProduct && demoConfigured,
        })
      : undefined

  const vfDemoJob = npaiProduct && demoConfigured
  const renderDuration =
    npaiProduct && !fastPreview
      ? Math.max(15, Math.min(40, vfDemoJob ? Math.max(20, duration) : Math.max(18, duration)))
      : duration

  const cinematic = await buildCinematicAssets(siteUrl, renderDuration, "youtube", {
    sceneDurations: built.map(s => s.duration),
    sceneTypes: built.map(s => s.type),
    interactivePlan,
    interaction: { timingProfile: "cinematic", pacingMultiplier: 1.08 },
    fastPreview,
    vfSiteIngestion: vfDemoJob ? ingestion : undefined,
    novaPulseAIProductAd: npaiProduct,
    logCtx: { requestId, jobDbId },
  })

  const probed = await ffprobeDuration(cinematic.finalVideo)

  console.log(
    "[e2e-npai] done",
    JSON.stringify(
      {
        finalVideo: cinematic.finalVideo,
        metadata: cinematic.metadata,
        probedStitchSec: Math.round(probed * 1000) / 1000,
        npaiProduct,
        fastPreview,
        renderDurationRequested: renderDuration,
        demoLoginConfigured: demoConfigured,
      },
      null,
      2
    )
  )
}

main().catch(err => {
  console.error("[e2e-npai] FAILED", err instanceof Error ? err.message : err)
  process.exit(1)
})
