import { api } from "@/lib/api"

export type ActivityGenerationRow = {
  id: string
  type: "VIDEO" | "STORY" | "VIDEO_BLUEPRINT"
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

export type ActivityAdJobRow = {
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

export type ActivityContentPackRow = {
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
  /** When API includes lineage for packs surfaced in activity feed. */
  sourceGenerationId?: string | null
  sourceType?: string | null
}

export type ActivityRecentPayload = {
  success: boolean
  generations: ActivityGenerationRow[]
  adJobs: ActivityAdJobRow[]
  contentPacks: ActivityContentPackRow[]
  requestId?: string
}

export type ActivityRecentQuery = {
  workspaceId?: string
  /** Comma-separated: generations, adJobs, contentPacks (aliases: jobs, packs). */
  sections?: string
  generationType?: "VIDEO" | "STORY" | "VIDEO_BLUEPRINT"
  generationsLimit?: number
  jobsLimit?: number
  contentPacksLimit?: number
}

export async function fetchActivityRecent(
  query?: ActivityRecentQuery
): Promise<ActivityRecentPayload | null> {
  try {
    const qs = new URLSearchParams()
    if (query?.workspaceId) qs.set("workspaceId", query.workspaceId)
    if (query?.sections) qs.set("sections", query.sections)
    if (query?.generationType) qs.set("generationType", query.generationType)
    if (query?.generationsLimit != null)
      qs.set("generationsLimit", String(query.generationsLimit))
    if (query?.jobsLimit != null) qs.set("jobsLimit", String(query.jobsLimit))
    if (query?.contentPacksLimit != null)
      qs.set("contentPacksLimit", String(query.contentPacksLimit))
    const suffix = qs.toString() ? `?${qs.toString()}` : ""
    const data = await api.get<ActivityRecentPayload>(`/activity/recent${suffix}`, {
      silent: true,
      cache: "no-store",
    })
    if (!data?.success) return null
    return {
      generations: data.generations ?? [],
      adJobs: data.adJobs ?? [],
      contentPacks: data.contentPacks ?? [],
      success: true,
      requestId: data.requestId,
    }
  } catch {
    return null
  }
}

export function generationTypeLabel(type: ActivityGenerationRow["type"]): string {
  switch (type) {
    case "VIDEO":
      return "Video scripts"
    case "STORY":
      return "Story"
    case "VIDEO_BLUEPRINT":
      return "Blueprint"
    default:
      return type
  }
}

export function generationToolHref(type: ActivityGenerationRow["type"]): string {
  switch (type) {
    case "VIDEO":
      return "/dashboard/tools/video"
    case "STORY":
      return "/dashboard/tools/story-maker"
    case "VIDEO_BLUEPRINT":
      return "/dashboard/tools/story-video-maker"
    default:
      return "/dashboard/tools/video"
  }
}
