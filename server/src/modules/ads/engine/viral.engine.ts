import crypto from "crypto"

export interface ViralScene {
  narration: string
  caption: string
  duration: number
  type: "intro" | "hook" | "problem" | "solution" | "benefit" | "cta"
}

export interface ViralAdPlan {
  id: string
  hook: string
  scenes: ViralScene[]
  cta: string
  platform?: "tiktok" | "youtube" | "instagram"
  duration?: 15 | 30 | 45
}

const HOOK_PATTERNS = [
  "Nobody tells you this about {product}",
  "This tool saves hours every week",
  "Stop doing {pain} the hard way",
  "The easiest way to {benefit}",
  "I tested this so you don't have to",
  "If you run a business you NEED this",
  "This AI tool is changing how creators work",
  "Creators are switching to this AI tool",
  "This might be the fastest way to create content",
  "I tried this AI tool and the results shocked me"
]

const PROBLEM_LINES = [
  "Most creators waste hours writing scripts.",
  "Creating content manually takes forever.",
  "Posting without strategy rarely works.",
  "Content creation should not take all day."
]

const SOLUTION_LINES = [
  "{product} automates the workflow.",
  "{product} generates viral scripts instantly.",
  "{product} helps creators scale content fast.",
  "{product} builds high-retention content in seconds."
]

const BENEFIT_LINES = [
  "Generate scripts, ads, and videos instantly.",
  "Scale your content engine with AI.",
  "Turn ideas into viral content.",
  "Build a real content growth system."
]

const CTA_LINES = [
  "Start free today",
  "Try it now",
  "Launch your content engine",
  "Create your first viral video today"
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function replaceTokens(template: string, product: string) {
  return template
    .replace("{product}", product)
    .replace("{pain}", "manual work")
    .replace("{benefit}", "save time")
}

function adjustDurations(scenes: ViralScene[], duration: number): ViralScene[] {
  const total = scenes.reduce((sum, s) => sum + s.duration, 0)
  if (total === duration) return scenes

  const scale = duration / total
  return scenes.map(scene => ({
    ...scene,
    duration: Math.max(1, Math.round(scene.duration * scale))
  }))
}

export function buildViralAd(
  product: string,
  options?: {
    platform?: "tiktok" | "youtube" | "instagram"
    duration?: 15 | 30 | 45
  }
): ViralAdPlan {
  const platform = options?.platform ?? "tiktok"
  const duration = options?.duration ?? 15

  const intro: ViralScene = {
    narration: `${product}`,
    caption: product,
    duration: 2,
    type: "intro"
  }

  const hookText = replaceTokens(pick(HOOK_PATTERNS), product)
  const hook: ViralScene = {
    narration: hookText,
    caption: hookText,
    duration: 2,
    type: "hook"
  }

  const problem: ViralScene = {
    narration: pick(PROBLEM_LINES),
    caption: pick(PROBLEM_LINES),
    duration: 3,
    type: "problem"
  }

  const solutionText = replaceTokens(pick(SOLUTION_LINES), product)
  const solution: ViralScene = {
    narration: solutionText,
    caption: solutionText,
    duration: 3,
    type: "solution"
  }

  const benefitText = pick(BENEFIT_LINES)
  const benefit: ViralScene = {
    narration: benefitText,
    caption: benefitText,
    duration: 3,
    type: "benefit"
  }

  const ctaText = pick(CTA_LINES)
  const cta: ViralScene = {
    narration: `Try ${product} today.`,
    caption: ctaText,
    duration: 2,
    type: "cta"
  }

  const scenes = adjustDurations([intro, hook, problem, solution, benefit, cta], duration)

  return {
    id: crypto.randomUUID(),
    hook: hook.narration,
    scenes,
    cta: ctaText,
    platform,
    duration
  }
}