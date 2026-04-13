import test from "node:test"
import assert from "node:assert/strict"
import http from "http"
import express from "express"
import cookieParser from "cookie-parser"
import type { AddressInfo } from "net"
import type { PrismaClient } from "@prisma/client"
import { AuthProvider } from "@prisma/client"

let authRouter!: express.Router
let prisma!: PrismaClient

test.before(async () => {
  if (!process.env.DATABASE_URL) {
    return
  }
  process.env.JWT_SECRET ??= "01234567890123456789012345678901"
  process.env.GOOGLE_CLIENT_ID ??= "test-google-client.apps.googleusercontent.com"

  try {
    const routesMod = await import("../../modules/auth/auth.routes")
    authRouter = routesMod.default
    const prismaMod = await import("../../lib/prisma")
    prisma = prismaMod.prisma
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[google-auth-hardening] test.before import failed", e)
    throw e
  }
})

function buildApp() {
  const app = express()
  app.disable("x-powered-by")
  app.use(express.json())
  app.use((req, res, next) => {
    ;(req as express.Request & { requestId: string }).requestId = "test-google-auth"
    next()
  })
  app.use(cookieParser())
  app.use("/api/auth", authRouter)
  return app
}

async function listen(app: express.Express) {
  return new Promise<{ baseUrl: string; close: () => void }>((resolve, reject) => {
    const server = http.createServer(app)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => server.close(),
      })
    })
    server.on("error", reject)
  })
}

function isSchemaMismatch(err: unknown): boolean {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : ""
  if (code === "P2021") return true
  const msg = String((err as { message?: string })?.message || "")
  return (
    msg.includes("does not exist") ||
    msg.includes("Unknown column") ||
    (msg.includes("column") && msg.includes("not exist"))
  )
}

async function postGoogle(baseUrl: string, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    json = null
  }
  const setCookie = res.headers.get("set-cookie")
  return { status: res.status, json, setCookie, raw: text }
}

const skipNoDb = !process.env.DATABASE_URL

test(
  "Google auth: banned user gets 403 ACCOUNT_DISABLED and no session cookie",
  { skip: skipNoDb },
  async (t) => {
    if (!authRouter || !prisma) {
      t.skip()
      return
    }
    const email = `google-ban-${Date.now()}@example.com`
    try {
      await prisma.user.create({
        data: {
          email,
          provider: AuthProvider.GOOGLE,
          role: "USER",
          plan: "FREE",
          subscriptionStatus: "CANCELED",
          credits: 4,
          banned: true,
          bannedReason: "test",
          tokenVersion: 0,
        },
      })
    } catch (e) {
      if (isSchemaMismatch(e)) {
        t.skip("Database schema does not match Prisma client (run prisma migrate deploy).")
        return
      }
      throw e
    }

    const savedFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ email, email_verified: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch

    const app = buildApp()
    const { baseUrl, close } = await listen(app)
    try {
      const { status, json, setCookie } = await postGoogle(baseUrl, {
        accessToken: "fake-access-token-for-test",
      })
      assert.equal(status, 403)
      assert.equal(json?.success, false)
      assert.equal(json?.code, "ACCOUNT_DISABLED")
      assert.ok(
        !setCookie || !/token=/.test(setCookie),
        "must not set auth cookie for banned user"
      )
    } finally {
      close()
      globalThis.fetch = savedFetch
      await prisma.user.deleteMany({ where: { email } })
    }
  }
)

test(
  "Google auth: soft-deleted user restore increments tokenVersion and returns 200 with cookie",
  { skip: skipNoDb },
  async (t) => {
    if (!authRouter || !prisma) {
      t.skip()
      return
    }
    const email = `google-restore-${Date.now()}@example.com`
    let before: { id: string }
    try {
      before = await prisma.user.create({
        data: {
          email,
          provider: AuthProvider.GOOGLE,
          role: "USER",
          plan: "FREE",
          subscriptionStatus: "CANCELED",
          credits: 4,
          tokenVersion: 7,
          deletedAt: new Date(),
        },
      })
    } catch (e) {
      if (isSchemaMismatch(e)) {
        t.skip("Database schema does not match Prisma client (run prisma migrate deploy).")
        return
      }
      throw e
    }

    const savedFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ email, email_verified: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch

    const app = buildApp()
    const { baseUrl, close } = await listen(app)
    try {
      const { status, json, setCookie } = await postGoogle(baseUrl, {
        accessToken: "fake-access-token-for-test",
      })
      assert.equal(status, 200)
      assert.equal(json?.success, true)
      assert.ok(setCookie && /token=/.test(setCookie), "sets session cookie on success")

      const after = await prisma.user.findUnique({ where: { id: before.id } })
      assert.ok(after)
      assert.equal(after.deletedAt, null)
      assert.equal(after.tokenVersion, 8)
    } finally {
      close()
      globalThis.fetch = savedFetch
      await prisma.user.deleteMany({ where: { email } })
    }
  }
)
