import { prisma } from "../../lib/prisma"

export type PersistedAdJobMetadata = {
  siteUrl?: string
  editingStyle?: string
  ultra?: boolean
  voice?: string
  rerenderOfJobId?: string
  sourceJobId?: string
  sourceVariantId?: string
  rerenderReason?: string
  rerenderSourceDbId?: string
  /** Stored on lineage root only: public `jobId` of the operator-chosen preferred output. */
  operatorPreferredJobId?: string | null
  operatorApproved?: boolean
  operatorFavorite?: boolean
  /** Creative pipeline: default cinematic product-commercial; `ugc_social` = short-form native style. */
  creativeMode?: "cinematic" | "ugc_social"
  /** Opt-in fast preview / dev capture+encode (see AD_FAST_PREVIEW, previewMode). */
  fastPreview?: boolean
  /** Optional operator notes from Admin Ad Studio / API (audit + handoff). */
  operatorBrief?: string
  /** Ad Studio high-level creative mode (drives LLM + variant order). */
  studioCreativeModeId?: string
  /** Final ffmpeg caption / overlay packaging preset. */
  videoPackaging?: string
  /** Optional #RRGGBB without hash — caption accent (e.g. streamer / brand hint). */
  captionAccentHex?: string
  /** ai_openai_tts = real OpenAI speech; silent_music_only = no VO, music bed only. */
  voiceMode?: "ai_openai_tts" | "silent_music_only"
  /** How many top-scored variants to render (1 default). */
  renderTopVariants?: 1 | 2
  /** Completed (or failed) renders when `renderTopVariants` > 1. Primary `outputUrl` stays rank 1. */
  renderedVariants?: Array<{
    variantId: string
    rank: 1 | 2
    outputUrl?: string
    score?: number
    status: "completed" | "failed"
    failedReason?: string
    fileSizeBytes?: number
  }>
}

export function readJobMetadata(job: { metadata: unknown }): PersistedAdJobMetadata {
  const m = job.metadata
  if (!m || typeof m !== "object") return {}
  return m as PersistedAdJobMetadata
}

export async function findRootJobRow(startPublicJobId: string): Promise<{
  id: string
  jobId: string
  metadata: unknown
}> {
  let walkId = startPublicJobId
  for (let i = 0; i < 24; i++) {
    const row = await prisma.adJob.findFirst({
      where: { jobId: walkId },
      select: { id: true, jobId: true, metadata: true },
    })
    if (!row) {
      throw new Error("JOB_NOT_FOUND")
    }
    const m = readJobMetadata({ metadata: row.metadata })
    const p = m.rerenderOfJobId
    if (!p || typeof p !== "string") {
      return row
    }
    walkId = p
  }
  const fallback = await prisma.adJob.findFirst({
    where: { jobId: startPublicJobId },
    select: { id: true, jobId: true, metadata: true },
  })
  if (!fallback) {
    throw new Error("JOB_NOT_FOUND")
  }
  return fallback
}
