/**
 * Typed JSON bodies for Playwright route stubs — mirrors client DTOs / API envelopes
 * so drift is caught by TypeScript when shapes change.
 */
import type { ActivityContentPackRow, ActivityGenerationRow } from "../../client/src/lib/activityApi"
import type {
  BrandVoiceDto,
  ContentPackDto,
  WorkspaceDto,
} from "../../client/src/lib/workflowApi"
import {
  E2E_STUB_BRAND_VOICE_ID,
  E2E_STUB_CONTENT_PACK_ID,
  E2E_STUB_GENERATION_ID,
  E2E_STUB_WORKSPACE_ID,
} from "./stub-constants"

export function isoNow(): string {
  return new Date().toISOString()
}

export function makeWorkspaceDto(overrides: Partial<WorkspaceDto> = {}): WorkspaceDto {
  const t = isoNow()
  return {
    id: E2E_STUB_WORKSPACE_ID,
    name: "E2E Workspace",
    niche: "",
    targetAudience: "",
    primaryPlatforms: [],
    contentGoals: [],
    defaultCtaStyle: "",
    createdAt: t,
    updatedAt: t,
    ...overrides,
  }
}

export function makeBrandVoiceDto(overrides: Partial<BrandVoiceDto> = {}): BrandVoiceDto {
  const t = isoNow()
  return {
    id: E2E_STUB_BRAND_VOICE_ID,
    workspaceId: E2E_STUB_WORKSPACE_ID,
    name: "E2E Brand Voice",
    tone: "",
    pacing: "",
    slangLevel: "",
    ctaStyle: "",
    bannedPhrases: [],
    audienceSophistication: "",
    notes: "",
    createdAt: t,
    updatedAt: t,
    ...overrides,
  }
}

export type ContentPackPayload = {
  hooks: string[]
  scripts: string[]
  titles: string[]
  captions: string[]
  ctas: string[]
  clipAngles: string[]
}

export function defaultContentPackPayload(): ContentPackPayload {
  return {
    hooks: ["E2E hook line for video script handoff"],
    scripts: [
      "E2E script seed line one",
      "E2E script seed line two",
      "E2E script seed line three",
    ],
    titles: ["T1", "T2", "T3"],
    captions: ["C1", "C2", "C3"],
    ctas: ["CTA1", "CTA2", "CTA3"],
    clipAngles: ["A1", "A2", "A3"],
  }
}

export function makeContentPackDto(overrides: Partial<ContentPackDto> = {}): ContentPackDto {
  const t = isoNow()
  const topic = overrides.topic ?? "E2E funnel topic for stubbed pack"
  return {
    id: E2E_STUB_CONTENT_PACK_ID,
    workspaceId: overrides.workspaceId ?? E2E_STUB_WORKSPACE_ID,
    brandVoiceId: overrides.brandVoiceId ?? E2E_STUB_BRAND_VOICE_ID,
    title: overrides.title ?? "E2E stub pack",
    topic,
    platform: overrides.platform ?? "TikTok",
    audience: overrides.audience ?? "",
    payload: overrides.payload ?? defaultContentPackPayload(),
    status: "READY",
    createdAt: t,
    updatedAt: t,
    ...overrides,
  }
}

export function makeActivityGenerationRow(
  overrides: Partial<ActivityGenerationRow> = {}
): ActivityGenerationRow {
  const t = isoNow()
  return {
    id: E2E_STUB_GENERATION_ID,
    type: "VIDEO",
    inputPreview: "E2E lineage topic from content pack",
    creditsUsed: 1,
    durationMs: 1200,
    requestId: "e2e_req_lineage",
    createdAt: t,
    modelUsed: "stub",
    workspaceId: E2E_STUB_WORKSPACE_ID,
    workspaceName: "E2E Workspace",
    brandVoiceId: E2E_STUB_BRAND_VOICE_ID,
    brandVoiceName: "E2E Brand Voice",
    contentPackId: E2E_STUB_CONTENT_PACK_ID,
    contentPackTitle: "E2E stub pack",
    sourceGenerationId: null,
    sourceType: "CONTENT_PACK",
    ...overrides,
  }
}

export function makeActivityContentPackRow(
  overrides: Partial<ActivityContentPackRow> = {}
): ActivityContentPackRow {
  const t = isoNow()
  const title = overrides.title ?? "E2E stub pack"
  return {
    id: E2E_STUB_CONTENT_PACK_ID,
    kind: "CONTENT_PACK",
    title,
    topicPreview: "E2E funnel topic for stubbed pack",
    platform: "TikTok",
    audience: "",
    status: "READY",
    createdAt: t,
    updatedAt: t,
    workspaceId: E2E_STUB_WORKSPACE_ID,
    workspaceName: "E2E Workspace",
    brandVoiceId: E2E_STUB_BRAND_VOICE_ID,
    brandVoiceName: "E2E Brand Voice",
    contentPackId: E2E_STUB_CONTENT_PACK_ID,
    contentPackTitle: title,
    ...overrides,
  }
}
