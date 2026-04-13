import type { Page, Route } from "@playwright/test"
import type { ContentPackDto } from "../../client/src/lib/workflowApi"
import { makeContentPackDto } from "./api-response-factories"
import { E2E_STUB_CONTENT_PACK_ID } from "./stub-constants"

export { E2E_STUB_CONTENT_PACK_ID } from "./stub-constants"

export type ContentPackApiStubOptions = {
  /** When set, list/detail work without calling POST /generate first. */
  seedPack?: ContentPackDto
}

/**
 * Stubs POST /api/content-packs/generate plus GET list/detail so the UI can list
 * and open a pack without OpenAI or DB persistence.
 */
export function installContentPackApiStubs(page: Page, options?: ContentPackApiStubOptions) {
  let stubPack: ContentPackDto | null = options?.seedPack ?? null

  const fulfillJson = (route: Route, status: number, body: unknown) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    })

  page.route("**/api/content-packs/generate", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    let body: {
      topic?: string
      platform?: string
      audience?: string
      workspaceId?: string
      brandVoiceId?: string
    } = {}
    try {
      body = route.request().postDataJSON() as typeof body
    } catch {
      body = {}
    }
    stubPack = makeContentPackDto({
      topic: body.topic ?? "",
      platform: body.platform ?? "TikTok",
      audience: body.audience ?? "",
      workspaceId: body.workspaceId ?? null,
      brandVoiceId: body.brandVoiceId ?? null,
    })
    await fulfillJson(route, 200, {
      success: true,
      contentPack: stubPack,
    })
  })

  page.route(
    (url) => {
      try {
        const u = new URL(url)
        const path = u.pathname.replace(/\/$/, "")
        return path === "/api/content-packs"
      } catch {
        return false
      }
    },
    async (route) => {
      if (route.request().method() !== "GET") return route.continue()
      await fulfillJson(route, 200, {
        success: true,
        contentPacks: stubPack ? [stubPack] : [],
      })
    }
  )

  page.route(`**/api/content-packs/${E2E_STUB_CONTENT_PACK_ID}**`, async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    if (!stubPack) {
      await fulfillJson(route, 404, { success: false, message: "Not found" })
      return
    }
    await fulfillJson(route, 200, {
      success: true,
      contentPack: stubPack,
    })
  })
}
