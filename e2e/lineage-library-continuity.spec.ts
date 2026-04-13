/**
 * Lineage + library: content pack → tool handoff → stubbed generation → library filters
 * show workspace / voice / pack context (workflow-memory layer).
 *
 * Auth is real; workflow, content packs, generation, and activity are stubbed.
 */
import { test, expect } from "@playwright/test"
import { makeContentPackDto } from "./helpers/api-response-factories"
import { installActivityRecentStub } from "./helpers/activity-api-stub"
import { installContentPackApiStubs } from "./helpers/content-pack-api-stub"
import { installGenerationApiStub } from "./helpers/generation-api-stub"
import { E2E_STUB_CONTENT_PACK_ID } from "./helpers/stub-constants"
import { installWorkflowApiStubs } from "./helpers/workflow-api-stub"
import { registerTestUser } from "./helpers/register-user"

test.describe.configure({ mode: "serial" })

test.describe("Lineage and library continuity", () => {
  test("pack detail → video handoff → generate → library filters show origin context", async ({
    page,
  }) => {
    installWorkflowApiStubs(page, { preloadEntities: true })
    installContentPackApiStubs(page, { seedPack: makeContentPackDto() })
    installActivityRecentStub(page)
    installGenerationApiStub(page)

    await registerTestUser(page)
    if (/\/pricing/.test(page.url())) {
      await page.goto("/dashboard")
    }
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 25_000 })

    await page.goto(`/dashboard/content-packs/${E2E_STUB_CONTENT_PACK_ID}`)
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/content-packs/${E2E_STUB_CONTENT_PACK_ID}`)
    )
    await expect(page.getByRole("heading", { name: "E2E stub pack" })).toBeVisible({
      timeout: 20_000,
    })

    await page.getByRole("link", { name: "Use in video script" }).first().click()
    await expect(page).toHaveURL(/\/dashboard\/tools\/video/, { timeout: 20_000 })
    await expect(page.getByRole("heading", { level: 1, name: "Video Script Engine" })).toBeVisible()
    const hint = page.getByTestId("npai-lineage-hint")
    await expect(hint).toBeVisible()
    await expect(hint).toContainText("CONTENT_PACK")
    await expect(hint).toContainText(E2E_STUB_CONTENT_PACK_ID)

    await page.getByRole("button", { name: /Generate Script/i }).click()
    await expect(page.getByText("E2E stub hook")).toBeVisible({ timeout: 20_000 })

    await page.goto("/dashboard/library")
    await expect(page).toHaveURL(/\/dashboard\/library/)
    await expect(page.getByRole("heading", { name: "Content library" })).toBeVisible()
    await expect(page.getByText("Loading server activity…")).toBeHidden({ timeout: 20_000 })

    await page.getByRole("combobox").nth(0).selectOption({ label: "E2E Workspace" })
    await page.getByRole("combobox").nth(1).selectOption({ label: "Video scripts" })

    await expect(page.getByRole("heading", { name: "Generated outputs" })).toBeVisible()
    await expect(page.getByText("E2E lineage topic from content pack")).toBeVisible()
    await expect(page.getByText("Project · E2E Workspace")).toBeVisible()
    await expect(page.getByText("Style preset · E2E Brand Voice")).toBeVisible()
    await expect(page.getByRole("link", { name: /From pack · E2E stub pack/i })).toBeVisible()
    await expect(page.getByText(/Sparked from a saved content pack batch/i)).toBeVisible()

    await page.getByRole("combobox").nth(1).selectOption({ label: "Content packs" })
    await expect(
      page.getByRole("heading", { name: "Content packs", exact: true })
    ).toBeVisible()
    await expect(page.getByText("E2E stub pack").first()).toBeVisible()
    await expect(page.getByText("Project · E2E Workspace").last()).toBeVisible()
  })
})
