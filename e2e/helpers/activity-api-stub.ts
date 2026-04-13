import type { Page, Route } from "@playwright/test"
import type { ActivityRecentPayload } from "../../client/src/lib/activityApi"
import { makeActivityContentPackRow, makeActivityGenerationRow } from "./api-response-factories"
import { E2E_STUB_WORKSPACE_ID } from "./stub-constants"

function fulfillJson(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  })
}

function parseSections(raw: string | null): {
  generations: boolean
  adJobs: boolean
  contentPacks: boolean
} {
  if (!raw?.trim()) {
    return { generations: true, adJobs: true, contentPacks: true }
  }
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return {
    generations: parts.includes("generations"),
    adJobs: parts.includes("adjobs") || parts.includes("jobs"),
    contentPacks: parts.includes("contentpacks") || parts.includes("packs"),
  }
}

const baseGen = makeActivityGenerationRow()
const basePackRow = makeActivityContentPackRow()

/**
 * Stubs GET /api/activity/recent with deterministic lineage rows (aligned with
 * workflow + content-pack stub ids).
 */
export function installActivityRecentStub(page: Page) {
  page.route(
    (url) => {
      try {
        const p = new URL(url).pathname.replace(/\/$/, "")
        return p === "/api/activity/recent"
      } catch {
        return false
      }
    },
    async (route) => {
      if (route.request().method() !== "GET") return route.continue()
      const u = new URL(route.request().url())
      const workspaceFilter = u.searchParams.get("workspaceId")?.trim() ?? ""
      const generationType = u.searchParams.get("generationType")?.toUpperCase() ?? ""
      const sections = parseSections(u.searchParams.get("sections"))

      const wsMismatch =
        workspaceFilter.length >= 5 && workspaceFilter !== E2E_STUB_WORKSPACE_ID

      const genTypeMismatch =
        Boolean(generationType) && generationType !== "VIDEO"

      let generations: typeof baseGen[] = []
      if (sections.generations && !wsMismatch && !genTypeMismatch) {
        generations = [baseGen]
      }

      const adJobs: ActivityRecentPayload["adJobs"] = []
      if (sections.adJobs && !wsMismatch) {
        /* empty — lineage spec focuses on generations + packs */
      }

      let contentPacks: typeof basePackRow[] = []
      if (sections.contentPacks && !wsMismatch) {
        contentPacks = [basePackRow]
      }

      const payload: ActivityRecentPayload = {
        success: true,
        generations,
        adJobs,
        contentPacks,
      }
      await fulfillJson(route, 200, payload)
    }
  )
}
