/**
 * Navigation & route integrity (navbar, tools hub, redirects, admin gate, logout).
 *
 * Setup: API must accept registration (Next rewrites /api → backend). Default
 * playwright.config uses `npm run dev` (Next on :3000); use reuseExistingServer with
 * API running, or rely on your local dev stack.
 *
 * Admin role test: set E2E_ADMIN_EMAIL + E2E_ADMIN_PASSWORD or it is skipped.
 *
 * Not covered: dashboard/tools/error.tsx "All tools" link (needs a thrown boundary).
 *
 * /admin is wrapped by AdminGate (layout): signed-out users are sent to /login?redirect=/admin;
 * signed-in non-admins see an inline Access restricted screen (not /admin/page.tsx).
 */
import { test, expect } from "@playwright/test"
import { registerTestUser } from "./helpers/register-user"

test.describe("Tools redirect & hub", () => {
  test("/tools redirects to /dashboard/tools", async ({ page }) => {
    await page.goto("/tools")
    await expect(page).toHaveURL(/\/dashboard\/tools\/?$/, { timeout: 15_000 })
  })

  test("/dashboard/tools renders hub and key tool cards", async ({ page }) => {
    await registerTestUser(page)
    await page.goto("/dashboard/tools")
    await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText("Creator studio", { exact: false })).toBeVisible()
    await expect(
      page.getByRole("link", { name: /Video Script Engine/i })
    ).toBeVisible()
    await expect(page.getByRole("link", { name: /Story Maker/i })).toBeVisible()
    await expect(page.getByRole("link", { name: /Clipper Engine/i })).toBeVisible()
  })
})

test.describe("Tool shell: Back to tools", () => {
  test("video tool links Back to tools → /dashboard/tools", async ({ page }) => {
    await registerTestUser(page)
    await page.goto("/dashboard/tools/video")
    const back = page.getByRole("link", { name: /Back to tools/i })
    await expect(back).toBeVisible({ timeout: 20_000 })
    await expect(back).toHaveAttribute("href", "/dashboard/tools")
  })

  test("clipper tool links Back to tools → /dashboard/tools", async ({ page }) => {
    await registerTestUser(page)
    await page.goto("/dashboard/tools/clipper")
    const back = page.getByRole("link", { name: /Back to tools/i })
    await expect(back).toBeVisible({ timeout: 20_000 })
    await expect(back).toHaveAttribute("href", "/dashboard/tools")
  })
})

test.describe("/admin route behavior", () => {
  test("unauthenticated visitor is sent to login with return path to /admin", async ({ page }) => {
    await page.context().clearCookies()
    await page.goto("/admin", { waitUntil: "load" })
    await expect(page).toHaveURL(/\/login/, { timeout: 25_000 })
    await expect(page.url()).toMatch(/redirect=.*admin|redirect=%2Fadmin/i)
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible({
      timeout: 15_000,
    })
  })

  test("authenticated non-admin sees restricted state", async ({ page }) => {
    await registerTestUser(page)
    const cookies = await page.context().cookies()
    expect(cookies.some((c) => c.name === "token" && Boolean(c.value))).toBeTruthy()
    await page.goto("/dashboard", { waitUntil: "load" })
    await expect(page.getByRole("heading", { name: /Command Center/i })).toBeVisible({
      timeout: 20_000,
    })
    await page.goto("/admin", { waitUntil: "load" })
    await expect(page).toHaveURL(/\/admin/i, { timeout: 20_000 })
    await expect(page.getByRole("heading", { name: "Access restricted" })).toBeVisible({
      timeout: 20_000,
    })
    await expect(
      page.getByText("This area is only available to administrators.")
    ).toBeVisible()
    await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible()
  })

  test("admin user sees admin console", async ({ page }) => {
    const email = process.env.E2E_ADMIN_EMAIL?.trim()
    const password = process.env.E2E_ADMIN_PASSWORD
    test.skip(!email || !password, "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD for admin coverage")

    await page.goto("/login")
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible({
      timeout: 20_000,
    })
    await page.getByLabel("Email").fill(email!)
    await page.getByLabel("Password", { exact: true }).fill(password!)
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page).toHaveURL(/\/(dashboard|pricing)/, { timeout: 35_000 })

    await page.goto("/admin", { waitUntil: "load" })
    await expect(page).toHaveURL(/\/admin/i, { timeout: 20_000 })
    await expect(page.getByText("NovaPulseAI Admin")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("heading", { name: "Console" })).toBeVisible({
      timeout: 20_000,
    })
    await expect(
      page.getByRole("link", { name: /Return to app dashboard/i })
    ).toBeVisible()
  })
})

test.describe("Desktop navbar", () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test("navigates among dashboard, library, tools, and pricing", async ({ page }) => {
    await registerTestUser(page)

    const mainNav = page.getByRole("navigation", { name: "Main" })

    await page.goto("/dashboard")
    await mainNav.getByRole("link", { name: "Library" }).click()
    await expect(page).toHaveURL(/\/dashboard\/library/, { timeout: 15_000 })

    await mainNav.getByRole("link", { name: "Tools" }).click()
    await expect(page).toHaveURL(/\/dashboard\/tools\/?$/, { timeout: 15_000 })

    await mainNav.getByRole("link", { name: "Pricing" }).click()
    await expect(page).toHaveURL(/\/pricing/, { timeout: 15_000 })
  })
})

test.describe("Mobile drawer", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("opens drawer and reaches Tools from hub link", async ({ page }) => {
    await registerTestUser(page)
    await page.goto("/dashboard")

    await page.locator('button[aria-controls="nav-mobile-drawer"]').click()
    await expect(page.locator("#nav-mobile-drawer")).toBeVisible()

    await page.locator("#nav-mobile-drawer").getByRole("link", { name: "Tools" }).click()
    await expect(page).toHaveURL(/\/dashboard\/tools\/?$/, { timeout: 15_000 })
    await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible()
  })
})

test.describe("Logout", () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test("from library, logout returns to login flow", async ({ page }) => {
    await registerTestUser(page)
    await page.goto("/dashboard/library")
    await expect(page.getByRole("heading", { name: "Content library" })).toBeVisible({
      timeout: 15_000,
    })

    await page.getByRole("button", { name: "Log out" }).click()
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 })
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible({
      timeout: 15_000,
    })
  })
})
