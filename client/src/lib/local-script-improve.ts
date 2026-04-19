export type ScriptShape = {
  hook: string
  openLoop: string
  body: string
  cta: string
  caption: string
  hashtags: string[]
}

export type StoryShape = {
  title: string
  hook: string
  script: string
  caption: string
  hashtags: string[]
}

export type ImproveScriptMode = "aggressive" | "shorter" | "conversion"

/** Lightweight, local-only refinements (no extra credits). */
export function improveVideoScript(script: ScriptShape, mode: ImproveScriptMode): ScriptShape {
  if (mode === "aggressive") {
    return {
      ...script,
      hook: script.hook.startsWith("Stop scrolling:")
        ? script.hook
        : `Stop scrolling: ${script.hook}`,
      body: `${script.body}\n\n(Beat: add one sharper contrast — still platform-safe.)`,
    }
  }
  if (mode === "shorter") {
    const lines = script.body.split(/\n/).filter(Boolean)
    const shortened = lines.slice(0, Math.max(1, Math.min(3, lines.length))).join("\n")
    return {
      ...script,
      body: shortened || script.body.slice(0, 360),
      openLoop:
        script.openLoop.length > 120 ? `${script.openLoop.slice(0, 117).trimEnd()}…` : script.openLoop,
    }
  }
  return {
    ...script,
    cta: `${script.cta}\n\nSingle action now: comment, save, or follow — pick one and name why.`,
  }
}

export function improveStoryScript(story: StoryShape, mode: ImproveScriptMode): StoryShape {
  if (mode === "aggressive") {
    return {
      ...story,
      hook: story.hook.startsWith("Hard truth:")
        ? story.hook
        : `Hard truth: ${story.hook}`,
      script: `${story.script}\n\n(Turn the tension up one notch — no personal attacks.)`,
    }
  }
  if (mode === "shorter") {
    const paras = story.script.split(/\n\n+/)
    const shortened = paras.slice(0, Math.max(1, Math.min(2, paras.length))).join("\n\n")
    return {
      ...story,
      script: shortened || story.script.slice(0, 500),
    }
  }
  return {
    ...story,
    script: `${story.script}\n\n(Closer: one frictionless CTA tied to a concrete payoff.)`,
  }
}
