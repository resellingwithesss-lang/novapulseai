import type { Page, Route } from "@playwright/test"
import type { BrandVoiceDto, WorkspaceDto } from "../../client/src/lib/workflowApi"
import { makeBrandVoiceDto, makeWorkspaceDto } from "./api-response-factories"
import { E2E_STUB_BRAND_VOICE_ID, E2E_STUB_WORKSPACE_ID } from "./stub-constants"

export { E2E_STUB_BRAND_VOICE_ID, E2E_STUB_WORKSPACE_ID } from "./stub-constants"

const limitsBlock = {
  maxWorkspaces: 10,
  maxBrandVoices: 10,
  maxContentPacks: 10,
}

function fulfillJson(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  })
}

function isExactApiPath(url: string, segment: "workspaces" | "brand-voices") {
  try {
    const p = new URL(url).pathname.replace(/\/$/, "")
    return p === `/api/${segment}`
  } catch {
    return false
  }
}

export type WorkflowApiStubOptions = {
  /** When true, list endpoints return one workspace + one brand voice without POST. */
  preloadEntities?: boolean
}

/**
 * In-memory stubs for POST/GET /api/workspaces and /api/brand-voices so the
 * funnel does not depend on DB health or plan gates for those writes.
 */
export function installWorkflowApiStubs(page: Page, options?: WorkflowApiStubOptions) {
  let workspace: WorkspaceDto | null = options?.preloadEntities ? makeWorkspaceDto() : null
  let brandVoice: BrandVoiceDto | null = options?.preloadEntities ? makeBrandVoiceDto() : null

  page.route(
    (url) => isExactApiPath(url, "workspaces"),
    async (route) => {
      const method = route.request().method()
      if (method === "GET") {
        await fulfillJson(route, 200, {
          success: true,
          workspaces: workspace ? [workspace] : [],
          limits: limitsBlock,
        })
        return
      }
      if (method === "POST") {
        let body: Record<string, unknown> = {}
        try {
          body = route.request().postDataJSON() as Record<string, unknown>
        } catch {
          body = {}
        }
        workspace = makeWorkspaceDto({
          name: String(body.name ?? "E2E Workspace"),
          niche: String(body.niche ?? ""),
          targetAudience: String(body.targetAudience ?? ""),
          primaryPlatforms: Array.isArray(body.primaryPlatforms)
            ? (body.primaryPlatforms as string[])
            : [],
          contentGoals: Array.isArray(body.contentGoals)
            ? (body.contentGoals as string[])
            : [],
          defaultCtaStyle: String(body.defaultCtaStyle ?? ""),
        })
        await fulfillJson(route, 200, {
          success: true,
          workspace,
        })
        return
      }
      await route.continue()
    }
  )

  page.route(
    (url) => isExactApiPath(url, "brand-voices"),
    async (route) => {
      const method = route.request().method()
      if (method === "GET") {
        await fulfillJson(route, 200, {
          success: true,
          brandVoices: brandVoice ? [brandVoice] : [],
          limits: limitsBlock,
        })
        return
      }
      if (method === "POST") {
        let body: Record<string, unknown> = {}
        try {
          body = route.request().postDataJSON() as Record<string, unknown>
        } catch {
          body = {}
        }
        const wsId = body.workspaceId ? String(body.workspaceId) : null
        brandVoice = makeBrandVoiceDto({
          workspaceId: wsId && wsId.length >= 5 ? wsId : null,
          name: String(body.name ?? "E2E Brand Voice"),
          tone: String(body.tone ?? ""),
          pacing: String(body.pacing ?? ""),
          slangLevel: String(body.slangLevel ?? ""),
          ctaStyle: String(body.ctaStyle ?? ""),
          bannedPhrases: body.bannedPhrases ?? [],
          audienceSophistication: String(body.audienceSophistication ?? ""),
          notes: String(body.notes ?? ""),
        })
        await fulfillJson(route, 200, {
          success: true,
          brandVoice,
        })
        return
      }
      await route.continue()
    }
  )
}
