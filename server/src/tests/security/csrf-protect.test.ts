import test from "node:test"
import assert from "node:assert/strict"
import type { Request, Response, NextFunction } from "express"
import { requireCsrfForCookieAuth } from "../../middlewares/csrf-protect"

function createReq(input: {
  method: string
  headers?: Record<string, string>
  cookies?: Record<string, string>
  requestId?: string
}) {
  const headersLower = Object.fromEntries(
    Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
  )
  return {
    method: input.method,
    headers: headersLower,
    cookies: input.cookies,
    requestId: input.requestId ?? "csrf-test",
    get(name: string) {
      return headersLower[name.toLowerCase()]
    },
  }
}

function createRes() {
  let statusCode = 200
  let body: unknown = null
  const res = {
    status(code: number) {
      statusCode = code
      return res
    },
    json(payload: unknown) {
      body = payload
      return res
    },
  } as unknown as Response

  return {
    res,
    get statusCode() {
      return statusCode
    },
    get body() {
      return body as Record<string, unknown> | null
    },
  }
}

test("allows non-mutating methods without CSRF checks", () => {
  process.env.NODE_ENV = "production"
  const req = createReq({
    method: "GET",
    cookies: { token: "session" },
  })
  const out = createRes()
  let nextCalled = false
  const next: NextFunction = () => {
    nextCalled = true
  }

  requireCsrfForCookieAuth(req as unknown as Request, out.res, next)
  assert.equal(nextCalled, true)
  assert.equal(out.statusCode, 200)
})

test("allows bearer-style mutating requests without cookie CSRF checks", () => {
  process.env.NODE_ENV = "production"
  const req = createReq({
    method: "POST",
    headers: { authorization: "Bearer test" },
  })
  const out = createRes()
  let nextCalled = false
  const next: NextFunction = () => {
    nextCalled = true
  }

  requireCsrfForCookieAuth(req as unknown as Request, out.res, next)
  assert.equal(nextCalled, true)
  assert.equal(out.statusCode, 200)
})

test("blocks cookie-auth mutating request when X-Requested-With is missing", () => {
  process.env.NODE_ENV = "production"
  process.env.CLIENT_URL = "https://app.example.com"
  delete process.env.FRONTEND_URL
  delete process.env.ALLOWED_ORIGINS

  const req = createReq({
    method: "POST",
    headers: { origin: "https://app.example.com" },
    cookies: { token: "session" },
  })
  const out = createRes()
  let nextCalled = false
  const next: NextFunction = () => {
    nextCalled = true
  }

  requireCsrfForCookieAuth(req as unknown as Request, out.res, next)
  assert.equal(nextCalled, false)
  assert.equal(out.statusCode, 403)
  assert.equal(out.body?.code, "CSRF_BLOCKED")
})

test("blocks cookie-auth mutating request when origin is not allowlisted", () => {
  process.env.NODE_ENV = "production"
  process.env.CLIENT_URL = "https://app.example.com"
  delete process.env.FRONTEND_URL
  delete process.env.ALLOWED_ORIGINS

  const req = createReq({
    method: "POST",
    headers: {
      origin: "https://evil.example.com",
      "x-requested-with": "XMLHttpRequest",
    },
    cookies: { token: "session" },
  })
  const out = createRes()
  let nextCalled = false
  const next: NextFunction = () => {
    nextCalled = true
  }

  requireCsrfForCookieAuth(req as unknown as Request, out.res, next)
  assert.equal(nextCalled, false)
  assert.equal(out.statusCode, 403)
  assert.equal(out.body?.code, "CSRF_BLOCKED")
})

test("allows cookie-auth mutating request with allowlisted origin and xhr header", () => {
  process.env.NODE_ENV = "production"
  process.env.CLIENT_URL = "https://app.example.com"
  delete process.env.FRONTEND_URL
  delete process.env.ALLOWED_ORIGINS

  const req = createReq({
    method: "POST",
    headers: {
      origin: "https://app.example.com",
      "x-requested-with": "XMLHttpRequest",
    },
    cookies: { token: "session" },
  })
  const out = createRes()
  let nextCalled = false
  const next: NextFunction = () => {
    nextCalled = true
  }

  requireCsrfForCookieAuth(req as unknown as Request, out.res, next)
  assert.equal(nextCalled, true)
  assert.equal(out.statusCode, 200)
})
