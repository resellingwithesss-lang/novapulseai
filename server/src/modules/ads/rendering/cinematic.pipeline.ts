import fs from "fs"
import path from "path"
import crypto from "crypto"
import { spawn } from "child_process"
import { captureWebsite, type AdsCaptureLogContext } from "../website.capture"
import { CinematicAssets, Platform } from "../ads.types"
import type {
  InteractiveAdScene,
  InteractionCaptureOptions,
} from "../pipeline/interaction.types"
import type { AdSceneType, AdSiteIngestion } from "../pipeline/types"
import { resolveNovaPulseAICaptureProfile } from "../pipeline/ad.product-profile"
import {
  validateNovaPulseAICaptureQuality,
  validateNovaPulseAIPlannedSceneMix,
  validateNovaPulseAIStitchContinuity,
  novaPulseAICaptureSupplementalRuntimePct,
} from "../pipeline/novapulseai.ad-quality-gate"

/** One stitch segment: contiguous trim in the capture + beat metadata for camera / extension. */
interface StitchScene {
  start: number
  duration: number
  /** Arc type (primary timeline or donor copy for extensions). */
  kind: AdSceneType
  /**
   * 0 = authored timeline; 1+ = extension duplicate with shifted trim + different motion.
   * Progression: reveal → sweep → export cue (driven by variant + kind).
   */
  variant: number
  /** Extension-only: decouples pan rhythm / direction from consecutive duplicates. */
  dupSignature?: number
}

/** Minimum stitched output length; extended by repeating key trims when capture is short. */
const MIN_FINAL_DURATION_SEC = 12
/** Normal NovaPulseAI product ads: coherent demos must not export as a sub-15s reel. */
const MIN_NPAI_FINAL_DURATION_SEC = 15
/** Below this after stitch, retry once with stronger duplication (degraded, not fatal). */
const STITCH_RECOVERY_MIN_DURATION_SEC = 8
const MIN_SEGMENT_SEC_NORMAL = 1.2
const MIN_SEGMENT_TRANSFORMATION_SEC = 2.5

function sumTimelineDurations(timeline: StitchScene[]): number {
  return timeline.reduce((a, s) => a + s.duration, 0)
}

function segmentFloorSecForKind(
  kind: AdSceneType,
  fps: number,
  npaiNarrativeStrict?: boolean
): number {
  const minFrames = 24
  const fromFrames = minFrames / Math.max(1, fps)
  if (!npaiNarrativeStrict) {
    return kind === "transformation_proof"
      ? Math.max(MIN_SEGMENT_TRANSFORMATION_SEC, fromFrames)
      : Math.max(MIN_SEGMENT_SEC_NORMAL, fromFrames)
  }
  if (kind === "hook") return Math.max(0.92, Math.min(1.85, fromFrames + 0.35))
  if (kind === "demo_auth") return Math.max(1.12, Math.min(2.1, fromFrames + 0.45))
  if (kind === "cta") return Math.max(1.32, fromFrames + 0.5)
  if (kind === "transformation_proof")
    return Math.max(3.05, Math.max(MIN_SEGMENT_TRANSFORMATION_SEC, fromFrames + 0.6))
  if (kind === "payoff") return Math.max(2.35, fromFrames + 0.55)
  return Math.max(1.62, fromFrames + 0.5)
}

/** Ensure each segment meets dwell floor; shrink proportionally if total exceeds `capDur`. */
function applySegmentDurationFloors(
  timeline: StitchScene[],
  fps: number,
  capDur: number,
  npaiNarrativeStrict?: boolean
): StitchScene[] {
  if (!timeline.length || capDur <= 0.05) {
    return [
      {
        start: 0,
        duration: Math.max(0.12, capDur),
        kind: "feature",
        variant: 0,
      },
    ]
  }
  let durs = timeline.map(s =>
    Math.max(segmentFloorSecForKind(s.kind, fps, npaiNarrativeStrict), s.duration)
  )
  let sum = durs.reduce((a, b) => a + b, 0)
  if (sum > capDur + 1e-6) {
    const scale = capDur / sum
    durs = durs.map((d, i) =>
      Math.max(segmentFloorSecForKind(timeline[i]!.kind, fps, npaiNarrativeStrict) * 0.9, d * scale)
    )
    sum = durs.reduce((a, b) => a + b, 0)
    if (sum > capDur) durs = durs.map(d => d * (capDur / sum))
  }
  let cursor = 0
  return durs
    .map((d, i) => {
      const duration = Math.min(d, Math.max(0.08, capDur - cursor))
      const meta = timeline[i]!
      const seg = {
        start: cursor,
        duration,
        kind: meta.kind,
        variant: meta.variant,
        dupSignature: meta.dupSignature,
      }
      cursor += duration
      return seg
    })
    .filter(s => s.duration >= 0.06)
}

/** Shift trim window + rhythm so extensions read as progression, not a hard loop. */
function duplicateSegmentVariant(
  prev: StitchScene | undefined,
  donor: StitchScene,
  extensionOrdinal: number,
  capDur: number,
  shortCapture: boolean
): StitchScene {
  const o = Math.max(1, extensionOrdinal)
  const slideStep = Math.min(0.42, donor.duration * (shortCapture ? 0.24 : 0.17))
  let startShift = slideStep * (o * 0.82 + (o % 2) * 0.14 + (o % 3) * 0.06)
  let start = clamp(
    donor.start + startShift,
    0,
    Math.max(0, capDur - MIN_SEGMENT_SEC_NORMAL)
  )

  if (prev && Math.abs(start - prev.start) < capDur * 0.072) {
    startShift += capDur * (0.078 + (o % 2) * 0.042 + (prev.kind === donor.kind ? 0.028 : 0))
    start = clamp(donor.start + startShift, 0, Math.max(0, capDur - MIN_SEGMENT_SEC_NORMAL))
  }

  const rhythm = [0.86, 0.94, 1.05, 0.91][o % 4]!
  let duration = donor.duration * rhythm * (shortCapture ? 0.97 + (o % 2) * 0.04 : 1)
  duration = clamp(duration, MIN_SEGMENT_SEC_NORMAL, donor.duration * 1.14)
  duration = Math.min(duration, Math.max(0.08, capDur - start))

  let dupSignature = (o + (prev?.dupSignature ?? -1) + 1) % 4
  if (prev && prev.kind === donor.kind && dupSignature === (prev.dupSignature ?? 0) % 4) {
    dupSignature = (dupSignature + 2) % 4
  }

  return {
    start,
    duration,
    kind: donor.kind,
    variant: donor.variant + o,
    dupSignature,
  }
}

/**
 * Repeat high-value segments until output length >= minTotal.
 * Prefer transformation_proof donors first (grid progression), then payoff, then others.
 */
function expandTimelineToMinTotal(
  timeline: StitchScene[],
  capDur: number,
  minTotal: number,
  shortCapture: boolean,
  vfCohesion?: boolean
): StitchScene[] {
  const tl = timeline.map(s => ({
    ...s,
    start: clamp(s.start, 0, Math.max(0, capDur - 0.04)),
  }))
  const normalized = tl
    .map(s => ({
      ...s,
      duration: Math.min(s.duration, Math.max(0.06, capDur - s.start)),
    }))
    .filter(s => s.duration >= 0.06)

  let out = normalized.length
    ? normalized
    : [
        {
          start: 0,
          duration: Math.max(0.12, Math.min(capDur, minTotal)),
          kind: "feature" as AdSceneType,
          variant: 0,
        },
      ]
  let total = sumTimelineDurations(out)

  const donorQueue = (): StitchScene[] => {
    const q: StitchScene[] = []
    for (const s of out) {
      if (s.kind === "transformation_proof" && s.variant === 0) q.push({ ...s })
    }
    for (const s of out) {
      if (s.kind === "payoff" && s.variant === 0) q.push({ ...s })
    }
    for (const s of out) {
      if (s.variant === 0 && s.kind !== "transformation_proof" && s.kind !== "payoff") {
        if (
          vfCohesion &&
          (s.kind === "demo_auth" || s.kind === "hook" || s.kind === "cta")
        ) {
          continue
        }
        q.push({ ...s })
      }
    }
    if (!q.length) q.push({ ...out[out.length - 1]! })
    return q
  }

  const extCountByKind = new Map<AdSceneType, number>()
  for (const s of out) {
    if (s.variant > 0) {
      extCountByKind.set(s.kind, Math.max(extCountByKind.get(s.kind) ?? 0, s.variant))
    }
  }
  const queue = donorQueue()
  let qi = 0
  let guard = 0
  const maxAppend = 14

  while (total + 1e-3 < minTotal && guard++ < maxAppend) {
    const base = queue[qi % queue.length]!
    qi++
    const n = (extCountByKind.get(base.kind) ?? 0) + 1
    extCountByKind.set(base.kind, n)
    const prevSeg = out[out.length - 1]
    const seg = duplicateSegmentVariant(prevSeg, base, n, capDur, shortCapture)
    if (seg.duration >= 0.06) {
      out.push(seg)
      total += seg.duration
    } else break
  }
  return out
}

export type CinematicBuildOptions = {
  /** Per-scene durations (seconds) from the ad scene builder; drives capture cuts. */
  sceneDurations?: number[]
  /** Parallel to `sceneDurations` / timeline — drives min dwell, duplication priority, and static framing. */
  sceneTypes?: AdSceneType[]
  /** Prefer these paths early in the site capture (e.g. /pricing). */
  preferredPaths?: string[]
  /** Scripted browser interactions aligned to built scenes (product-demo capture). */
  interactivePlan?: InteractiveAdScene[]
  interaction?: InteractionCaptureOptions
  /** UGC uses subtler zoompan than default cinematic drift (same concat pipeline). */
  visualStyle?: "cinematic" | "ugc_social"
  /** Correlate logs with ad worker (`ads:cinematic`). */
  logCtx?: AdsCaptureLogContext
  /** Fine-grained hooks for job progress (post-script capture / ffmpeg). */
  onPhase?: (phase: CinematicPhase) => void
  /** Forwarded to `captureWebsite` (~0–100 during frame loops). */
  onCaptureProgress?: (percentApprox: number) => void
  /** Faster capture + lighter ffmpeg graph (no per-scene zoompan). Opt-in only. */
  fastPreview?: boolean
  /** NovaPulseAI: post-login route lock + login verify (tools/dashboard paths). */
  vfSiteIngestion?: Pick<AdSiteIngestion, "siteUrl" | "toolsUrl" | "dashboardUrl" | "pricingUrl">
  /**
   * When true (NovaPulseAI product ads), enforce post-capture quality gate and optional
   * timeline recovery instead of shipping login/pricing-heavy captures.
   */
  novaPulseAIProductAd?: boolean
  /** Forwarded to Puppeteer capture for timeline + interactive NovaPulseAI login. */
  loginEmail?: string
  loginPassword?: string
}

export type CinematicPhase =
  | "capture_start"
  | "capture_end"
  | "prepare_stitch"
  | "ffmpeg_stitch_start"
  | "ffmpeg_stitch_end"

const GENERATED_DIR = path.resolve("generated")
/** Legacy reference; stitched output is validated with duration-aware rules (see `assertStitchedOutputValid`). */
const MIN_OUTPUT_BYTES = 120000
/** Below this size, the file is almost certainly corrupt or not a real video payload. */
const STITCH_ABSOLUTE_MIN_BYTES = 8_000
/** Minimum probed duration (seconds) for a non-degenerate stitched video. */
const STITCH_MIN_DURATION_SEC = 0.12
/**
 * Lower bound on bytes/sec from probed duration (short, efficient encodes at high CRF still exceed this).
 * Example: 4.3s * 2500 = 10750; max with absolute floor yields ~10.75 KiB minimum.
 */
const STITCH_MIN_BYTES_PER_SEC = 2_500
const TIMEOUT = 10 * 60 * 1000
const FFPROBE_TIMEOUT_MS = Math.min(
  60_000,
  Math.max(8_000, Math.floor(Number(process.env.AD_FFPROBE_TIMEOUT_MS ?? "25000")))
)
const CINEMA_FFMPEG_PRESET =
  process.env.AD_CINEMA_FFMPEG_PRESET?.trim() || "medium"

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function uid(prefix = "vid") {
  return `${prefix}-${Date.now()}-${crypto.randomUUID()}`
}

function ff(p: string) {
  return path.resolve(p).replace(/\\/g, "/")
}

function run(bin: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true })
    let stderr = ""

    const timer = setTimeout(() => {
      try { p.kill("SIGKILL") } catch {}
      reject(new Error("[AD_FFMPEG:cinematic_stitch] ffmpeg cinematic stitch timed out"))
    }, TIMEOUT)

    p.stderr.on("data", d => { stderr += d.toString() })

    p.on("close", c => {
      clearTimeout(timer)
      if (c === 0) resolve()
      else reject(new Error(stderr || String(c)))
    })

    p.on("error", err => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

async function probe(file: string) {
  return new Promise<number>((resolve, reject) => {
    const p = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      ff(file)
    ])

    let out = ""
    const killTimer = setTimeout(() => {
      try {
        p.kill("SIGKILL")
      } catch {
        /* ignore */
      }
      reject(new Error(`ffprobe timed out after ${FFPROBE_TIMEOUT_MS}ms`))
    }, FFPROBE_TIMEOUT_MS)

    p.stdout.on("data", d => {
      out += d.toString()
    })
    p.on("close", () => {
      clearTimeout(killTimer)
      const n = Number(out.trim())
      resolve(Number.isFinite(n) ? n : 10)
    })
    p.on("error", err => {
      clearTimeout(killTimer)
      reject(err)
    })
  })
}

type StitchProbeResult = {
  durationSec: number
  width: number | null
  height: number | null
  nbFrames: string | null
}

async function probeStitchOutput(file: string): Promise<StitchProbeResult> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,nb_frames,duration",
      "-show_entries", "format=duration",
      "-of", "json",
      ff(file),
    ])

    let raw = ""
    const killTimer = setTimeout(() => {
      try {
        p.kill("SIGKILL")
      } catch {
        /* ignore */
      }
      reject(new Error(`stitch ffprobe timed out after ${FFPROBE_TIMEOUT_MS}ms`))
    }, FFPROBE_TIMEOUT_MS)

    p.stdout.on("data", d => {
      raw += d.toString()
    })
    p.on("close", () => {
      clearTimeout(killTimer)
      try {
        const j = JSON.parse(raw) as {
          streams?: Array<{
            width?: number
            height?: number
            nb_frames?: string
            duration?: string
          }>
          format?: { duration?: string }
        }
        const stream = j.streams?.[0]
        const durStream = stream?.duration != null ? Number(stream.duration) : NaN
        const durFormat = j.format?.duration != null ? Number(j.format.duration) : NaN
        const candidates = [durStream, durFormat].filter(
          n => Number.isFinite(n) && (n as number) > 0
        ) as number[]
        const durationSec = candidates.length ? Math.max(...candidates) : 0
        resolve({
          durationSec,
          width: stream?.width ?? null,
          height: stream?.height ?? null,
          nbFrames: stream?.nb_frames ?? null,
        })
      } catch {
        reject(new Error("stitch ffprobe: could not parse JSON output"))
      }
    })
    p.on("error", err => {
      clearTimeout(killTimer)
      reject(err)
    })
  })
}

async function assertStitchedOutputValid(params: {
  outPath: string
  sizeBytes: number
  safeTargetSec: number
  capDurSec: number
  fastPreview: boolean
  logCine: (payload: Record<string, unknown>) => void
  /** After duplicate-extension retries, accept short-but-decodable output instead of failing the job. */
  allowDegradedShort?: boolean
  /** Normal NovaPulseAI: probed stitched file must be at least this long. */
  minProbedDurationSec?: number
}): Promise<StitchProbeResult> {
  const {
    outPath,
    sizeBytes,
    safeTargetSec,
    capDurSec,
    fastPreview,
    logCine,
    allowDegradedShort,
    minProbedDurationSec,
  } = params
  const probeResult = await probeStitchOutput(outPath)
  const durationSec = probeResult.durationSec
  const bytesPerSec = fastPreview
    ? Math.floor(STITCH_MIN_BYTES_PER_SEC * 0.85)
    : STITCH_MIN_BYTES_PER_SEC
  const scaledMinBytes = Math.max(
    STITCH_ABSOLUTE_MIN_BYTES,
    Math.floor(durationSec * bytesPerSec)
  )

  const failures: string[] = []

  if (sizeBytes < STITCH_ABSOLUTE_MIN_BYTES) {
    failures.push(
      `absolute_min_bytes: ${sizeBytes} < ${STITCH_ABSOLUTE_MIN_BYTES}`
    )
  }

  if (!Number.isFinite(durationSec) || durationSec < STITCH_MIN_DURATION_SEC) {
    failures.push(
      `min_duration: probed ${durationSec}s (need >= ${STITCH_MIN_DURATION_SEC})`
    )
  }

  if (
    minProbedDurationSec != null &&
    Number.isFinite(durationSec) &&
    durationSec + 1e-3 < minProbedDurationSec
  ) {
    failures.push(
      `npai_min_duration: probed ${durationSec}s (need >= ${minProbedDurationSec}s for normal NovaPulseAI)`
    )
  }

  const w = probeResult.width ?? 0
  const h = probeResult.height ?? 0
  if (w <= 0 || h <= 0) {
    failures.push(`video_stream_resolution: ${w}x${h} (need positive width/height)`)
  }

  if (sizeBytes < scaledMinBytes) {
    failures.push(
      `scaled_size: ${sizeBytes} < ${scaledMinBytes} (from ${durationSec}s × ${bytesPerSec} B/s)`
    )
  }

  const nb = probeResult.nbFrames
  if (nb != null && nb !== "N/A" && Number(nb) === 0) {
    failures.push(`nb_frames: ${nb}`)
  }

  const softOnly =
    failures.length > 0 &&
    failures.every(
      f => f.startsWith("min_duration:") || f.startsWith("scaled_size:")
    ) &&
    durationSec >= 0.45 &&
    w > 0 &&
    h > 0 &&
    sizeBytes >= Math.floor(STITCH_ABSOLUTE_MIN_BYTES * 1.05)

  if (failures.length > 0 && !(allowDegradedShort && softOnly)) {
    logCine({
      phase: "stitched_output_rejected",
      file: path.basename(outPath),
      sizeBytes,
      probedDurationSec: durationSec,
      width: probeResult.width,
      height: probeResult.height,
      nbFrames: probeResult.nbFrames,
      safeTargetSec,
      captureDurationSec: capDurSec,
      fastPreview,
      scaledMinBytes,
      absoluteMinBytes: STITCH_ABSOLUTE_MIN_BYTES,
      failures,
    })
    throw new Error(`stitched output failed validation: ${failures.join("; ")}`)
  }

  if (failures.length > 0 && allowDegradedShort && softOnly) {
    logCine({
      phase: "stitched_output_degraded_ok",
      file: path.basename(outPath),
      sizeBytes,
      probedDurationSec: durationSec,
      width: probeResult.width,
      height: probeResult.height,
      failures,
      note: "accepted_after_extension_retries",
    })
    return probeResult
  }

  logCine({
    phase: "stitched_output_ok",
    file: path.basename(outPath),
    sizeBytes,
    probedDurationSec: durationSec,
    width: probeResult.width,
    height: probeResult.height,
    scaledMinBytes,
    legacyFixedMinBytes: MIN_OUTPUT_BYTES,
  })

  return probeResult
}

function preset(platform: Platform) {
  if (platform === "youtube") return { w: 1920, h: 1080, fps: 30 }
  /**1:1 feed / ads */
  if (platform === "instagram") return { w: 1080, h: 1080, fps: 30 }
  return { w: 1080, h: 1920, fps: 30 }
}

function sceneCount(duration: number) {
  if (duration <= 12) return 4
  if (duration <= 20) return 5
  if (duration <= 30) return 6
  if (duration <= 45) return 7
  if (duration <= 60) return 8
  return 9
}

function distribute(total: number, count: number, kinds: AdSceneType[]): StitchScene[] {
  const base = total / Math.max(1, count)
  let cursor = 0
  const raw = Array.from({ length: count }, (_, i) => {
    let dur = clamp(
      base + (Math.random() * 0.32 - 0.16),
      MIN_SEGMENT_SEC_NORMAL,
      base * 1.22
    )
    if (i === 0) dur *= 1.05
    if (i === count - 1) dur *= 1.04
    return dur
  })
  const sumRaw = raw.reduce((a, b) => a + b, 0) || 1
  return raw.map((d, idx) => {
    const duration = (d / sumRaw) * total
    const kind = kinds[idx % kinds.length] ?? "feature"
    const s = { start: cursor, duration, kind, variant: 0 }
    cursor += duration
    return s
  })
}

/** Map script scene durations to ffmpeg trim segments (contiguous in source; sums to `total`). */
function timelineFromDurations(
  total: number,
  durs: number[],
  sceneTypes: AdSceneType[] | undefined,
  fps: number,
  npaiNarrativeStrict?: boolean
): StitchScene[] {
  const cleaned = durs.map((d, i) => {
    const kind = sceneTypes?.[i] ?? "feature"
    const floor = segmentFloorSecForKind(kind, fps, npaiNarrativeStrict)
    return clamp(Number(d) || 0, floor, total * 0.55)
  })
  const sum = cleaned.reduce((a, b) => a + b, 0) || 1
  let cursor = 0
  return cleaned.map((d, i) => {
    const duration = (d / sum) * total
    const kind = sceneTypes?.[i] ?? "feature"
    const s = { start: cursor, duration, kind, variant: 0 }
    cursor += duration
    return s
  })
}

/**
 * Stitch grade tier when the primary cinematic chain fails (e.g. older FFmpeg).
 * `premium` uses only portable filters (`curves=all`, never `curves=highlights`, which is absent on many Windows builds).
 */
type StitchGradeTier = "premium" | "simple" | "minimal"

function gradeTierLabel(tier: StitchGradeTier): string {
  switch (tier) {
    case "premium":
      return "portable cinematic (eq + curves:all + unsharp + vignette)"
    case "simple":
      return "fallback (eq + unsharp + light vignette)"
    case "minimal":
      return "minimal (eq only)"
  }
}

/**
 * In-scene grade before final color pass (applyColorGrade).
 * All tiers avoid `curves=highlights=` / preset curves options that FFmpeg 8+ gyan builds may reject.
 */
function gradeForStyle(visualStyle: "cinematic" | "ugc_social", tier: StitchGradeTier): string {
  if (tier === "minimal") {
    return visualStyle === "ugc_social"
      ? "eq=contrast=1.04:saturation=1.03:brightness=0.005"
      : "eq=contrast=1.06:saturation=1.06:brightness=0.01"
  }
  if (tier === "simple") {
    if (visualStyle === "ugc_social") {
      return [
        "eq=contrast=1.06:saturation=1.05:brightness=0.008",
        "unsharp=5:5:0.32",
        "vignette=PI/22",
      ].join(",")
    }
    return [
      "eq=contrast=1.09:saturation=1.09:brightness=0.014",
      "unsharp=5:5:0.36",
      "vignette=PI/19",
    ].join(",")
  }
  /* premium: single master curve approximates prior all + highlights roll-off */
  if (visualStyle === "ugc_social") {
    return [
      "eq=contrast=1.07:saturation=1.05:brightness=0.01",
      "curves=all='0/0 0.42/0.40 0.78/0.74 1/0.96'",
      "unsharp=5:5:0.35",
      "vignette=PI/22",
    ].join(",")
  }
  return [
    "eq=contrast=1.11:saturation=1.12:brightness=0.018",
    "curves=all='0/0 0.32/0.29 0.5/0.46 0.76/0.71 1/0.965'",
    "unsharp=5:5:0.42",
    "vignette=PI/17",
  ].join(",")
}

type CameraTier = "hook" | "cta" | "transform" | "light" | "payoff"

function cameraTierForKind(kind: AdSceneType): CameraTier {
  switch (kind) {
    case "hook":
    case "problem":
      return "hook"
    case "demo_auth":
      return "light"
    case "cta":
      return "cta"
    case "transformation_proof":
      return "transform"
    case "solution":
    case "feature":
      return "light"
    case "payoff":
      return "payoff"
  }
}

/** Per-beat camera: hook/CTA = controlled zoom-in; proof/payoff = pan-only; mid-arc = micro zoom. */
function sceneFilter(
  i: number,
  seg: StitchScene,
  w: number,
  h: number,
  fps: number,
  visualStyle: "cinematic" | "ugc_social" = "cinematic",
  fastPreview = false,
  gradeTier: StitchGradeTier = "premium",
  shortCapture = false
) {
  const { start, duration, kind, variant, dupSignature: dupSig } = seg
  const dupSignature = dupSig ?? 0
  const frames = Math.max(1, Math.floor(duration * fps))
  const tier = cameraTierForKind(kind)
  const panBoost = shortCapture ? 1.6 : 1
  const vph = variant % 3
  const spanSkew = 0.9 + (dupSignature % 3) * 0.06

  const fade = visualStyle === "cinematic" ? 0.26 : 0.2
  const grade = fastPreview
    ? "eq=contrast=1.07:saturation=1.05:brightness=0.01"
    : gradeForStyle(visualStyle, gradeTier)

  if (fastPreview) {
    return `
[0:v]trim=start=${start}:duration=${duration},
setpts=PTS-STARTPTS,
scale=${w}:${h}:force_original_aspect_ratio=increase,
crop=${w}:${h},
fps=${fps},
${grade},
fade=t=in:st=0:d=${fade},
fade=t=out:st=${Math.max(0, duration - fade)}:d=${fade}
[v${i}]
`.replace(/\s+/g, " ")
  }

  let zoompan = ""
  if (tier === "transform") {
    const span = (0.055 + vph * 0.028) * panBoost * spanSkew
    const dir =
      dupSignature % 4 === 0 ? "-1" : dupSignature % 4 === 1 ? "1" : vph === 0 ? "-1" : vph === 1 ? "1" : "0"
    zoompan = `zoompan=z='1':x='iw/2-(iw/zoom/2)+(${dir})*iw*${span}*(on/${frames})':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}`
  } else if (tier === "payoff") {
    const span = 0.032 * panBoost
    zoompan = `zoompan=z='1':x='iw/2-(iw/zoom/2)+iw*${span}*sin(PI*on/${frames})':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}`
  } else if (tier === "hook") {
    const zEnd = visualStyle === "ugc_social" ? 1.02 : 1.05
    zoompan = `zoompan=z='min(1+(${zEnd}-1)*on/${frames},${zEnd})':d=${frames}:s=${w}x${h}`
  } else if (tier === "cta") {
    const zEnd = visualStyle === "ugc_social" ? 1.012 : 1.045
    zoompan = `zoompan=z='min(1+(${zEnd}-1)*on/${frames},${zEnd})':d=${frames}:s=${w}x${h}`
  } else {
    const zEnd = visualStyle === "ugc_social" ? 1.006 : 1.028
    zoompan = `zoompan=z='min(1+(${zEnd}-1)*on/${frames},${zEnd})':d=${frames}:s=${w}x${h}`
  }

  return `
[0:v]trim=start=${start}:duration=${duration},
setpts=PTS-STARTPTS,
scale=${w}:${h}:force_original_aspect_ratio=increase,
crop=${w}:${h},
fps=${fps},
${zoompan},
${grade},
fade=t=in:st=0:d=${fade},
fade=t=out:st=${Math.max(0, duration - fade)}:d=${fade}
[v${i}]
`.replace(/\s+/g, " ")
}

function concat(count: number) {
  const inputs = Array.from({ length: count }, (_, i) => `[v${i}]`).join("")
  return `${inputs}concat=n=${count}:v=1:a=0[vout]`
}

export async function buildCinematicAssets(
  url: string,
  duration = 30,
  platformType: Platform = "youtube",
  opts?: CinematicBuildOptions
): Promise<CinematicAssets> {
  const start = Date.now()
  ensureDir(GENERATED_DIR)

  const logCine = (payload: Record<string, unknown>) => {
    const base = opts?.logCtx
      ? `[ads:cinematic] requestId=${opts.logCtx.requestId} jobDbId=${opts.logCtx.jobDbId}`
      : "[ads:cinematic]"
    console.log(base, JSON.stringify({ ...payload, ts: new Date().toISOString() }))
  }

  const capDuration = clamp(duration, MIN_FINAL_DURATION_SEC, 60)
  const fastPreview = opts?.fastPreview === true
  const baseCaptureOpts = {
    duration: capDuration,
    platform: platformType,
    preferredPaths: opts?.preferredPaths,
    logContext: opts?.logCtx,
    onCaptureProgress: opts?.onCaptureProgress,
    fastPreview,
    ...(opts?.loginEmail && opts?.loginPassword
      ? { loginEmail: opts.loginEmail, loginPassword: opts.loginPassword }
      : {}),
  }

  let capture: Awaited<ReturnType<typeof captureWebsite>>
  opts?.onPhase?.("capture_start")
  logCine({ phase: "capture_start", url, fastPreview })
  const tCap = Date.now()
  if (opts?.interactivePlan?.length) {
    try {
      capture = await captureWebsite(url, {
        ...baseCaptureOpts,
        interactiveSegments: opts.interactivePlan,
        interaction: opts.interaction,
        vfSiteIngestion: opts.vfSiteIngestion,
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      logCine({ phase: "interactive_capture_failed", detail })
      capture = await captureWebsite(url, {
        ...baseCaptureOpts,
        fallbackFromInteractive: true,
        vfSiteIngestion: opts.vfSiteIngestion,
      })
    }
  } else {
    capture = await captureWebsite(url, baseCaptureOpts)
  }

  logCine({ phase: "capture_end", durationMs: Date.now() - tCap })
  opts?.onPhase?.("capture_end")

  if (!capture?.videoPath) throw new Error("capture failed")

  const npaiCaptureProfile = resolveNovaPulseAICaptureProfile(url)
  const runNpaiQualityGate =
    opts?.novaPulseAIProductAd === true &&
    npaiCaptureProfile.active &&
    !fastPreview &&
    Boolean(capture.novaPulseAIDiagnostics)

  let vfQualityRecovery: "timeline_after_weak_interactive" | undefined
  let npaiResolvedMeta: NonNullable<CinematicAssets["metadata"]["novaPulseAI"]> | undefined
  if (runNpaiQualityGate && capture.novaPulseAIDiagnostics) {
    let gate = validateNovaPulseAICaptureQuality(capture.novaPulseAIDiagnostics)
    if (
      opts?.interactivePlan?.length &&
      !capture.novaPulseAIDiagnostics.fallbackFromInteractive &&
      gate.ok === false
    ) {
      logCine({
        phase: "vf_quality_gate",
        passed: false,
        recovery: "timeline_retry",
        firstPassReason: gate.reason,
        detail: gate.details,
      })
      const tCap2 = Date.now()
      capture = await captureWebsite(url, {
        ...baseCaptureOpts,
        fallbackFromInteractive: true,
        vfSiteIngestion: opts?.vfSiteIngestion,
      })
      vfQualityRecovery = "timeline_after_weak_interactive"
      logCine({
        phase: "capture_end",
        durationMs: Date.now() - tCap2,
        label: "vf_timeline_recovery_after_weak_interactive",
      })
      if (!capture?.videoPath) throw new Error("capture failed after VF quality recovery")
      if (!capture.novaPulseAIDiagnostics) {
        throw new Error(
          "[AD_VF_QUALITY] timeline_recovery_missing_diagnostics (internal capture error)"
        )
      }
      gate = validateNovaPulseAICaptureQuality(capture.novaPulseAIDiagnostics)
    }

    if (gate.ok) {
      const plan = validateNovaPulseAIPlannedSceneMix(
        opts?.sceneTypes,
        opts?.sceneDurations,
        gate.flowMode
      )
      if (plan.ok === false) {
        logCine({
          phase: "vf_quality_gate",
          passed: false,
          reason: "planned_scene_mix_weak",
          planReason: plan.reason,
          planDetail: plan.details,
        })
        throw new Error(
          `[AD_VF_QUALITY] ${plan.reason} ${JSON.stringify(plan.details).slice(0, 900)}`
        )
      }
    }

    if (gate.ok === false) {
      logCine({
        phase: "vf_quality_gate",
        passed: false,
        reason: gate.reason,
        flowMode: gate.flowMode,
        detail: gate.details,
      })
      throw new Error(
        `[AD_VF_QUALITY] ${gate.reason} ${JSON.stringify(gate.details).slice(0, 1200)}`
      )
    }

    logCine({
      phase: "vf_quality_gate",
      passed: true,
      flowMode: gate.flowMode,
      recovery: vfQualityRecovery,
      runtime_shares_pct: gate.shares,
    })
    const sup =
      capture.novaPulseAIDiagnostics &&
      novaPulseAICaptureSupplementalRuntimePct(capture.novaPulseAIDiagnostics)
    npaiResolvedMeta = {
      qualityGatePassed: true,
      flowMode: gate.flowMode,
      recovery: vfQualityRecovery,
      runtimeSharesPct: {
        login: Math.round(gate.shares.loginShare * 1000) / 10,
        pricing: Math.round(gate.shares.pricingShare * 1000) / 10,
        product_surface: Math.round(gate.shares.productSurfaceShare * 1000) / 10,
        transformation: Math.round(gate.shares.transformationShare * 1000) / 10,
        marketing_surface: Math.round(gate.shares.marketingSurfaceShare * 1000) / 10,
        padding: Math.round(gate.shares.paddingShare * 1000) / 10,
        ...(sup
          ? {
              tools_workflow: sup.toolsWorkflowPct,
              results_proof: sup.resultsProofPct,
              post_login_frames: sup.postLoginFramePct,
            }
          : {}),
      },
    }
  }

  const { w, h, fps } = preset(platformType)
  const tProbe = Date.now()
  const capDur = await probe(capture.videoPath)
  logCine({
    phase: "probe_done",
    captureDurationSec: capDur,
    durationMs: Date.now() - tProbe,
  })
  opts?.onPhase?.("prepare_stitch")

  const npaiProfileStitch = resolveNovaPulseAICaptureProfile(url)
  const npaiNarrativeStrict =
    opts?.novaPulseAIProductAd === true && npaiProfileStitch.active && !fastPreview
  const requested = clamp(
    duration,
    npaiNarrativeStrict ? MIN_NPAI_FINAL_DURATION_SEC : MIN_FINAL_DURATION_SEC,
    60
  )
  const stitchMinTotal = npaiNarrativeStrict
    ? Math.max(MIN_NPAI_FINAL_DURATION_SEC, Math.min(40, requested))
    : MIN_FINAL_DURATION_SEC
  const baseSpan = Math.max(0.12, capDur)
  const shortCapture = baseSpan < 5
  const sceneTypes = opts?.sceneTypes
  const explicit = opts?.sceneDurations?.filter(d => d > 0) ?? []
  const scenesN = explicit.length
    ? explicit.length
    : Math.max(sceneCount(requested), sceneTypes?.length ?? 0)
  const kindsFallback: AdSceneType[] =
    sceneTypes?.length ? sceneTypes : ["hook", "problem", "solution", "payoff", "cta"]
  const timelineBase =
    explicit.length > 0
      ? timelineFromDurations(baseSpan, explicit, sceneTypes, fps, npaiNarrativeStrict)
      : distribute(baseSpan, scenesN, kindsFallback)
  let timeline = applySegmentDurationFloors(
    timelineBase,
    fps,
    baseSpan,
    npaiNarrativeStrict
  )
  timeline = expandTimelineToMinTotal(
    timeline,
    baseSpan,
    stitchMinTotal,
    shortCapture,
    npaiNarrativeStrict
  )
  let outputDuration = sumTimelineDurations(timeline)

  if (npaiNarrativeStrict) {
    const cont = validateNovaPulseAIStitchContinuity(timeline, outputDuration, {
      fastPreview,
      novaPulseAINormal: true,
    })
    if (cont.ok === false) {
      logCine({
        phase: "vf_stitch_continuity_rejected",
        reason: cont.reason,
        detail: cont.details,
        plannedOutputSec: outputDuration,
        stitchMinTotalSec: stitchMinTotal,
      })
      throw new Error(
        `[AD_VF_CONTINUITY] ${cont.reason} ${JSON.stringify(cont.details).slice(0, 900)}`
      )
    }
  }

  const visualStyle = opts?.visualStyle ?? "cinematic"

  const buildFilterGraph = (gradeTier: StitchGradeTier, tl: StitchScene[]) => {
    const filters = tl.map((s, i) =>
      sceneFilter(i, s, w, h, fps, visualStyle, fastPreview, gradeTier, shortCapture)
    )
    filters.push(concat(tl.length))
    return filters.join(";")
  }

  const out = path.join(GENERATED_DIR, `cinematic-${uid()}.mp4`)

  const stitchPreset = fastPreview ? "veryfast" : CINEMA_FFMPEG_PRESET
  const stitchCrf = fastPreview ? "22" : "16"

  opts?.onPhase?.("ffmpeg_stitch_start")
  logCine({
    phase: "ffmpeg_cinematic_stitch",
    status: "start",
    scenes: timeline.length,
    fastPreview,
    preset: stitchPreset,
    plannedOutputSec: outputDuration,
    captureSpanSec: baseSpan,
    shortCapture,
  })

  const stitchTiers: StitchGradeTier[] = fastPreview
    ? ["premium"]
    : ["premium", "simple", "minimal"]

  const tFf = Date.now()
  let stitchUsedTier: StitchGradeTier | null = null
  let lastStitchError: Error | null = null
  let extensionPass = 0

  const runStitchPass = async (tl: StitchScene[], passLabel: string): Promise<boolean> => {
    stitchUsedTier = null
    lastStitchError = null
    const outSecs = sumTimelineDurations(tl)
    for (const gradeTier of stitchTiers) {
      const graph = buildFilterGraph(gradeTier, tl)
      logCine({
        phase: "ffmpeg_stitch_attempt",
        gradeTier,
        gradeChain: gradeTierLabel(gradeTier),
        filterComplexLength: graph.length,
        fastPreview,
        pass: passLabel,
        outputSec: outSecs,
      })
      try {
        await run("ffmpeg", [
          "-y",
          "-i", ff(capture.videoPath),
          "-filter_complex", graph,
          "-map", "[vout]",
          "-c:v", "libx264",
          "-preset", stitchPreset,
          "-crf", stitchCrf,
          "-pix_fmt", "yuv420p",
          "-movflags", "+faststart",
          "-t", String(Math.max(outSecs, 0.25)),
          ff(out),
        ])
        stitchUsedTier = gradeTier
        logCine({
          phase: "ffmpeg_stitch_attempt",
          gradeTier,
          status: "ok",
          usedFallbackFromPremium: gradeTier !== "premium",
          pass: passLabel,
        })
        return true
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        lastStitchError = err instanceof Error ? err : new Error(msg)
        logCine({
          phase: "ffmpeg_stitch_attempt",
          gradeTier,
          status: "failed",
          stderrTail: msg.slice(0, 1200),
          pass: passLabel,
        })
        try {
          if (fs.existsSync(out)) fs.unlinkSync(out)
        } catch {
          /* ignore */
        }
      }
    }
    return false
  }

  while (extensionPass < 3) {
    const ok = await runStitchPass(timeline, `extend_${extensionPass}`)
    if (!ok) break
    const stat = fs.statSync(out)
    let probeQuick: StitchProbeResult
    try {
      probeQuick = await probeStitchOutput(out)
    } catch {
      probeQuick = { durationSec: 0, width: null, height: null, nbFrames: null }
    }
    const bytesPerSec = fastPreview
      ? Math.floor(STITCH_MIN_BYTES_PER_SEC * 0.85)
      : STITCH_MIN_BYTES_PER_SEC
    const scaledMin = Math.max(
      STITCH_ABSOLUTE_MIN_BYTES,
      Math.floor(probeQuick.durationSec * bytesPerSec)
    )
    const tooShort =
      probeQuick.durationSec < STITCH_RECOVERY_MIN_DURATION_SEC ||
      stat.size < scaledMin * 0.82

    if (!tooShort) break

    extensionPass++
    logCine({
      phase: "cinematic_stitch_extend",
      pass: extensionPass,
      probedDurationSec: probeQuick.durationSec,
      sizeBytes: stat.size,
      scaledMinBytes: scaledMin,
    })
    try {
      if (fs.existsSync(out)) fs.unlinkSync(out)
    } catch {
      /* ignore */
    }
    const extendFloor = npaiNarrativeStrict
      ? stitchMinTotal + extensionPass * 4
      : MIN_FINAL_DURATION_SEC + extensionPass * 4
    timeline = expandTimelineToMinTotal(
      timeline,
      baseSpan,
      extendFloor,
      shortCapture,
      npaiNarrativeStrict
    )
    outputDuration = sumTimelineDurations(timeline)
  }

  if (!stitchUsedTier) {
    const tail = lastStitchError?.message?.slice(0, 900) ?? "unknown"
    logCine({
      phase: "ffmpeg_cinematic_stitch",
      status: "failed_all_tiers",
      tiersTried: stitchTiers,
      lastErrorTail: tail,
    })
    throw new Error(
      `[AD_FFMPEG:cinematic_stitch] All stitch grade tiers failed (${stitchTiers.join(", ")}). Last FFmpeg stderr (truncated): ${tail}`
    )
  }

  logCine({
    phase: "ffmpeg_cinematic_stitch",
    status: "end",
    durationMs: Date.now() - tFf,
    gradeTier: stitchUsedTier,
    gradeChain: gradeTierLabel(stitchUsedTier),
    extensionPasses: extensionPass,
    outputDurationSec: outputDuration,
    npaiNarrativeStrict,
    stitchMinTotalSec: npaiNarrativeStrict ? stitchMinTotal : null,
  })
  opts?.onPhase?.("ffmpeg_stitch_end")

  const stat = fs.statSync(out)
  await assertStitchedOutputValid({
    outPath: out,
    sizeBytes: stat.size,
    safeTargetSec: outputDuration,
    capDurSec: capDur,
    fastPreview,
    logCine,
    allowDegradedShort: extensionPass >= 1,
    minProbedDurationSec: npaiNarrativeStrict ? MIN_NPAI_FINAL_DURATION_SEC : undefined,
  })

  return {
    finalVideo: out,
    metadata: {
      durationRequested: outputDuration,
      buildTimeMs: Date.now() - start,
      captureDuration: capDur,
      platform: platformType,
      width: w,
      height: h,
      fps,
      sceneCount: timeline.length,
      encoder: "libx264",
      pagesVisited: capture.pagesVisited,
      ...(npaiResolvedMeta ? { novaPulseAI: npaiResolvedMeta } : {}),
    }
  }
}