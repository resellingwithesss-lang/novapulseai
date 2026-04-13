import { test, expect } from "@playwright/test"

test.describe("Auth as a signed-out user", () => {
  test("register, sign out, sign in, reach dashboard", async ({ page, context }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const email = `pw_user_${suffix}@test.local`
    const password = "E2E_Strong_99!"

    await page.goto("/register")
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible()
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(password)
    await page.getByRole("button", { name: "Create account" }).click()

    await expect(page).toHaveURL(/\/(dashboard|pricing)/, { timeout: 30_000 })

    await context.clearCookies()

    await page.goto("/login")
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible({
      timeout: 15_000,
    })
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(password)
    await page.getByRole("button", { name: "Sign in" }).click()

    await expect(page).toHaveURL(/\/(dashboard|pricing)/, { timeout: 30_000 })
  })
})
