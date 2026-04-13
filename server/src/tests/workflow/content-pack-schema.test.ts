import test from "node:test"
import assert from "node:assert/strict"

import { generateSchema } from "../../modules/content-packs/content-packs.routes"
import { isAtWorkflowLimit, WORKFLOW_LIMITS } from "../../modules/plans/plan.constants"

test("content pack generateSchema accepts minimal valid body", () => {
  const parsed = generateSchema.safeParse({
    topic: "Enough chars here",
    platform: "TikTok",
  })
  assert.equal(parsed.success, true)
})

test("content pack generateSchema rejects short topic", () => {
  const parsed = generateSchema.safeParse({
    topic: "ab",
    platform: "TikTok",
  })
  assert.equal(parsed.success, false)
})

test("FREE plan at content pack cap triggers limit (403 path in routes)", () => {
  const cap = WORKFLOW_LIMITS.FREE.contentPacks
  assert.equal(isAtWorkflowLimit("FREE", "contentPacks", cap), true)
})
