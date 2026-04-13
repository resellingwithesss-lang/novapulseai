import { defineConfig } from "@playwright/test"

/** Use when API + Next dev are already running (e.g. port 3000 + 5000). */
export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "**/auth-user-flow.spec.ts",
    "**/tool-pages.spec.ts",
    "**/navigation-route-integrity.spec.ts",
    "**/clip-preview.spec.ts",
    "**/creator-workflow-funnel.spec.ts",
    "**/lineage-library-continuity.spec.ts",
  ],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    headless: true,
  },
})
