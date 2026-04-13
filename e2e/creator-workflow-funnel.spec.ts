/**
 * Creator activation funnel: workspace → brand voice → content pack → video script
 * handoff → continuity back to packs / library.
 *
 * Network: `installWorkflowApiStubs` + `installContentPackApiStubs` avoid relying on
 * DB writes / OpenAI for those resources (registration still hits the real auth API).
 *
 * Setup: Next (e.g. :3000) with API reachable via rewrites, same as other auth e2e specs.
 */
import { test, expect, type Page } from "@playwright/test"
import { registerTestUser } from "./helpers/register-user"
import {
  E2E_STUB_CONTENT_PACK_ID,
  installContentPackApiStubs,
} from "./helpers/content-pack-api-stub"
import {
  E2E_STUB_BRAND_VOICE_ID,
  E2E_STUB_WORKSPACE_ID,
  installWorkflowApiStubs,
} from "./helpers/workflow-api-stub"

test.describe.configure({ mode: "serial" })

function navMain(page: Page) {
  return page.locator('nav[aria-label="Main"]')
}

/** First text span inside NavLink (active routes get `text-white`). */
async function expectNavLinkActive(page: Page, href: string) {
  const link = navMain(page).locator(`a[href="${href}"]`)
  await expect(link.locator("span").first()).toHaveClass(/text-white/)
}

test.describe("Creator workflow funnel", () => {
  test("register → workspace → brand voice → stubbed pack → video handoff → continuity", async ({
    page,
  }) => {
    installWorkflowApiStubs(page)
    installContentPackApiStubs(page)

    await registerTestUser(page)
    if (/\/pricing/.test(page.url())) {
      await page.goto("/dashboard")
    }
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
    await expect(page.getByRole("heading", { name: "Studio" })).toBeVisible({
      timeout: 20_000,
    })

    await page.goto("/dashboard/workspaces")
    await expect(
      page.getByRole("heading", { name: "Workspaces", exact: true })
    ).toBeVisible()
    await page.getByPlaceholder("e.g. Skincare UGC").fill("E2E Workspace")
    await page.getByRole("button", { name: "Create workspace" }).click()
    await expect(page.getByText("E2E Workspace").first()).toBeVisible({
      timeout: 20_000,
    })

    await page.goto("/dashboard/brand-voices")
    await expect(page.getByRole("heading", { name: "Brand voice presets" })).toBeVisible()
    const brandForm = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "New brand voice" }) })
    await brandForm.getByRole("textbox").first().fill("E2E Brand Voice")
    await brandForm.getByRole("combobox").first().selectOption({ label: "E2E Workspace" })
    await brandForm.getByRole("button", { name: "Create brand voice" }).click()
    await expect(page.getByText("E2E Brand Voice").first()).toBeVisible({
      timeout: 20_000,
    })

    await page.goto("/dashboard/content-packs")
    await expect(page.getByRole("heading", { name: "Content packs" })).toBeVisible()
    const packGen = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Pack generator" }) })
    await packGen.getByRole("combobox").first().selectOption({ label: "E2E Workspace" })
    await packGen.getByRole("combobox").nth(1).selectOption({ label: "E2E Brand Voice" })
    await packGen.getByPlaceholder("What is this batch about?").fill("E2E funnel topic for stubbed pack")
    await page.getByRole("button", { name: "Generate & save pack" }).click()
    await expect(page.getByRole("link", { name: "E2E stub pack" })).toBeVisible({
      timeout: 25_000,
    })

    await page.getByRole("link", { name: "E2E stub pack" }).click()
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/content-packs/${E2E_STUB_CONTENT_PACK_ID}`)
    )
    await expect(page.getByRole("heading", { name: "E2E stub pack" })).toBeVisible()
    await expect(page.getByText("E2E funnel topic for stubbed pack")).toBeVisible()

    await page.getByRole("link", { name: "Use in video script" }).first().click()
    await expect(page).toHaveURL(/\/dashboard\/tools\/video/, { timeout: 20_000 })

    const handoffUrl = new URL(page.url())
    expect(handoffUrl.searchParams.get("topic")).toContain("E2E hook line for video script handoff")
    expect(handoffUrl.searchParams.get("mode")).toBe("video")
    expect(handoffUrl.searchParams.get("sourceContentPackId")).toBe(E2E_STUB_CONTENT_PACK_ID)
    expect(handoffUrl.searchParams.get("sourceType")).toBe("CONTENT_PACK")
    const wsFromUrl = handoffUrl.searchParams.get("workspaceId")
    const bvFromUrl = handoffUrl.searchParams.get("brandVoiceId")
    expect(wsFromUrl).toBe(E2E_STUB_WORKSPACE_ID)
    expect(bvFromUrl).toBe(E2E_STUB_BRAND_VOICE_ID)

    await expect(page.getByRole("heading", { level: 1, name: "Video Script Engine" })).toBeVisible()
    await expect(page.locator("main[data-npai-tool]")).toHaveAttribute("data-npai-tool", "video-script")
    await expect(page.getByPlaceholder("Enter your viral topic...")).toHaveValue(
      /E2E hook line for video script handoff/
    )
    const videoMain = page.locator('main[data-npai-tool="video-script"]')
    await expect(videoMain.getByRole("combobox").nth(0)).toHaveValue(wsFromUrl!)
    await expect(videoMain.getByRole("combobox").nth(1)).toHaveValue(bvFromUrl!)

    await expectNavLinkActive(page, "/dashboard/tools")

    await page.goto("/dashboard/content-packs")
    await expect(page.getByRole("link", { name: "E2E stub pack" })).toBeVisible()

    await page.goto("/dashboard/library")
    await expect(page).toHaveURL(/\/dashboard\/library/)
    await expect(page.getByRole("heading", { name: "Content library" })).toBeVisible()
    await expectNavLinkActive(page, "/dashboard/library")
    await expect(page.getByRole("option", { name: "E2E Workspace" })).toBeAttached()
  })
})
