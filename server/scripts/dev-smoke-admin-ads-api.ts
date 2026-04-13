/**
 * DEV-ONLY: hits a running API with POST /api/ads/generate (same payload shape as /admin/ads).
 *
 * **Mutates data:** sets the oldest User to ADMIN + ELITE + ACTIVE and may create a Workspace.
 * Do not run against production or shared databases.
 *
 * Prereq: API already running. Example:
 *   set SMOKE_API_BASE=http://127.0.0.1:5000
 *   npm run smoke:ads-api:dev
 */
import jwt from "jsonwebtoken"

import { loadServerEnv } from "../src/lib/load-server-env"
import { prisma } from "../src/lib/prisma"

loadServerEnv()

const API_BASE = (process.env.SMOKE_API_BASE ?? "http://127.0.0.1:5010").replace(
  /\/$/,
  ""
)

function signToken(user: { id: string; role: string; tokenVersion: number }) {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error("JWT_SECRET required in .env")
  return jwt.sign(
    { sub: user.id, role: user.role, tokenVersion: user.tokenVersion },
    secret,
    { expiresIn: "1h", algorithm: "HS256" }
  )
}

async function main() {
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } })
  if (!user) throw new Error("No User rows — cannot smoke-test generate")

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      role: "ADMIN",
      plan: "ELITE",
      subscriptionStatus: "ACTIVE",
      trialExpiresAt: null,
    },
    select: { id: true, tokenVersion: true, role: true },
  })

  let workspace = await prisma.workspace.findFirst({
    where: { userId: updated.id },
  })
  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        userId: updated.id,
        name: "Smoke workspace",
        niche: "e2e",
      },
    })
  }

  const token = signToken({
    id: updated.id,
    role: updated.role,
    tokenVersion: updated.tokenVersion,
  })

  const body = {
    siteUrl: "https://example.com",
    tone: "emotional",
    duration: 30,
    platform: "tiktok",
    editingStyle: "auto",
    ultra: false,
    creativeMode: "cinematic",
    renderTopVariants: 1,
    workspaceId: workspace.id,
    sourceType: "MANUAL",
  }

  const genRes = await fetch(`${API_BASE}/api/ads/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  const genText = await genRes.text()
  let genJson: unknown
  try {
    genJson = JSON.parse(genText)
  } catch {
    genJson = { raw: genText }
  }

  if (!genRes.ok) {
    console.log(
      JSON.stringify(
        { step: "generate", httpStatus: genRes.status, body: genJson },
        null,
        2
      )
    )
    process.exit(1)
  }

  const jobId = (genJson as { result?: { jobId?: string } }).result?.jobId
  if (!jobId || typeof jobId !== "string") {
    console.log(JSON.stringify({ step: "parse_jobId", body: genJson }, null, 2))
    process.exit(1)
  }

  const deadline = Date.now() + 120_000
  let lastProgress = -1
  let lastEnvelopeStatus = ""
  while (Date.now() < deadline) {
    const poll = await fetch(
      `${API_BASE}/api/ads/${encodeURIComponent(jobId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const pollJson = (await poll.json()) as {
      success?: boolean
      progress?: number
      status?: string
    }
    lastProgress = typeof pollJson.progress === "number" ? pollJson.progress : -1
    lastEnvelopeStatus = pollJson.status ?? ""
    if (lastProgress >= 10) break
    if (lastEnvelopeStatus === "failed") break
    await new Promise(r => setTimeout(r, 2000))
  }

  const row = await prisma.adJob.findFirst({
    where: { jobId },
    select: {
      workspaceId: true,
      sourceType: true,
      sourceContentPackId: true,
      sourceGenerationId: true,
      metadata: true,
      progress: true,
      status: true,
    },
  })

  const passedQueueing =
    (row?.progress ?? 0) >= 10 || row?.status === "completed"

  console.log(
    JSON.stringify(
      {
        summary: {
          generateHttpStatus: genRes.status,
          jobId,
          polledProgress: lastProgress,
          polledEnvelopeStatus: lastEnvelopeStatus,
          dbProgress: row?.progress,
          dbStatus: row?.status,
          passedQueueing,
          workspaceIdMatches:
            row?.workspaceId != null && row.workspaceId === workspace.id,
          sourceType: row?.sourceType,
        },
        generateBody: genJson,
        dbLineage: {
          workspaceId: row?.workspaceId,
          sourceType: row?.sourceType,
          sourceContentPackId: row?.sourceContentPackId,
          sourceGenerationId: row?.sourceGenerationId,
        },
        metadataSample:
          row?.metadata && typeof row.metadata === "object"
            ? Object.keys(row.metadata as object).sort()
            : [],
      },
      null,
      2
    )
  )

  if (!passedQueueing) {
    process.exit(2)
  }
}

void main().catch(e => {
  console.error(e)
  process.exit(1)
})
