export type SceneType =
  | "hook"
  | "problem"
  | "solution"
  | "benefit"
  | "social-proof"
  | "feature"
  | "pricing"
  | "cta"

export interface StoryboardScene {
  index: number
  narration: string
  caption: string
  duration: number
  start: number
  end: number
  type: SceneType
  page: string
  focus?: string
  motion: "zoom" | "pan" | "scroll" | "none"
  priority: number
  energy: number
}

export interface Storyboard {
  scenes: StoryboardScene[]
  totalDuration: number
}

interface ScriptScene {
  text?: string
  caption?: string
  page?: string
  focus?: string
}

interface ScriptInput {
  scenes?: ScriptScene[]
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function sanitize(text: string) {
  return String(text || "").replace(/\s+/g, " ").trim()
}

function sum(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0)
}

function splitCaption(text: string) {
  const words = text.split(" ").filter(Boolean)
  if (words.length <= 4) return text
  const mid = Math.ceil(words.length / 2)
  return `${words.slice(0, mid).join(" ")}\n${words.slice(mid).join(" ")}`
}

function classifyScene(index: number, total: number): SceneType {
  if (index === 0) return "hook"
  if (index === 1) return "problem"
  if (index === 2) return "solution"
  if (index === total - 2) return "pricing"
  if (index === total - 1) return "cta"
  if (index < total * 0.5) return "benefit"
  return "feature"
}

function detectPage(type: SceneType, index: number) {
  switch (type) {
    case "hook": return "/"
    case "problem": return "/"
    case "solution": return "/tools"
    case "benefit": return index % 2 === 0 ? "/dashboard" : "/tools"
    case "feature": return "/tools"
    case "pricing": return "/pricing"
    case "cta": return "/tools"
    default: return "/"
  }
}

function sceneMotion(type: SceneType) {
  switch (type) {
    case "hook": return "zoom"
    case "problem": return "pan"
    case "solution": return "scroll"
    case "benefit": return "scroll"
    case "feature": return "pan"
    case "pricing": return "zoom"
    case "cta": return "zoom"
    default: return "none"
  }
}

function sceneWeight(type: SceneType) {
  switch (type) {
    case "hook": return 2.2
    case "problem": return 1.3
    case "solution": return 1.5
    case "benefit": return 1.0
    case "feature": return 1.1
    case "social-proof": return 1.2
    case "pricing": return 1.7
    case "cta": return 1.9
    default: return 1.0
  }
}

function sceneEnergy(type: SceneType, index: number, total: number) {
  const progress = index / total
  switch (type) {
    case "hook": return 1
    case "cta": return 0.95
    case "pricing": return 0.9
    case "solution": return 0.85
    case "problem": return 0.7
    case "feature": return clamp(0.7 + progress * 0.25, 0.7, 0.95)
    default: return 0.7
  }
}

function scenePriority(type: SceneType) {
  switch (type) {
    case "hook": return 10
    case "cta": return 9
    case "pricing": return 8
    case "solution": return 7
    case "problem": return 6
    case "feature": return 5
    case "benefit": return 4
    default: return 3
  }
}

function distributeDurations(types: SceneType[], totalDuration: number) {
  const weights = types.map(sceneWeight)
  const weightSum = sum(weights)
  let durations = weights.map(w => (w / weightSum) * totalDuration)
  durations = durations.map(d => clamp(d, 1.6, 5))
  const scale = totalDuration / sum(durations)
  return durations.map(d => d * scale)
}

function ensureScenes(rawScenes?: ScriptScene[]) {
  if (!rawScenes || !rawScenes.length) return []
  return rawScenes.map(scene => ({
    text: sanitize(scene?.text || ""),
    caption: sanitize(scene?.caption || ""),
    page: scene?.page,
    focus: scene?.focus
  }))
}

export function buildStoryboard(script: ScriptInput, duration: number): Storyboard {
  const rawScenes = ensureScenes(script?.scenes)

  if (!rawScenes.length) {
    return { scenes: [], totalDuration: 0 }
  }

  const sceneCount = rawScenes.length
  const types: SceneType[] = rawScenes.map((_, i) => classifyScene(i, sceneCount))
  const durations = distributeDurations(types, duration)
  let currentTime = 0

  const scenes: StoryboardScene[] = rawScenes.map((scene, i) => {
    const type = types[i]
    const start = currentTime
    const end = start + durations[i]
    currentTime = end

    return {
      index: i,
      narration: sanitize(scene.text),
      caption: splitCaption(sanitize(scene.caption)),
      duration: durations[i],
      start,
      end,
      type,
      page: scene.page || detectPage(type, i),
      focus: scene.focus,
      motion: sceneMotion(type),
      priority: scenePriority(type),
      energy: sceneEnergy(type, i, sceneCount)
    }
  })

  return {
    scenes,
    totalDuration: sum(durations)
  }
}