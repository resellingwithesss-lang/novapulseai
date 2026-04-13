import { test, expect } from "@playwright/test"
import { tools } from "../client/src/config/tools"
import { registerTestUser } from "./helpers/register-user"

test.describe("Authenticated tool workspaces", () => {
  test("tools hub (via /tools redirect) and every dashboard tool page load", async ({
    page,
  }) => {
    await registerTestUser(page)

    await page.goto("/tools")
    await expect(page).toHaveURL(/\/dashboard\/tools\/?$/, { timeout: 15_000 })
    await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible({
      timeout: 15_000,
    })

    for (const tool of tools) {
      await page.goto(tool.path)
      await expect(page.locator("main[data-npai-tool]")).toHaveAttribute(
        "data-npai-tool",
        tool.id,
        { timeout: 20_000 }
      )
      await expect(
        page.getByRole("heading", { level: 1, name: tool.title })
      ).toBeVisible()
    }
  })
})
