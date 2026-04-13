import path from "path"
import fs from "fs"

export interface BrollOptions {
  tone: string
  duration: number
  platform: "tiktok" | "instagram" | "youtube"
  energyLevel?: 1 | 2 | 3 | 4 | 5
  pacing?: "fast" | "medium" | "slow"
  motionIntensity?: 1 | 2 | 3 | 4 | 5
  allowRepeats?: boolean
  biasTags?: string[]
}

interface BrollFileMeta {
  path: string
  filename: string
  tags: string[]
  totalScore: number
}

const EXT = ".mp4"
const CACHE = new Map<string, string[]>()

const TAG_KEYWORDS = [
  "saas", "ui", "dashboard", "laptop", "phone", "typing", "code", "team",
  "meeting", "creator", "ugc", "talking", "face", "abstract", "cinematic",
  "neon", "gradient", "growth", "metrics", "chart", "social", "tiktok",
  "reels", "youtube", "dynamic", "static", "pan", "zoom", "macro", "closeup",
  "startup", "workspace", "desktop", "mobile", "office", "product", "screen",
  "tech", "demo", "pricing", "login", "tools"
]

const PLATFORM_TAG_HINTS: Record<BrollOptions["platform"], string[]> = {
  tiktok: ["phone", "ugc", "creator", "social", "dynamic", "closeup", "mobile"],
  instagram: ["phone", "reels", "social", "cinematic", "closeup", "gradient"],
  youtube: ["laptop", "dashboard", "metrics", "team", "meeting", "cinematic", "desktop"]
}

const TONE_HINTS: Record<string, string[]> = {
  aggressive: ["dynamic", "zoom", "pan", "social", "creator", "closeup"],
  emotional: ["face", "ugc", "talking", "team", "meeting", "creator"],
  clean: ["ui", "dashboard", "metrics", "chart", "desktop", "screen"],
  cinematic: ["cinematic", "neon", "gradient", "macro", "closeup"],
  luxury: ["cinematic", "macro", "closeup", "gradient", "abstract"],
  funny: ["ugc", "creator", "talking", "social"],
  dramatic: ["cinematic", "closeup", "macro", "neon"],
  educational: ["screen", "dashboard", "ui", "laptop", "code"],
  storytelling: ["team", "meeting", "face", "talking", "workspace"],
  minimal: ["ui", "dashboard", "static", "desktop"]
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function getAssetFolder(): string {
  return path.resolve("./assets/broll")
}

function normalizeToken(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function uniqueStrings(values: string[] | undefined): string[] {
  return [...new Set((values || []).map(normalizeToken).filter(Boolean))]
}

function tokenizeFilename(file: string): string[] {
  if (CACHE.has(file)) {
    return CACHE.get(file)!
  }

  const base = path.basename(file, path.extname(file)).toLowerCase()
  const normalized = normalizeToken(base)
  const parts = normalized.split(/\s+/g).filter(Boolean)
  const tags = new Set<string>(parts)

  for (const keyword of TAG_KEYWORDS) {
    if (base.includes(keyword)) {
      tags.add(keyword)
    }
  }

  const output = [...tags]
  CACHE.set(file, output)
  return output
}

function determineClipCount(
  duration: number,
  platform: BrollOptions["platform"],
  pacing?: BrollOptions["pacing"]
): number {
  const d = clamp(duration, 5, 180)
  let base =
    d <= 12 ? 1 :
    d <= 20 ? 2 :
    d <= 30 ? 3 :
    d <= 45 ? 4 :
    d <= 60 ? 5 :
    d <= 90 ? 6 : 7

  if (platform === "youtube") base += 1
  if (pacing === "fast") base += 1
  if (pacing === "slow") base -= 1

  return clamp(base, 1, 10)
}

function scoreFile(
  file: string,
  opts: BrollOptions,
  selected: BrollFileMeta[]
): BrollFileMeta {
  const tags = tokenizeFilename(file)
  let totalScore = 0
  const tone = normalizeToken(opts.tone)
  const toneHints = TONE_HINTS[tone] || []
  const platformHints = PLATFORM_TAG_HINTS[opts.platform]
  const bias = uniqueStrings(opts.biasTags)

  if (tags.includes(tone)) totalScore += 4
  for (const t of toneHints) if (tags.includes(t)) totalScore += 1
  for (const t of platformHints) if (tags.includes(t)) totalScore += 1
  for (const t of bias) if (tags.includes(t)) totalScore += 2

  if ((opts.energyLevel || 0) >= 4) {
    if (tags.includes("dynamic")) totalScore += 2
    if (tags.includes("zoom")) totalScore += 1
    if (tags.includes("pan")) totalScore += 1
  }

  if ((opts.motionIntensity || 0) >= 4) {
    if (tags.includes("dynamic")) totalScore += 2
    if (tags.includes("pan")) totalScore += 1
    if (tags.includes("zoom")) totalScore += 1
  }

  if ((opts.energyLevel || 0) <= 2) {
    if (tags.includes("static")) totalScore += 2
    if (tags.includes("cinematic")) totalScore += 1
  }

  for (const existing of selected) {
    const overlap = tags.filter(t => existing.tags.includes(t)).length
    if (overlap >= 4) totalScore -= 2
    else if (overlap >= 2) totalScore -= 1
  }

  if (tags.length <= 2) totalScore -= 1

  return {
    path: file,
    filename: path.basename(file),
    tags,
    totalScore
  }
}

function introScore(meta: BrollFileMeta): number {
  return (
    (meta.tags.includes("dynamic") ? 3 : 0) +
    (meta.tags.includes("zoom") ? 2 : 0) +
    (meta.tags.includes("pan") ? 2 : 0)
  )
}

function outroScore(meta: BrollFileMeta): number {
  return (
    (meta.tags.includes("cinematic") ? 3 : 0) +
    (meta.tags.includes("macro") ? 1 : 0) +
    (meta.tags.includes("closeup") ? 1 : 0) +
    (meta.tags.includes("static") ? 1 : 0)
  )
}

function sequenceClips(clips: BrollFileMeta[], pacing?: BrollOptions["pacing"]): BrollFileMeta[] {
  if (clips.length <= 2) return clips

  const intro = [...clips].sort((a, b) => introScore(b) - introScore(a) || b.totalScore - a.totalScore)[0]
  const rem1 = clips.filter(c => c.filename !== intro.filename)
  const outro = [...rem1].sort((a, b) => outroScore(b) - outroScore(a) || b.totalScore - a.totalScore)[0]
  const middle = rem1.filter(c => c.filename !== outro.filename)

  if (pacing === "fast") middle.sort((a, b) => b.totalScore - a.totalScore)
  else if (pacing === "slow") middle.sort((a, b) => outroScore(a) - outroScore(b))
  else middle.splice(0, middle.length, ...shuffle(middle))

  return [intro, ...middle, outro]
}

export async function generateBroll(opts: BrollOptions): Promise<string[]> {
  const folder = getAssetFolder()
  if (!fs.existsSync(folder)) return []

  const files = fs.readdirSync(folder)
    .filter(f => f.toLowerCase().endsWith(EXT))
    .map(f => path.join(folder, f))

  if (!files.length) return []

  const clipCount = determineClipCount(opts.duration, opts.platform, opts.pacing)
  const selected: BrollFileMeta[] = []
  const used = new Set<string>()
  const remaining = [...files]

  while (selected.length < clipCount && remaining.length > 0) {
    const rescored = remaining
      .filter(file => opts.allowRepeats || !used.has(path.basename(file)))
      .map(file => scoreFile(file, opts, selected))
      .sort((a, b) => b.totalScore - a.totalScore)

    const best = rescored[0]
    if (!best) break

    selected.push(best)
    used.add(best.filename)

    const idx = remaining.findIndex(file => path.basename(file) === best.filename)
    if (idx >= 0) remaining.splice(idx, 1)
  }

  if (selected.length < clipCount) {
    for (const file of shuffle(files)) {
      const name = path.basename(file)
      if (!opts.allowRepeats && used.has(name)) continue
      selected.push(scoreFile(file, opts, selected))
      used.add(name)
      if (selected.length >= clipCount) break
    }
  }

  return sequenceClips(selected, opts.pacing).slice(0, clipCount).map(c => c.path)
}