import { Storyboard } from "./ad.storyboard"

export type SceneType =
  | "hook"
  | "problem"
  | "solution"
  | "feature"
  | "social-proof"
  | "pricing"
  | "cta"
  | "transition"

export interface BuiltScene {
  index: number
  narration: string
  caption: string
  start: number
  duration: number
  end: number
  type: SceneType
  page?: string
  focus?: string
  motion?: string
  highlight?: string
  transition?: string
  intensity: number
  pacing: number
  complexity: number
  engagementScore: number
}

export interface BuiltScenePlan {
  scenes: BuiltScene[]
  totalDuration: number
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function sanitize(text: string) {
  return String(text || "").replace(/\s+/g, " ").trim()
}

function splitCaption(text: string) {
  const words = text.split(" ").filter(Boolean)
  if (words.length <= 3) return words.join(" ")
  if (words.length <= 6) {
    const mid = Math.ceil(words.length / 2)
    return `${words.slice(0, mid).join(" ")}\n${words.slice(mid).join(" ")}`
  }
  return `${words.slice(0, 3).join(" ")}\n${words.slice(3, 6).join(" ")}`
}

function sceneIntensity(type: SceneType, index: number, total: number) {
  const progress = index / Math.max(1, total)
  switch (type) {
    case "hook": return 1
    case "cta": return 0.96
    case "pricing": return 0.9
    case "solution": return 0.86
    case "problem": return 0.72
    case "social-proof": return 0.82
    case "feature": return clamp(0.72 + progress * 0.24, 0.72, 0.95)
    default: return 0.65
  }
}

function scenePacing(type: SceneType, index: number, total: number) {
  const progress = index / Math.max(1, total)
  if (type === "hook") return 1
  if (type === "cta") return 0.93
  if (progress < 0.35) return 0.78
  if (progress < 0.7) return 0.86
  return 0.9
}

function sceneComplexity(type: SceneType) {
  switch (type) {
    case "hook": return 0.9
    case "cta": return 0.86
    case "pricing": return 0.82
    case "solution": return 0.76
    case "feature": return 0.72
    case "social-proof": return 0.68
    default: return 0.6
  }
}

function sceneMotion(type: SceneType) {
  switch (type) {
    case "hook": return "push-in"
    case "problem": return "pan-left"
    case "solution": return "focus-pull"
    case "feature": return "pan-right"
    case "social-proof": return "subtle-glide"
    case "pricing": return "push-in"
    case "cta": return "push-out"
    default: return "none"
  }
}

function transitionForScene(type: SceneType, index: number) {
  if (index === 0) return "impact"
  switch (type) {
    case "hook": return "cut"
    case "problem": return "fade"
    case "solution": return "slide"
    case "feature": return "zoom"
    case "social-proof": return "pan"
    case "pricing": return "push"
    case "cta": return "impact"
    default: return "fade"
  }
}

function detectHighlight(type: SceneType) {
  switch (type) {
    case "hook": return "landing-hero"
    case "problem": return "creator-pain"
    case "solution": return "tool-panel"
    case "feature": return "feature-card"
    case "social-proof": return "proof-strip"
    case "pricing": return "pricing-table"
    case "cta": return "cta-button"
    default: return undefined
  }
}

function detectPage(type: SceneType) {
  switch (type) {
    case "hook": return "/"
    case "problem": return "/"
    case "solution": return "/pricing"
    case "feature": return "/login"
    case "social-proof": return "/dashboard"
    case "pricing": return "/pricing"
    case "cta": return "/tools"
    default: return "/"
  }
}

function calculateEngagementScore(narration: string, caption: string, type: SceneType) {
  let score = 50
  const text = narration.toLowerCase()
  const triggers = ["ai", "instant", "fast", "viral", "automate", "generate", "free", "powerful", "smart", "create", "scale"]

  for (const word of triggers) {
    if (text.includes(word)) score += 5
  }

  if (type === "hook") score += 18
  if (type === "cta") score += 14
  if (type === "pricing") score += 10
  if (caption.length < 60) score += 5

  return clamp(score, 1, 100)
}

export function buildScenes(storyboard: Storyboard): BuiltScenePlan {
  const scenes: BuiltScene[] = []
  const totalScenes = storyboard.scenes.length

  if (!totalScenes) {
    return { scenes: [], totalDuration: 0 }
  }

  let cursor = 0

  for (let i = 0; i < storyboard.scenes.length; i++) {
    const scene = storyboard.scenes[i]
    const type = scene.type as SceneType
    const duration = clamp(Number(scene.duration) || 2.4, 1.4, 6)
    const start = cursor
    const end = start + duration
    cursor = end

    const narration = sanitize(scene.narration)
    const caption = splitCaption(sanitize(scene.caption))

    scenes.push({
      index: i,
      narration,
      caption,
      start,
      duration,
      end,
      type,
      page: scene.page || detectPage(type),
      focus: scene.focus,
      motion: scene.motion || sceneMotion(type),
      highlight: detectHighlight(type),
      transition: transitionForScene(type, i),
      intensity: sceneIntensity(type, i, totalScenes),
      pacing: scenePacing(type, i, totalScenes),
      complexity: sceneComplexity(type),
      engagementScore: calculateEngagementScore(narration, caption, type)
    })
  }

  return {
    scenes,
    totalDuration: cursor
  }
}