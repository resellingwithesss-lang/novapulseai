import test from "node:test"
import assert from "node:assert/strict"

import {
  isPrismaP2022,
  stripAdJobOptionalLineageFields,
} from "../../modules/ads/ad-job.create"

test("isPrismaP2022 matches P2022", () => {
  assert.equal(isPrismaP2022({ code: "P2022", message: "column" }), true)
  assert.equal(isPrismaP2022({ code: "P2002", message: "unique" }), false)
  assert.equal(isPrismaP2022(null), false)
})

test("stripAdJobOptionalLineageFields removes optional lineage scalars", () => {
  const out = stripAdJobOptionalLineageFields({
    userId: "u1",
    jobId: "j1",
    status: "processing",
    platform: "tiktok",
    duration: 30,
    tone: "cinematic",
    progress: 5,
    workspaceId: "ws1",
    sourceContentPackId: "p1",
    sourceGenerationId: "g1",
    sourceType: "MANUAL",
  } as import("@prisma/client").Prisma.AdJobUncheckedCreateInput)
  assert.equal((out as { workspaceId?: string }).workspaceId, undefined)
  assert.equal((out as { sourceContentPackId?: string }).sourceContentPackId, undefined)
  assert.equal(out.userId, "u1")
  assert.equal(out.jobId, "j1")
})
