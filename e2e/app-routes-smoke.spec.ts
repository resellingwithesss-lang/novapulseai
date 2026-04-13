/**
 * Smoke: primary app routes load without a Next.js 404 (requires dev server + API for /register).
 */
import { test, expect } from "@playwright/test"
import { tools } from "../client/src/config/tools"
import { registerTestUser } from "./helpers/register-user"

test.describe.configure({ mode: "serial" })

const PUBLIC_PATHS = ["/", "/login", "/register", "/pricing"] as const

test.describe("App routes open", () => {
  test("public marketing and auth routes load", async ({ page }) => {
    for (const path of PUBLIC_PATHS) {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" })
      expect(res?.status(), `${path} HTTP status`).toBeLessThan(400)
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({
        timeout: 15_000,
      })
    }
  })

  test("/#workflow anchor target exists on home", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("#workflow")).toBeAttached()
  })

  test("/tools redirects to dashboard tools hub", async ({ page }) => {
    await page.goto("/tools")
    await expect(page).toHaveURL(/\/dashboard\/tools\/?$/, { timeout: 15_000 })
  })

  test("authenticated dashboard and tool routes load", async ({ page }) => {
    await registerTestUser(page)
    if (/\/pricing/.test(page.url())) {
      await page.goto("/dashboard")
    }
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })

    const authedPaths = [
      "/dashboard",
      "/dashboard/workspaces",
      "/dashboard/brand-voices",
      "/dashboard/content-packs",
      "/dashboard/content-packs/00000000-0000-4000-8000-000000000001",
      "/dashboard/library",
      "/dashboard/tools",
      "/dashboard/billing",
      "/dashboard/settings",
      "/admin",
      ...tools.map((t) => t.path),
    ]

    for (const path of authedPaths) {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" })
      expect(res?.status(), `${path} HTTP status`).toBeLessThan(400)
      await expect(page.locator("body")).not.toContainText("404")
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({
        timeout: 20_000,
      })
    }
  })
})
