import test from "node:test"
import assert from "node:assert/strict"

import {
  WORKFLOW_LIMITS,
  getWorkflowLimits,
  isAtWorkflowLimit,
} from "../../modules/plans/plan.constants"

test("workflow limits increase with plan tier", () => {
  assert.ok(WORKFLOW_LIMITS.FREE.workspaces < WORKFLOW_LIMITS.STARTER.workspaces)
  assert.ok(WORKFLOW_LIMITS.STARTER.brandVoices < WORKFLOW_LIMITS.PRO.brandVoices)
  assert.ok(WORKFLOW_LIMITS.PRO.contentPacks < WORKFLOW_LIMITS.ELITE.contentPacks)
})

test("getWorkflowLimits normalizes unknown plans to FREE", () => {
  assert.deepEqual(getWorkflowLimits("nope"), WORKFLOW_LIMITS.FREE)
})

test("isAtWorkflowLimit blocks create when count equals cap", () => {
  const cap = WORKFLOW_LIMITS.FREE.workspaces
  assert.equal(isAtWorkflowLimit("FREE", "workspaces", cap), true)
  assert.equal(isAtWorkflowLimit("FREE", "workspaces", cap - 1), false)
})
