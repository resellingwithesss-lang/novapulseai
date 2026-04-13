import fs from "fs"
import path from "path"
import { defineConfig } from "@playwright/test"

/** Monorepo root (has `e2e/fixtures/sample.mp4`), not `client/`. Ensures `webServer` runs root `npm run dev` (API + Next). */
function resolveRepoRoot(): string {
  let dir = path.resolve(process.cwd())
  for (let i = 0; i < 8; i++) {
    const marker = path.join(dir, "e2e", "fixtures", "sample.mp4")
    if (fs.existsSync(marker)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.resolve(process.cwd())
}

const REPO_ROOT = resolveRepoRoot()

/** Set `PW_NO_WEBSERVER=1` when `npm run dev` is already up so Playwright does not spawn a second stack. */
const PW_SKIP_WEBSERVER =
  process.env.PW_NO_WEBSERVER === "1" || process.env.PW_NO_WEBSERVER === "true"

/** Set `PW_DEBUG_LOG=1` to append a one-line NDJSON boot record for local debugging. */
if (process.env.PW_DEBUG_LOG === "1") {
  try {
    const dir = REPO_ROOT
    if (fs.existsSync(path.join(dir, "e2e", "fixtures", "sample.mp4"))) {
      const line =
        JSON.stringify({
          hypothesisId: "H_pw_config_load",
          data: {
            cwd: process.cwd(),
            repoRoot: dir,
            PW_NO_WEBSERVER: PW_SKIP_WEBSERVER,
            startedAtIso: new Date().toISOString(),
          },
          timestamp: Date.now(),
        }) + "\n"
      fs.appendFileSync(path.join(dir, "debug-playwright.log"), line, "utf8")
    }
  } catch {
    /* ignore */
  }
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    // Match `npm run dev` (Next on :3000) so `reuseExistingServer` attaches to your stack.
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    headless: true,
  },
  ...(PW_SKIP_WEBSERVER
    ? {}
    : {
        webServer: {
          command: "npm run dev",
          cwd: REPO_ROOT,
          url: "http://localhost:3000",
          reuseExistingServer: true,
          timeout: 300_000,
        },
      }),
})
