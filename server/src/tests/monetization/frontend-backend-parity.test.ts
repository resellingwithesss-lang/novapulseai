import test from "node:test"
import assert from "node:assert/strict"

import {
  PLAN_CONFIG as SERVER_PLAN_CONFIG,
  WORKFLOW_LIMITS as SERVER_WORKFLOW_LIMITS,
  planIncludesTool as backendPlanIncludesTool,
} from "../../modules/plans/plan.constants"
import {
  PLAN_CONFIG as CLIENT_PLAN_CONFIG,
  WORKFLOW_LIMITS as CLIENT_WORKFLOW_LIMITS,
  planAllowsTool as frontendPlanAllowsTool,
} from "../../../../client/src/lib/plans"

const ALL_TOOLS = [
  "clipper",
  "prompt",
  "story-maker",
  "video-script",
  "story-video-maker",
] as const

const ALL_PLANS = ["FREE", "STARTER", "PRO", "ELITE"] as const

test("frontend and backend agree on plan credit caps", () => {
  for (const plan of ALL_PLANS) {
    assert.equal(CLIENT_PLAN_CONFIG[plan].credits, SERVER_PLAN_CONFIG[plan].credits)
  }
})

test("frontend and backend agree on tool access matrix", () => {
  for (const plan of ALL_PLANS) {
    for (const tool of ALL_TOOLS) {
      assert.equal(
        frontendPlanAllowsTool(plan, tool),
        backendPlanIncludesTool(plan, tool),
        `${plan} mismatch for ${tool}`
      )
    }
  }
})

test("frontend and backend agree on workflow caps", () => {
  for (const plan of ALL_PLANS) {
    assert.deepEqual(
      CLIENT_WORKFLOW_LIMITS[plan],
      SERVER_WORKFLOW_LIMITS[plan],
      `${plan} workflow limits mismatch`
    )
  }
})
