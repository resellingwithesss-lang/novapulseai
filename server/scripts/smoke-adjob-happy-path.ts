/**
 * Optional local/CI smoke: after `verify:adjob-schema`, confirms `adJobCreateWithWorkspaceFallback`
 * succeeds on the first insert (no P2022 retry). Creates one `AdJob` row then deletes it.
 * Run from server/: npm run smoke:adjob-create
 */
import crypto from "crypto"

import { loadServerEnv } from "../src/lib/load-server-env"
import { Prisma } from "@prisma/client"

import { prisma } from "../src/lib/prisma"
import { warnIfAdJobSchemaDrift } from "../src/lib/prisma-adjob-drift"
import { adJobCreateWithWorkspaceFallback } from "../src/modules/ads/ad-job.create"

loadServerEnv()

async function main() {
  const captured: string[] = []
  const origWarn = console.warn.bind(console)
  console.warn = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "))
    origWarn(...args)
  }

  await prisma.$connect()
  await warnIfAdJobSchemaDrift()

  const driftMissing = captured.filter(
    w => w.includes("[AdJob schema]") && w.includes("Missing column")
  )
  if (driftMissing.length > 0) {
    throw new Error(`Unexpected startup drift warning: ${driftMissing.join("; ")}`)
  }

  const user = await prisma.user.findFirst({ select: { id: true } })
  if (!user) {
    throw new Error("No User row — seed DB or register a user before smoke test")
  }

  const beforeFallback = captured.length
  const jobId = crypto.randomUUID()
  const row = await adJobCreateWithWorkspaceFallback({
    userId: user.id,
    jobId,
    requestId: `smoke-${Date.now()}`,
    status: "processing",
    platform: "tiktok",
    duration: 30,
    tone: "cinematic",
    progress: 5,
    failedReason: null,
    metadata: {
      siteUrl: "https://example.com",
      smokeTest: true,
      editingStyle: "premium",
      ultra: false,
      voice: "alloy",
      creativeMode: "cinematic",
      renderTopVariants: 1,
    } satisfies Record<string, unknown> as unknown as Prisma.InputJsonValue,
  })

  const fallbackLogs = captured.slice(beforeFallback).filter(
    w => w.includes("[ads] AdJob insert failed (P2022)")
  )
  if (fallbackLogs.length > 0) {
    await prisma.adJob.delete({ where: { id: row.id } }).catch(() => {})
    throw new Error(`Fallback path ran unexpectedly: ${fallbackLogs.join(" | ")}`)
  }

  const saved = await prisma.adJob.findUnique({
    where: { id: row.id },
    select: {
      jobId: true,
      workspaceId: true,
      sourceContentPackId: true,
      sourceGenerationId: true,
      sourceType: true,
      metadata: true,
    },
  })

  await prisma.adJob.delete({ where: { id: row.id } })

  console.warn = origWarn
  console.log(
    JSON.stringify(
      {
        ok: true,
        driftWarningsEmitted: captured.filter(w => w.includes("[AdJob schema]")).length,
        fallbackRetryLogged: false,
        jobId: saved?.jobId,
        lineageScalarsNull:
          saved?.workspaceId == null &&
          saved?.sourceContentPackId == null &&
          saved?.sourceGenerationId == null &&
          saved?.sourceType == null,
        metadataKeys:
          saved?.metadata && typeof saved.metadata === "object"
            ? Object.keys(saved.metadata as object).sort()
            : [],
      },
      null,
      2
    )
  )
}

void main().catch(e => {
  console.error(e)
  process.exit(1)
})
