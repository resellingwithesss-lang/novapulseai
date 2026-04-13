import { expect, type Page } from "@playwright/test"

/**
 * Registers a unique user via /register and waits until the app lands on dashboard or pricing.
 * Requires API reachable via Next rewrites (same as other e2e auth specs).
 */
export async function registerTestUser(page: Page) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const email = `pw_e2e_${suffix}@test.local`
  const password = "E2E_Strong_99!"

  await page.goto("/register")
  await expect(
    page.getByRole("heading", { name: "Create your account" })
  ).toBeVisible({ timeout: 20_000 })
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page).toHaveURL(/\/(dashboard|pricing)/, { timeout: 35_000 })

  return { email, password }
}
