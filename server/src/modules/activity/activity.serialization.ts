import type { GenerationType } from "@prisma/client"

/** Row shape after Prisma select + includes (library / recent API). */
export type ActivityGenerationDbRow = {
  id: string
  type: GenerationType
  input: string
  creditsUsed: number
  durationMs: number | null
  requestId: string | null
  createdAt: Date
  modelUsed: string | null
  workspaceId: string | null
  workspace: { name: string } | null
  brandVoiceId: string | null
  brandVoice: { id: string; name: string } | null
  sourceContentPackId: string | null
  sourceContentPack: { id: string; title: string } | null
  sourceGenerationId: string | null
  sourceType: string | null
}

export type ActivityGenerationDto = {
  id: string
  type: GenerationType
  inputPreview: string
  creditsUsed: number
  durationMs: number | null
  requestId: string | null
  createdAt: string
  modelUsed: string | null
  workspaceId: string | null
  workspaceName: string | null
  brandVoiceId: string | null
  brandVoiceName: string | null
  contentPackId: string | null
  contentPackTitle: string | null
  sourceGenerationId: string | null
  sourceType: string | null
}

export function serializeActivityGeneration(g: ActivityGenerationDbRow): ActivityGenerationDto {
  const inputPreview =
    g.input.length > 160 ? `${g.input.slice(0, 157).trimEnd()}…` : g.input
  return {
    id: g.id,
    type: g.type,
    inputPreview,
    creditsUsed: g.creditsUsed,
    durationMs: g.durationMs,
    requestId: g.requestId,
    createdAt: g.createdAt.toISOString(),
    modelUsed: g.modelUsed,
    workspaceId: g.workspaceId,
    workspaceName: g.workspace?.name ?? null,
    brandVoiceId: g.brandVoiceId,
    brandVoiceName: g.brandVoice?.name ?? null,
    contentPackId: g.sourceContentPack?.id ?? g.sourceContentPackId ?? null,
    contentPackTitle: g.sourceContentPack?.title ?? null,
    sourceGenerationId: g.sourceGenerationId,
    sourceType: g.sourceType,
  }
}

export type ActivityAdJobDbRow = {
  id: string
  jobId: string
  status: string
  progress: number
  platform: string
  duration: number
  tone: string
  outputUrl: string | null
  failedReason: string | null
  createdAt: Date
  updatedAt: Date
  workspaceId: string | null
  workspace: { name: string } | null
  sourceContentPackId: string | null
  sourceContentPack: { id: string; title: string } | null
  sourceGenerationId: string | null
  sourceType: string | null
}

export type ActivityAdJobDto = {
  id: string
  jobId: string
  status: string
  progress: number
  platform: string
  duration: number
  tone: string
  outputUrl: string | null
  failedReason: string | null
  createdAt: string
  updatedAt: string
  workspaceId: string | null
  workspaceName: string | null
  brandVoiceId: null
  brandVoiceName: null
  contentPackId: string | null
  contentPackTitle: string | null
  sourceGenerationId: string | null
  sourceType: string | null
}

export function serializeActivityAdJob(j: ActivityAdJobDbRow): ActivityAdJobDto {
  return {
    id: j.id,
    jobId: j.jobId,
    status: j.status,
    progress: j.progress,
    platform: j.platform,
    duration: j.duration,
    tone: j.tone,
    outputUrl: j.outputUrl,
    failedReason: j.failedReason,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
    workspaceId: j.workspaceId,
    workspaceName: j.workspace?.name ?? null,
    brandVoiceId: null,
    brandVoiceName: null,
    contentPackId: j.sourceContentPack?.id ?? j.sourceContentPackId ?? null,
    contentPackTitle: j.sourceContentPack?.title ?? null,
    sourceGenerationId: j.sourceGenerationId,
    sourceType: j.sourceType,
  }
}

export type ActivityContentPackDbRow = {
  id: string
  title: string
  topic: string
  platform: string
  audience: string
  status: string
  createdAt: Date
  updatedAt: Date
  workspaceId: string | null
  workspace: { name: string } | null
  brandVoiceId: string | null
  brandVoice: { id: string; name: string } | null
}

export type ActivityContentPackDto = {
  id: string
  kind: "CONTENT_PACK"
  title: string
  topicPreview: string
  platform: string
  audience: string
  status: string
  createdAt: string
  updatedAt: string
  workspaceId: string | null
  workspaceName: string | null
  brandVoiceId: string | null
  brandVoiceName: string | null
  contentPackId: string
  contentPackTitle: string
}

export function serializeActivityContentPack(p: ActivityContentPackDbRow): ActivityContentPackDto {
  const topicPreview =
    p.topic.length > 160 ? `${p.topic.slice(0, 157).trimEnd()}…` : p.topic
  return {
    id: p.id,
    kind: "CONTENT_PACK",
    title: p.title,
    topicPreview,
    platform: p.platform,
    audience: p.audience,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    workspaceId: p.workspaceId,
    workspaceName: p.workspace?.name ?? null,
    brandVoiceId: p.brandVoiceId,
    brandVoiceName: p.brandVoice?.name ?? null,
    contentPackId: p.id,
    contentPackTitle: p.title,
  }
}
