import test from "node:test"
import assert from "node:assert/strict"
import type { PrismaClient } from "@prisma/client"

import { loadCreatorContextAttachments } from "../../modules/workflow/creator-context"

test("loadCreatorContextAttachments returns mismatch when brand voice workspace differs", async () => {
  const prisma = {
    workspace: {
      findFirst: async () => ({
        id: "ws-a",
        userId: "u1",
        name: "A",
        niche: "",
        targetAudience: "",
        primaryPlatforms: [],
        contentGoals: [],
        defaultCtaStyle: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
    brandVoice: {
      findFirst: async () => ({
        id: "bv1",
        userId: "u1",
        workspaceId: "ws-b",
        name: "Voice",
        tone: "",
        pacing: "",
        slangLevel: "",
        ctaStyle: "",
        bannedPhrases: [],
        audienceSophistication: "",
        notes: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
  } as unknown as PrismaClient

  const r = await loadCreatorContextAttachments(prisma, "u1", {
    workspaceId: "ws-a",
    brandVoiceId: "bv1",
  })
  assert.equal(r.ok, false)
  if (r.ok === false) assert.equal(r.code, "BRAND_VOICE_WORKSPACE_MISMATCH")
})

test("loadCreatorContextAttachments returns NOT_FOUND when workspace id not owned", async () => {
  const prisma = {
    workspace: {
      findFirst: async () => null,
    },
    brandVoice: {
      findFirst: async () => null,
    },
  } as unknown as PrismaClient

  const r = await loadCreatorContextAttachments(prisma, "u1", {
    workspaceId: "other-ws",
  })
  assert.equal(r.ok, false)
  if (r.ok === false) assert.equal(r.code, "NOT_FOUND")
})
