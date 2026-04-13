import test from "node:test"
import assert from "node:assert/strict"
import type { PrismaClient } from "@prisma/client"

import {
  validateAdJobSourceRefs,
  validateGenerationSourceRefs,
} from "../../modules/workflow/source-metadata"

function mockPrisma(overrides: {
  pack?: { id: string } | null
  gen?: { id: string } | null
}): PrismaClient {
  return {
    contentPack: {
      findFirst: async () => overrides.pack ?? null,
    },
    generation: {
      findFirst: async () => overrides.gen ?? null,
    },
  } as unknown as PrismaClient
}

test("validateGenerationSourceRefs rejects pack not owned by user", async () => {
  const prisma = mockPrisma({ pack: null })
  const r = await validateGenerationSourceRefs(prisma, "user-1", {
    sourceContentPackId: "missing-pack",
  })
  assert.equal(r.ok, false)
  if (r.ok === false) assert.match(r.message, /Invalid content pack/)
})

test("validateGenerationSourceRefs accepts owned pack", async () => {
  const prisma = mockPrisma({ pack: { id: "p1" } })
  const r = await validateGenerationSourceRefs(prisma, "user-1", {
    sourceContentPackId: "p1",
  })
  assert.equal(r.ok, true)
})

test("validateAdJobSourceRefs rejects invalid generation reference", async () => {
  const prisma = mockPrisma({ pack: { id: "p1" }, gen: null })
  const r = await validateAdJobSourceRefs(prisma, "user-1", {
    sourceContentPackId: "p1",
    sourceGenerationId: "no-such-gen",
  })
  assert.equal(r.ok, false)
  if (r.ok === false) assert.match(r.message, /Invalid generation/)
})
