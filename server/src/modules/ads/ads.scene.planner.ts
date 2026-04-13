import crypto from "crypto"
import {
  GeneratedScript,
  WebsiteAnalysis,
  PlannedScene
} from "./ads.types"

function uid() {
  return crypto.randomUUID()
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function sceneKind(index: number, total: number): PlannedScene["kind"] {
  if (index === 0) return "hook"
  if (index === 1) return "product"
  if (index === total - 1) return "cta"
  if (index === total - 2) return "benefit"
  if (index <= 2) return "product"
  return "benefit"
}

function pickVisual(kind: PlannedScene["kind"], index: number, site: WebsiteAnalysis): PlannedScene["visualType"] {
  if (kind === "hook") return "landing_page"
  if (index === 1) return "pricing_page"
  if (index === 2) return "login_flow"
  if (kind === "product") return "tools_grid"
  if (kind === "benefit") {
    if (site.dashboardUrl) return "dashboard"
    return "feature_demo"
  }
  return "cta_screen"
}

function distributeDurations(sceneCount: number, totalDuration: number) {
  const base = totalDuration / Math.max(1, sceneCount)
  const durations: number[] = []

  for (let i = 0; i < sceneCount; i++) {
    let d = base
    if (i === 0) d *= 1.15
    if (i === sceneCount - 1) d *= 1.1
    durations.push(clamp(d, 1.2, 6))
  }

  return durations
}

export function planAdScenes(
  script: GeneratedScript,
  website: WebsiteAnalysis
): PlannedScene[] {
  const scenes = script.scenes || []
  if (!scenes.length) return []

  const totalScenes = scenes.length
  const durations = distributeDurations(totalScenes, script.metadata.duration)

  return scenes.map((scene, i) => {
    const kind = sceneKind(i, totalScenes)
    const visual = pickVisual(kind, i, website)

    return {
      id: uid(),
      kind,
      duration: durations[i],
      source: "capture",
      visualType: visual,
      scriptText: scene.voiceoverLine || scene.onScreenText,
      captionText: scene.caption
    }
  })
}