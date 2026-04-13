import { countPackPayloadLines } from "@/lib/contentPackPayload"
import type { ContentPackDto } from "@/lib/workflowApi"

/** Higher = better default pick when you have several packs. Intentionally simple. */
export function packDecisionScore(p: ContentPackDto): number {
  const n = countPackPayloadLines(p.payload).total
  const scoped = (p.workspaceId ? 4 : 0) + (p.brandVoiceId ? 2 : 0)
  const ageDays = Math.floor((Date.now() - new Date(p.updatedAt).getTime()) / 86_400_000)
  const recency = Math.max(0, 10 - ageDays)
  return n * 8 + scoped + recency
}

/** Pick one “best bet” pack id for a subtle badge; returns null when nothing stands out. */
export function bestPackCandidateId(packs: ContentPackDto[]): string | null {
  if (packs.length < 2) return null
  let best: ContentPackDto | null = null
  let bestScore = -1
  for (const p of packs) {
    const s = packDecisionScore(p)
    if (s > bestScore) {
      bestScore = s
      best = p
    } else if (s === bestScore && best) {
      if (new Date(p.updatedAt) > new Date(best.updatedAt)) best = p
    }
  }
  if (!best) return null
  const lines = countPackPayloadLines(best.payload).total
  if (lines === 0 && bestScore < 12) return null
  return best.id
}

export function sortPacksForDisplay(packs: ContentPackDto[]): ContentPackDto[] {
  return [...packs].sort((a, b) => {
    const d = packDecisionScore(b) - packDecisionScore(a)
    if (d !== 0) return d
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}
