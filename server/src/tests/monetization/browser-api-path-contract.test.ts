import test from "node:test"
import assert from "node:assert/strict"

/**
 * Mirrors `normalizePath` in `client/src/lib/api.ts` — billing calls must resolve
 * to `/api/billing/change-plan` on the browser origin so Next rewrites hit Express.
 */
function normalizePath(path: string) {
  let p = (path || "").trim()
  if (!p.startsWith("/")) p = `/${p}`
  if (p.startsWith("/api/")) p = p.replace(/^\/api/, "")
  return p === "/api" ? "/" : p
}

const API_PREFIX = "/api"

test("pricing billing paths normalize for same-origin fetch", () => {
  assert.equal(`${API_PREFIX}${normalizePath("/billing/change-plan")}`, "/api/billing/change-plan")
  assert.equal(`${API_PREFIX}${normalizePath("/billing/checkout")}`, "/api/billing/checkout")
})

test("double /api prefix is stripped from path argument", () => {
  assert.equal(`${API_PREFIX}${normalizePath("/api/billing/checkout")}`, "/api/billing/checkout")
})
