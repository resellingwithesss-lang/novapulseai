import type { Page, Route } from "@playwright/test"

const stubScriptOutput = [
  {
    hook: "E2E stub hook",
    openLoop: "E2E stub open",
    body: "E2E stub body",
    cta: "E2E stub cta",
    caption: "E2E stub caption",
    hashtags: ["#e2e"],
  },
]

function fulfillJson(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  })
}

/** Stubs POST /api/generation for video/story script flows (no OpenAI). */
export function installGenerationApiStub(page: Page) {
  page.route("**/api/generation", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    await fulfillJson(route, 200, {
      success: true,
      requestId: "e2e_gen_stub",
      durationMs: 50,
      output: stubScriptOutput,
    })
  })
}
