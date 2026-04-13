import { api, ApiError } from "@/lib/api"

export type WorkflowLimitsDto = {
  maxWorkspaces: number
  maxBrandVoices: number
  maxContentPacks: number
}

export type WorkspaceUsageDto = {
  voiceCount: number
  contentPackCount: number
  generationCount: number
  adJobCount: number
  linkedTotal: number
  lastArtifactAt: string | null
}

export const emptyWorkspaceUsage = (): WorkspaceUsageDto => ({
  voiceCount: 0,
  contentPackCount: 0,
  generationCount: 0,
  adJobCount: 0,
  linkedTotal: 0,
  lastArtifactAt: null,
})

export type WorkspaceDto = {
  id: string
  name: string
  niche: string
  targetAudience: string
  primaryPlatforms: string[]
  contentGoals: string[]
  defaultCtaStyle: string
  createdAt: string
  updatedAt: string
  /** Present from list/create/patch; older clients may omit. */
  usage?: WorkspaceUsageDto
}

export type BrandVoiceDto = {
  id: string
  workspaceId: string | null
  name: string
  tone: string
  pacing: string
  slangLevel: string
  ctaStyle: string
  bannedPhrases: unknown
  audienceSophistication: string
  notes: string
  createdAt: string
  updatedAt: string
}

export type ContentPackDto = {
  id: string
  workspaceId: string | null
  brandVoiceId: string | null
  title: string
  topic: string
  platform: string
  audience: string
  payload: unknown
  status: string
  createdAt: string
  updatedAt: string
}

type SummaryEnvelope = {
  success?: boolean
  counts?: {
    workspaces: number
    brandVoices: number
    contentPacks: number
  }
  limits?: WorkflowLimitsDto
}

export async function fetchWorkflowSummary(): Promise<SummaryEnvelope | null> {
  try {
    return await api.get<SummaryEnvelope>("/workflow/summary", {
      silent: true,
      cache: "no-store",
    })
  } catch {
    return null
  }
}

type ListWorkspacesEnvelope = {
  success?: boolean
  workspaces?: WorkspaceDto[]
  limits?: WorkflowLimitsDto
}

export async function fetchWorkspaces(): Promise<ListWorkspacesEnvelope> {
  return api.get<ListWorkspacesEnvelope>("/workspaces", {
    silent: true,
    cache: "no-store",
  })
}

type ListBrandVoicesEnvelope = {
  success?: boolean
  brandVoices?: BrandVoiceDto[]
  limits?: WorkflowLimitsDto
}

export async function fetchBrandVoices(): Promise<ListBrandVoicesEnvelope> {
  return api.get<ListBrandVoicesEnvelope>("/brand-voices", {
    silent: true,
    cache: "no-store",
  })
}

type ListPacksEnvelope = {
  success?: boolean
  contentPacks?: ContentPackDto[]
  limits?: WorkflowLimitsDto
}

export async function fetchContentPacks(): Promise<ListPacksEnvelope> {
  return api.get<ListPacksEnvelope>("/content-packs", {
    silent: true,
    cache: "no-store",
  })
}

export async function fetchContentPack(id: string): Promise<ContentPackDto | null> {
  try {
    const data = await api.get<{ success?: boolean; contentPack?: ContentPackDto }>(
      `/content-packs/${encodeURIComponent(id)}`,
      { silent: true, cache: "no-store" }
    )
    return data?.contentPack ?? null
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}

export async function createWorkspace(body: {
  name: string
  niche?: string
  targetAudience?: string
  primaryPlatforms?: string[]
  contentGoals?: string[]
  defaultCtaStyle?: string
}): Promise<WorkspaceDto> {
  const data = await api.post<{ success?: boolean; workspace?: WorkspaceDto }>(
    "/workspaces",
    body,
    { timeout: 30000 }
  )
  if (!data?.workspace) throw new Error("Invalid response")
  return data.workspace
}

export async function updateWorkspace(
  id: string,
  body: Partial<{
    name: string
    niche: string
    targetAudience: string
    primaryPlatforms: string[]
    contentGoals: string[]
    defaultCtaStyle: string
  }>
): Promise<WorkspaceDto> {
  const data = await api.patch<{ success?: boolean; workspace?: WorkspaceDto }>(
    `/workspaces/${encodeURIComponent(id)}`,
    body,
    { timeout: 30000 }
  )
  if (!data?.workspace) throw new Error("Invalid response")
  return data.workspace
}

export async function deleteWorkspace(id: string): Promise<void> {
  await api.delete(`/workspaces/${encodeURIComponent(id)}`, { timeout: 30000 })
}

export async function createBrandVoice(body: {
  workspaceId?: string
  name: string
  tone?: string
  pacing?: string
  slangLevel?: string
  ctaStyle?: string
  bannedPhrases?: string[] | string
  audienceSophistication?: string
  notes?: string
}): Promise<BrandVoiceDto> {
  const data = await api.post<{ success?: boolean; brandVoice?: BrandVoiceDto }>(
    "/brand-voices",
    body,
    { timeout: 30000 }
  )
  if (!data?.brandVoice) throw new Error("Invalid response")
  return data.brandVoice
}

export async function updateBrandVoice(
  id: string,
  body: Partial<{
    workspaceId: string | null
    name: string
    tone: string
    pacing: string
    slangLevel: string
    ctaStyle: string
    bannedPhrases: string[] | string
    audienceSophistication: string
    notes: string
  }>
): Promise<BrandVoiceDto> {
  const data = await api.patch<{ success?: boolean; brandVoice?: BrandVoiceDto }>(
    `/brand-voices/${encodeURIComponent(id)}`,
    body,
    { timeout: 30000 }
  )
  if (!data?.brandVoice) throw new Error("Invalid response")
  return data.brandVoice
}

export async function deleteBrandVoice(id: string): Promise<void> {
  await api.delete(`/brand-voices/${encodeURIComponent(id)}`, { timeout: 30000 })
}

export async function generateContentPack(body: {
  topic: string
  platform: string
  audience?: string
  workspaceId?: string
  brandVoiceId?: string
}): Promise<ContentPackDto> {
  const data = await api.post<{ success?: boolean; contentPack?: ContentPackDto }>(
    "/content-packs/generate",
    body,
    { timeout: 120000, retry: 0 }
  )
  if (!data?.contentPack) throw new Error("Invalid response")
  return data.contentPack
}
