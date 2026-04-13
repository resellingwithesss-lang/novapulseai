import test from "node:test"
import assert from "node:assert/strict"

import {
  serializeActivityAdJob,
  serializeActivityGeneration,
  serializeActivityContentPack,
} from "../../modules/activity/activity.serialization"

const created = new Date("2026-01-15T12:00:00.000Z")

test("serializeActivityGeneration includes workflow and pack context when linked", () => {
  const dto = serializeActivityGeneration({
    id: "g1",
    type: "VIDEO",
    input: "x".repeat(200),
    creditsUsed: 1,
    durationMs: 100,
    requestId: "req-1",
    createdAt: created,
    modelUsed: "gpt-4o",
    workspaceId: "ws1",
    workspace: { name: "Main" },
    brandVoiceId: "bv1",
    brandVoice: { id: "bv1", name: "Bold" },
    sourceContentPackId: "cp1",
    sourceContentPack: { id: "cp1", title: "Launch week" },
    sourceGenerationId: null,
    sourceType: "CONTENT_PACK",
  })
  assert.equal(dto.workspaceId, "ws1")
  assert.equal(dto.workspaceName, "Main")
  assert.equal(dto.brandVoiceId, "bv1")
  assert.equal(dto.brandVoiceName, "Bold")
  assert.equal(dto.contentPackId, "cp1")
  assert.equal(dto.contentPackTitle, "Launch week")
  assert.equal(dto.sourceType, "CONTENT_PACK")
  assert.ok(dto.inputPreview.length <= 165)
})

test("serializeActivityAdJob includes pack context when linked", () => {
  const dto = serializeActivityAdJob({
    id: "j1",
    jobId: "job-uuid",
    status: "completed",
    progress: 100,
    platform: "tiktok",
    duration: 30,
    tone: "cinematic",
    outputUrl: "/out.mp4",
    failedReason: null,
    createdAt: created,
    updatedAt: created,
    workspaceId: "ws1",
    workspace: { name: "Main" },
    sourceContentPackId: "cp9",
    sourceContentPack: { id: "cp9", title: "Holiday" },
    sourceGenerationId: null,
    sourceType: "CONTENT_PACK",
  })
  assert.equal(dto.contentPackId, "cp9")
  assert.equal(dto.contentPackTitle, "Holiday")
  assert.equal(dto.workspaceName, "Main")
})

test("serializeActivityContentPack exposes workspace and brand voice names", () => {
  const dto = serializeActivityContentPack({
    id: "cp1",
    title: "Pack",
    topic: "short",
    platform: "TikTok",
    audience: "devs",
    status: "READY",
    createdAt: created,
    updatedAt: created,
    workspaceId: "ws1",
    workspace: { name: "W" },
    brandVoiceId: "bv1",
    brandVoice: { id: "bv1", name: "V" },
  })
  assert.equal(dto.kind, "CONTENT_PACK")
  assert.equal(dto.workspaceName, "W")
  assert.equal(dto.brandVoiceName, "V")
  assert.equal(dto.contentPackId, "cp1")
})
