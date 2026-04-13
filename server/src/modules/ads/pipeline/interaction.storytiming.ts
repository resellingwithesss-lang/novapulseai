import type { BuiltAdScene } from "./types"
import type { AdInteractionStep } from "./interaction.types"

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Map each interaction step to a start time (ms) within the VO scene, using
 * keyword positions in narration so actions cluster near relevant phrases.
 * Times are later scaled to actual capture segment wall-clock in website.capture.
 */
export function buildStepStartOffsetsMs(
  steps: AdInteractionStep[],
  scene: BuiltAdScene
): number[] {
  const dur = Math.max(0.75, Number(scene.duration) || 2) * 1000
  const words = `${scene.text} ${scene.caption}`
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9'-]/gi, "").toLowerCase())
    .filter(Boolean)
  const text = `${scene.text} ${scene.caption}`.toLowerCase()

  const wordTime = (idx: number) =>
    words.length ? Math.min(0.92, (idx + 0.55) / Math.max(words.length, 1)) : 0.45

  const findWord = (re: RegExp): number | null => {
    const i = words.findIndex(w => re.test(w))
    return i >= 0 ? wordTime(i) : null
  }

  const tFree = findWord(/^(free|trial|forever)$/) ?? (/\bfree\b|\btrial\b/.test(text) ? 0.32 : null)
  const tStart =
    findWord(/^(start|try|get|join|sign|signup)$/) ?? (/\bstart\b|\btry\b|\bsign\b/.test(text) ? 0.38 : null)
  const tResult =
    findWord(/^(result|results|output|saved|proof|ready|done|transform|works)$/) ??
    (/\bresult|\boutput|\bsaved|\bready|\btransform/.test(text) ? 0.52 : null)
  const tNow = findWord(/^(now|today|instant|seconds)$/) ?? (/\bnow\b|\btoday\b/.test(text) ? 0.62 : null)

  const n = steps.length
  const rawFrac: number[] = []

  for (let i = 0; i < n; i++) {
    const st = steps[i]!
    let f = smoothstep(0, 1, (i + 1) / Math.max(n + 1, 2)) * 0.86

    if (st.type === "wait" && i < 2) f = Math.min(f, 0.06 + i * 0.04)
    if (st.type === "scroll") {
      if (scene.type === "transformation_proof") {
        const early = i < 4
        f = early ? 0.05 + i * 0.028 : 0.38 + ((i - 3) / Math.max(n - 3, 2)) * 0.42
      } else {
        f = Math.min(f, 0.12 + (i * 0.04) / Math.max(n, 3))
        if (i === 0) f = 0.05 + Math.random() * 0.04
      }
    }
    if (st.type === "waitForSelector") {
      const anchor = tResult ?? 0.18
      f = 0.08 + anchor * 0.55
    }
    if (st.type === "hover" || st.type === "move") {
      const lab = "label" in st && st.label ? st.label.toLowerCase() : ""
      if (
        /^(clip|batch|thumbnail|variant|ready)$/.test(lab) &&
        scene.type === "transformation_proof"
      ) {
        f = 0.22 + (tResult ?? 0.48) * 0.5
      } else if (/export|download|save|share/.test(lab)) {
        f = 0.22 + (tResult ?? 0.45) * 0.5
      } else if (/plan|price|pricing/.test(lab)) {
        f = 0.14 + (tStart ?? 0.35) * 0.45
      } else if (/email|password|sign|start|free|try|get|create/.test(lab)) {
        f = 0.1 + (tFree ?? tStart ?? 0.36) * 0.58
      } else if (/workflow|dashboard|tool/.test(lab)) {
        f = 0.18 + (tResult ?? 0.4) * 0.42
      } else if (st.type === "move") {
        f = 0.15 + (tStart ?? tFree ?? 0.4) * 0.5
      }
    }
    if (st.type === "type" && st.inputKind === "email") {
      f = 0.14 + (tStart ?? tFree ?? 0.35) * 0.48
    }
    if (st.type === "type" && st.inputKind === "password") {
      const prev = rawFrac[i - 1] ?? 0.18
      f = Math.min(0.78, prev + 0.1 + Math.random() * 0.05)
    }
    if (st.type === "click") {
      f = 0.48 + (tNow ?? tStart ?? 0.25) * 0.38
    }
    if (st.type === "waitForNavigation") {
      f = Math.min(0.88, (rawFrac[i - 1] ?? 0.5) + 0.06)
    }

    rawFrac.push(Math.min(0.94, Math.max(0.02, f)))
  }

  /** NovaPulseAI transformation: three timed bands — reveal → multiplication (dense grid) → shipping. */
  if (scene.type === "transformation_proof" && n > 3) {
    const iThird = Math.max(1, Math.floor(n / 3))
    const phaseMin = Math.min(0.34, 800 / dur)
    for (let i = 0; i < n; i++) {
      let lo = 0.02
      let hi = 0.95
      if (i < iThird) {
        lo = 0.03
        hi = Math.max(0.3, phaseMin + 0.04)
      } else if (i < 2 * iThird) {
        lo = Math.max(phaseMin + 0.04, 0.34)
        hi = Math.min(0.64, phaseMin * 2 + 0.12)
      } else {
        lo = Math.max(phaseMin * 2 + 0.02, 0.65)
        hi = 0.94
      }
      rawFrac[i] = Math.min(hi, Math.max(lo, rawFrac[i]!))
    }
  }

  for (let i = 1; i < rawFrac.length; i++) {
    rawFrac[i] = Math.max(rawFrac[i]!, rawFrac[i - 1]! + 0.028)
  }

  const minGap = scene.type === "payoff" || scene.type === "transformation_proof" ? 195 : 115
  let last = -minGap
  let offsets = rawFrac.map(f => {
    const ms = Math.floor(f * dur)
    const next = Math.max(ms, last + minGap)
    last = next
    return Math.min(next, dur - 40)
  })

  /** Ensure reveal / multiplication / shipping each have meaningful on-screen dwell (>= ~0.8s). */
  if (scene.type === "transformation_proof" && n > 3) {
    const iThird = Math.max(1, Math.floor(n / 3))
    const endR = iThird - 1
    const endM = 2 * iThird - 1
    const endS = n - 1
    const phaseMin = Math.min(800, Math.max(560, dur * 0.29))
    const bump = (from: number, to: number) => {
      if (to <= from || from < 0) return
      const gap = offsets[to]! - offsets[from]!
      const need = phaseMin - gap
      if (need <= 0) return
      for (let j = to; j < n; j++) offsets[j]! += need
    }
    bump(0, endR)
    bump(endR, endM)
    bump(endM, endS)
    const maxMs = dur - 40
    let scale = 1
    if (offsets[n - 1]! > maxMs) {
      scale = maxMs / Math.max(1, offsets[n - 1]!)
      offsets = offsets.map(o => Math.floor(o * scale))
    }
    last = -minGap
    offsets = offsets.map(ms => {
      const next = Math.max(ms, last + minGap)
      last = next
      return Math.min(next, maxMs)
    })
  }

  return offsets
}
