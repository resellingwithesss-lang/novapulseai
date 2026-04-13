/* =====================================================
CONFIG
===================================================== */

const RAW_BASE =
  process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:5000"

function normalizeBaseUrl(url: string) {
  let u = url.replace(/\/$/, "")
  if (u.endsWith("/api")) u = u.slice(0, -4)
  return u
}

const BASE_URL = normalizeBaseUrl(RAW_BASE)
const API_PREFIX = "/api"

const DEFAULT_TIMEOUT = 20000
/**
 * Queue-style tool calls (e.g. POST /ads/generate) can exceed the default while
 * the server creates the job row, checks billing, and responds with 202 — especially
 * on cold DB or slow networks. Polling handles the actual render.
 */
export const LONG_REQUEST_TIMEOUT_MS = 120_000
const MAX_RETRY_DELAY = 8000
const MAX_RETRIES = 2

/**
 * Client-side circuit breaker: in `next dev` it caused more pain than benefit
 * (backend down → a few retries → 15s total lockout while you’re fixing env).
 * Enabled only in production; override with NEXT_PUBLIC_DISABLE_API_CIRCUIT=true.
 */
const CIRCUIT_ENABLED =
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PUBLIC_DISABLE_API_CIRCUIT !== "true" &&
  process.env.NEXT_PUBLIC_DISABLE_API_CIRCUIT !== "1"

const CIRCUIT_THRESHOLD = 15
const CIRCUIT_COOLDOWN = 12000

const DEBUG = process.env.NODE_ENV === "development"

/* =====================================================
TYPES
===================================================== */

export type ApiOptions = Omit<RequestInit, "body"> & {
  timeout?: number
  retry?: number
  raw?: boolean
  silent?: boolean
  body?: unknown
  idempotencyKey?: string
  validate?: (data: unknown) => boolean
  baseOverride?: string
}

export type ToolStage =
  | "validate"
  | "analyze"
  | "rank"
  | "render"
  | "finalize"
  | "failed"

export type ToolEnvelope<T = unknown> = {
  success: boolean
  requestId?: string
  stage?: ToolStage
  message?: string
  code?: string
} & T

export class ApiError extends Error {
  status: number
  code?: string
  data?: any // Changed to any for easier access in UI
  requestId?: string

  constructor(
    message: string,
    status: number,
    code?: string,
    data?: unknown,
    requestId?: string
  ) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.data = data
    this.requestId = requestId
    
    // Ensures stack trace is captured correctly in modern JS engines
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError)
    }
  }
}

export function unwrapToolEnvelope<T extends Record<string, unknown>>(
  data: unknown
): ToolEnvelope<T> {
  const envelope = (data ?? {}) as ToolEnvelope<T>
  return {
    success: Boolean(envelope.success),
    requestId: envelope.requestId,
    stage: envelope.stage,
    message: envelope.message,
    code: envelope.code,
    ...(envelope as T),
  }
}

/* =====================================================
STATE
===================================================== */

let failureCount = 0
let circuitOpenUntil = 0
const inFlight = new Map<string, Promise<any>>()

/* =====================================================
UTILS
===================================================== */

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

function generateRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function normalizePath(path: string) {
  let p = (path || "").trim()
  if (!p.startsWith("/")) p = `/${p}`
  if (p.startsWith("/api/")) p = p.replace(/^\/api/, "")
  return p === "/api" ? "/" : p
}

/**
 * Browser: use same-origin `/api/...` so Next.js rewrites proxy to the backend.
 * That avoids CORS, matches dev CSP `connect-src 'self'`, and works when only
 * the Next app origin is correct (e.g. 127.0.0.1 vs localhost mismatch).
 * Server / tests: call the API base URL directly (no Next proxy).
 */
function buildUrl(path: string, override?: string) {
  if (override) {
    const base = normalizeBaseUrl(override)
    return `${base}${API_PREFIX}${normalizePath(path)}`
  }
  if (typeof window !== "undefined") {
    return `${API_PREFIX}${normalizePath(path)}`
  }
  return `${BASE_URL}${API_PREFIX}${normalizePath(path)}`
}

function isJsonResponse(response: Response) {
  const type = response.headers.get("content-type") || ""
  return type.includes("application/json")
}

function isOffline() {
  return typeof navigator !== "undefined" && !navigator.onLine
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return "[unserializable]"
  }
}

function emit(eventName: string) {
  if (typeof window === "undefined") return
  try { window.dispatchEvent(new Event(eventName)) } catch {}
}

function log(...args: any[]) {
  if (DEBUG) console.log("%c[API]", "color: #3b82f6; font-weight: bold;", ...args)
}

/** Human-readable message when the body is HTML, empty, or non-standard JSON. */
function extractFailedResponseMessage(
  data: unknown,
  response: Response
): string {
  const status = response.status
  const statusText = (response.statusText || "").trim()

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const o = data as Record<string, unknown>
    if (typeof o.message === "string" && o.message.trim()) return o.message.trim()
    if (typeof o.error === "string" && o.error.trim()) return o.error.trim()
    if (o.error && typeof o.error === "object") {
      const e = o.error as Record<string, unknown>
      if (typeof e.message === "string" && e.message.trim()) return e.message.trim()
    }
  }

  if (typeof data === "string" && data.trim()) {
    const t = data.trim()
    if (t.startsWith("<") || t.length > 400) {
      // HTML error page from proxy (e.g. Next 502) — avoid dumping markup
    } else {
      return t
    }
  }

  if (status === 502 || status === 504) {
    return "Could not reach the API (bad gateway). Start the backend (npm run dev in the server folder, default port 5000) and reload. If you set NEXT_PUBLIC_API_URL, it must match where the API listens."
  }
  if (status === 503) {
    return "Service unavailable. The API may be down or restarting — try again in a moment."
  }
  if (status === 404) {
    return "API route not found. Check that the backend is running and exposes this path under /api."
  }
  if (status === 429) {
    return "Too many requests. Wait a minute and try again."
  }

  return `Request failed (HTTP ${status}${statusText ? ` ${statusText}` : ""}).`
}

const AUTH_401_NO_SESSION_EMIT = new Set([
  "/auth/login",
  "/auth/register",
  "/auth/google",
])

/* =====================================================
CORE FETCH
===================================================== */

async function internalFetch<T = unknown>(
  path: string,
  options: ApiOptions = {},
  attempt = 0
): Promise<T> {
  const {
    timeout = DEFAULT_TIMEOUT,
    retry = MAX_RETRIES,
    raw = false,
    silent = false,
    body,
    idempotencyKey,
    validate,
    baseOverride,
    ...fetchOptions
  } = options

  if (CIRCUIT_ENABLED) {
    // After cooldown, clear the failure window so one bad stretch doesn’t stick forever.
    if (circuitOpenUntil > 0 && Date.now() >= circuitOpenUntil) {
      failureCount = 0
      circuitOpenUntil = 0
    }

    if (circuitOpenUntil > 0 && Date.now() < circuitOpenUntil) {
      throw new ApiError(
        "Service temporarily unavailable (Circuit Breaker).",
        503,
        "CIRCUIT_OPEN"
      )
    }
  } else {
    failureCount = 0
    circuitOpenUntil = 0
  }

  if (isOffline()) {
    throw new ApiError("You are offline.", 0, "OFFLINE")
  }

  const method = (fetchOptions.method || "GET").toUpperCase()
  const dedupeKey = `${method}:${path}:${safeStringify(body)}`
  const dedupePath = normalizePath(path)
  const skipGetDedupe = dedupePath === "/auth/me"

  if (method === "GET" && !skipGetDedupe && inFlight.has(dedupeKey)) {
    return inFlight.get(dedupeKey)!
  }

  const requestId = generateRequestId()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  // Proper Header Construction
  const headers = new Headers(fetchOptions.headers || {})
  headers.set("X-Request-Id", requestId)
  headers.set("X-Requested-With", "XMLHttpRequest")
  
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey)

  let finalBody: any = body
  if (finalBody && typeof finalBody === "object" && !(finalBody instanceof FormData)) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json")
    }
    finalBody = JSON.stringify(finalBody)
  }

  const requestInit: RequestInit = {
    ...fetchOptions,
    method,
    body: finalBody,
    headers,
    signal: controller.signal,
    credentials: "include",
  }

  const promise = (async () => {
    try {
      emit("novapulseai_request_start")
      const url = buildUrl(path, baseOverride)
      log(`${method} → ${url}`, body || "")

      const response = await fetch(url, requestInit)
      let data: any = null
      const serverRequestId =
        response.headers.get("x-request-id") || response.headers.get("X-Request-Id")

      if (
        normalizePath(path) === "/auth/google" &&
        process.env.NEXT_PUBLIC_DEBUG_GOOGLE_AUTH === "1"
      ) {
        // eslint-disable-next-line no-console
        console.info("[API] /auth/google raw response", {
          status: response.status,
          url,
          clientRequestId: requestId,
          serverRequestId,
        })
      }

      if (response.status !== 204) {
        data = isJsonResponse(response) 
          ? await response.json().catch(() => null)
          : await response.text().catch(() => "")
      }

      if (
        normalizePath(path) === "/auth/google" &&
        process.env.NEXT_PUBLIC_DEBUG_GOOGLE_AUTH === "1"
      ) {
        const o = data && typeof data === "object" ? (data as Record<string, unknown>) : null
        // eslint-disable-next-line no-console
        console.info("[API] /auth/google body", {
          status: response.status,
          success: o ? o.success : undefined,
          code: o && typeof o.code === "string" ? o.code : undefined,
          message: o && typeof o.message === "string" ? o.message.slice(0, 200) : undefined,
        })
      }

      if (response.status === 401) {
        const p = normalizePath(path)
        if (!AUTH_401_NO_SESSION_EMIT.has(p)) {
          emit("novapulseai_auth_expired")
        }
        let msg401 = "Session expired"
        if (data && typeof data === "object") {
          const o = data as Record<string, unknown>
          if (typeof o.message === "string" && o.message.trim()) {
            msg401 = o.message.trim()
          } else if (typeof o.error === "string" && o.error.trim()) {
            msg401 = o.error.trim()
          }
        }
        throw new ApiError(
          msg401,
          401,
          "UNAUTHORIZED",
          data,
          data?.requestId || serverRequestId || requestId
        )
      }

      if (!response.ok) {
        // Only trip the breaker on upstream / transport style failures — not expected 4xx
        // (401 is handled above; 409 register, 400 validation, etc. must not open the circuit).
        const msg = String(data?.message ?? data?.error ?? "").toLowerCase()
        const envelopeCode =
          data && typeof data === "object" && "code" in data && typeof (data as { code?: unknown }).code === "string"
            ? String((data as { code: string }).code)
            : ""
        const isMisconfig503 =
          response.status === 503 &&
          (envelopeCode === "GOOGLE_NOT_CONFIGURED" ||
            envelopeCode === "DATABASE_SCHEMA_MIGRATION_REQUIRED" ||
            msg.includes("google") ||
            msg.includes("not configured") ||
            msg.includes("database is missing") ||
            msg.includes("schema not migrated"))
        const isServerSideFailure =
          response.status >= 500 && !isMisconfig503
        if (CIRCUIT_ENABLED && isServerSideFailure) {
          failureCount++
          if (failureCount >= CIRCUIT_THRESHOLD) {
            circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN
          }
        }

        // Retry logic for 5xx errors
        if (response.status >= 500 && attempt < retry) {
          const delay = Math.min(1000 * Math.pow(2, attempt), MAX_RETRY_DELAY)
          await sleep(delay)
          return internalFetch<T>(path, options, attempt + 1)
        }

        throw new ApiError(
          extractFailedResponseMessage(data, response),
          response.status,
          typeof data === "object" && data && "code" in data
            ? String((data as { code?: string }).code || "API_ERROR")
            : "API_ERROR",
          data,
          data?.requestId || serverRequestId || requestId
        )
      }

      failureCount = 0 // Reset on success

      if (validate && !validate(data)) {
        throw new ApiError(
          "Response validation failed.",
          422,
          "INVALID_RESPONSE",
          data,
          data?.requestId || serverRequestId || requestId
        )
      }

      return raw ? (response as unknown as T) : (data as T)

    } catch (error: any) {
      if (error.name === "AbortError") {
        if (CIRCUIT_ENABLED) {
          failureCount++
          if (failureCount >= CIRCUIT_THRESHOLD) {
            circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN
          }
        }
        throw new ApiError(
          "Request timed out. If this happens while starting a video job, try again — the server may have been cold-starting.",
          408,
          "TIMEOUT"
        )
      }

      if (error instanceof TypeError && /fetch/i.test(error.message)) {
        if (CIRCUIT_ENABLED) {
          failureCount++
          if (failureCount >= CIRCUIT_THRESHOLD) {
            circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN
          }
        }
        if (!silent) console.error("[Network Error]", error)
        throw new ApiError(
          typeof window !== "undefined"
            ? "Unable to reach the API. Start the backend (npm run dev in the server folder, port 5000) and reload this page."
            : "Network connection failed.",
          0,
          "NETWORK_ERROR"
        )
      }

      throw error
    } finally {
      clearTimeout(timeoutId)
      if (method === "GET" && !skipGetDedupe) {
        inFlight.delete(dedupeKey)
      }
      emit("novapulseai_request_end")
    }
  })()

  if (method === "GET" && !skipGetDedupe) {
    inFlight.set(dedupeKey, promise)
  }
  return promise
}

/* =====================================================
PUBLIC API
===================================================== */

export const api = {
  get: <T = unknown>(path: string, options?: ApiOptions) =>
    internalFetch<T>(path, { ...options, method: "GET" }),

  post: <T = unknown>(path: string, body?: unknown, options?: ApiOptions) =>
    internalFetch<T>(path, { ...options, method: "POST", body }),

  patch: <T = unknown>(path: string, body?: unknown, options?: ApiOptions) =>
    internalFetch<T>(path, { ...options, method: "PATCH", body }),

  put: <T = unknown>(path: string, body?: unknown, options?: ApiOptions) =>
    internalFetch<T>(path, { ...options, method: "PUT", body }),

  delete: <T = unknown>(path: string, options?: ApiOptions) =>
    internalFetch<T>(path, { ...options, method: "DELETE" }),
}

export default internalFetch