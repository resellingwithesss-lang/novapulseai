/// <reference path="../../types/express.d.ts" />
import { Router, type Response } from "express"
import rateLimit from "express-rate-limit"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { OAuth2Client } from "google-auth-library"
import { z } from "zod"
import { prisma } from "../../lib/prisma"
import { describePrismaSchemaDrift } from "../../lib/prisma-schema-health"
import { queueWelcomeEmailForNewUser } from "../../lib/email-outbound"
import { log, serializeErr } from "../../lib/logger"
import { fail, ok } from "../../lib/http"
import { staffFloorPlan } from "../../lib/staff-plan"
import { requireAuth, AuthRequest } from "./auth.middleware"
import {
  AuthProvider,
  Plan,
  Prisma,
  Role,
  SubscriptionStatus,
  type User as DbUser,
} from "@prisma/client"

const router = Router()

/* =====================================================
   ENV VALIDATION (HARDENED)
===================================================== */

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim() ?? ""
const { JWT_SECRET, NODE_ENV } = process.env

if (!JWT_SECRET?.trim()) {
  throw new Error("Missing JWT_SECRET")
}

// Warn if JWT_SECRET is weak (length < 32 chars)
if (JWT_SECRET && JWT_SECRET.length < 32) {
  // eslint-disable-next-line no-console
  console.warn("WARNING: JWT_SECRET is less than 32 characters. Use a strong, random secret in production.")
}

const isProduction = NODE_ENV === "production"

const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 50 : 800,
  standardHeaders: true,
  legacyHeaders: false,
})

/* =====================================================
   GOOGLE CLIENT (FIXED CORRECTLY)
===================================================== */

/**
 * DO NOT pass client ID to constructor.
 * Let verifyIdToken handle audience validation.
 */
const googleClient = new OAuth2Client()

/* =====================================================
   SCHEMAS
===================================================== */

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(100),
})

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1),
})

/** GSI One Tap sends `credential` (JWT); token client sends `accessToken` or `idToken`. */
const googleSchema = z.preprocess((raw: unknown) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
  const o = raw as Record<string, unknown>
  const out = { ...o }
  if (typeof o.credential === "string" && o.credential.length >= 10 && !o.idToken) {
    out.idToken = o.credential
  }
  return out
}, z
  .object({
    idToken: z.string().min(10).optional(),
    accessToken: z.string().min(10).optional(),
  })
  .refine(
    (value) => Boolean(value.idToken || value.accessToken),
    { message: "idToken, accessToken, or credential required" }
  ))

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(100),
})

/* =====================================================
   HELPERS (UPGRADED)
===================================================== */

function normalizeEmail(email: string) {
  return email.toLowerCase().trim()
}

function signToken(user: {
  id: string
  role: string
  tokenVersion: number
}) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion,
    },
    JWT_SECRET!,
    {
      expiresIn: "7d",
      algorithm: "HS256",
    }
  )
}

function cookieSameSite(): "lax" | "strict" | "none" {
  const raw = process.env.AUTH_COOKIE_SAMESITE?.trim().toLowerCase()
  if (raw === "none" || raw === "strict") return raw
  return "lax"
}

function setCookie(res: any, token: string) {
  const sameSite = cookieSameSite()
  const secure = isProduction || sameSite === "none"
  res.cookie("token", token, {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/",
  })
}

function clearCookie(res: any) {
  const sameSite = cookieSameSite()
  const secure = isProduction || sameSite === "none"
  res.clearCookie("token", {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
  })
}

function isUniqueConstraintError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code === "P2002"
  }
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    String((err as { code?: unknown }).code) === "P2002"
  )
}

function failIfSchemaDrift(res: Response, err: unknown, logLabel: string): boolean {
  const drift = describePrismaSchemaDrift(err)
  if (!drift) return false
  // eslint-disable-next-line no-console
  console.error(logLabel, drift.logLine)
  fail(res, 503, drift.httpMessage, {
    code: "DATABASE_SCHEMA_MIGRATION_REQUIRED",
    prismaCode: drift.prismaCode,
  })
  return true
}

function safeUser(user: any) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName ?? null,
    provider: user.provider,
    emailVerified: user.emailVerified,
    role: user.role,
    plan: staffFloorPlan(user.plan, user.role),
    subscriptionStatus: user.subscriptionStatus,
    credits: user.credits,
    trialExpiresAt: user.trialExpiresAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

type GoogleUserinfoPayload = {
  email?: string
  /** OIDC / v3 — boolean or (legacy) string */
  email_verified?: boolean | string
  /** OAuth2 v2-style field name */
  verified_email?: boolean | string
}

function googleEmailIsVerified(payload: GoogleUserinfoPayload): boolean {
  const coerce = (v: unknown) => {
    if (v === true || v === "true" || v === 1 || v === "1") return true
    if (v === false || v === "false" || v === 0 || v === "0") return false
    return null
  }
  const primary = coerce(payload.email_verified)
  if (primary === false) return false
  if (primary === true) return true
  const legacy = coerce(payload.verified_email)
  if (legacy === false) return false
  if (legacy === true) return true
  // Google often omits the claim when the address is verified (e.g. Gmail); do not block login.
  return true
}

type GoogleAccessTokenResult =
  | { ok: true; email: string }
  | {
      ok: false
      code: "GOOGLE_PROFILE_UNAVAILABLE" | "GOOGLE_EMAIL_UNVERIFIED"
      message: string
    }

/**
 * Resolve email from an OAuth2 access token (implicit / token client flow).
 * Tries OIDC userinfo first, then legacy oauth2/v3 — some tokens behave differently per endpoint.
 */
async function resolveGoogleEmailFromAccessToken(
  accessToken: string
): Promise<GoogleAccessTokenResult> {
  const trimmed = accessToken.trim()
  if (!trimmed) {
    return {
      ok: false,
      code: "GOOGLE_PROFILE_UNAVAILABLE",
      message:
        "Google sign-in did not return a usable token. Close the popup and try again, or use email and password.",
    }
  }

  const urls = [
    "https://openidconnect.googleapis.com/v1/userinfo",
    "https://www.googleapis.com/oauth2/v3/userinfo",
  ] as const

  let lastHttpStatus = 0
  let lastFetchError: string | null = null

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${trimmed}`,
        },
      })

      lastHttpStatus = response.status

      if (!response.ok) {
        continue
      }

      let payload: GoogleUserinfoPayload
      try {
        payload = (await response.json()) as GoogleUserinfoPayload
      } catch {
        continue
      }

      const rawEmail = typeof payload.email === "string" ? payload.email.trim() : ""
      if (!rawEmail) {
        continue
      }

      if (!googleEmailIsVerified(payload)) {
        return {
          ok: false,
          code: "GOOGLE_EMAIL_UNVERIFIED",
          message:
            "This Google account’s email is not verified. Verify it in your Google account, then try again.",
        }
      }

      return { ok: true, email: normalizeEmail(rawEmail) }
    } catch (netErr) {
      lastFetchError =
        netErr instanceof Error ? netErr.message : String(netErr ?? "unknown")
      // eslint-disable-next-line no-console
      console.warn("[auth/google] userinfo fetch threw", {
        url,
        err: lastFetchError,
      })
      continue
    }
  }

  // eslint-disable-next-line no-console
  console.warn("[auth/google] userinfo failed", {
    lastHttpStatus,
    lastFetchError,
    hint: "Check token scopes, clock, outbound HTTPS to Google, and Google Cloud OAuth consent.",
  })

  return {
    ok: false,
    code: "GOOGLE_PROFILE_UNAVAILABLE",
    message:
      lastFetchError
        ? "Could not reach Google to verify your session. Check server outbound HTTPS/DNS, then try again."
        : lastHttpStatus === 401
          ? "Google rejected the sign-in token (expired or invalid session). Try “Continue with Google” again."
          : "Google could not return your profile. Confirm Authorized JavaScript origins include this site’s URL (e.g. http://localhost:3000), then try again.",
  }
}

/* =====================================================
REGISTER
===================================================== */

router.post("/register", credentialLimiter, async (req, res) => {
  try {
    const parsed = registerSchema.safeParse(req.body)

    if (!parsed.success) {
      return fail(res, 400, "Invalid registration payload")
    }

    const email = normalizeEmail(parsed.data.email)

    const existing = await prisma.user.findFirst({
      where: { email },
    })

    if (existing) {
      return fail(res, 409, "User exists")
    }

    const hashed = await bcrypt.hash(parsed.data.password, 12)

    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        provider: "LOCAL",
        role: "USER",
        plan: Plan.FREE,
        subscriptionStatus: "CANCELED",
        credits: 4,
        tokenVersion: 0,
      },
    })

    void queueWelcomeEmailForNewUser({
      userId: user.id,
      email: user.email,
      displayName: null,
      viaGoogle: false,
    }).catch((err) => {
      log.warn("welcome_email_enqueue_failed", serializeErr(err))
    })

    const token = signToken(user)

    setCookie(res, token)

    return ok(res, {
      user: safeUser(user),
    })
  } catch (err) {
    console.error("REGISTER_ERROR", err)
    if (failIfSchemaDrift(res, err, "REGISTER_DB_SCHEMA_DRIFT")) return

    return fail(res, 500, "Registration failed")
  }
})

/* =====================================================
LOGIN
===================================================== */

router.post("/login", credentialLimiter, async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body)

    if (!parsed.success) {
      return fail(res, 400, "Invalid login payload")
    }

    const email = normalizeEmail(parsed.data.email)

    const user = await prisma.user.findFirst({
      where: {
        email,
        provider: "LOCAL",
        deletedAt: null,
      },
    })

    let valid = false

    if (user && user.password) {
      valid = await bcrypt.compare(parsed.data.password, user.password)
    } else {
      await bcrypt.compare(
        parsed.data.password,
        "$2a$12$invalidhashplaceholderinvalidhashplaceholder"
      )
    }

    if (!valid) {
      return fail(res, 401, "Invalid credentials")
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    const token = signToken(updated)

    setCookie(res, token)

    return ok(res, {
      user: safeUser(updated),
    })
  } catch (err) {
    console.error("LOGIN_ERROR", err)
    if (failIfSchemaDrift(res, err, "LOGIN_DB_SCHEMA_DRIFT")) return

    return fail(res, 500, "Login failed")
  }
})

/* =====================================================
GOOGLE LOGIN
===================================================== */

router.post("/google", credentialLimiter, async (req, res) => {
  const debugGoogle = process.env.DEBUG_GOOGLE_AUTH === "1"
  let googleAccountCreated = false
  try {
    if (debugGoogle) {
      const b = req.body as Record<string, unknown> | null
      // eslint-disable-next-line no-console
      console.warn("[auth/google] enter", {
        requestId: req.requestId,
        keys: b && typeof b === "object" ? Object.keys(b) : [],
        hasAccessToken: typeof b?.accessToken === "string",
        accessTokenLen:
          typeof b?.accessToken === "string" ? (b.accessToken as string).length : 0,
        hasIdToken: typeof b?.idToken === "string",
        idTokenLen: typeof b?.idToken === "string" ? (b.idToken as string).length : 0,
        hasCredential: typeof b?.credential === "string",
      })
    }

    if (!GOOGLE_CLIENT_ID) {
      return fail(
        res,
        503,
        "Google sign-in is not configured. Use email and password or set GOOGLE_CLIENT_ID.",
        { code: "GOOGLE_NOT_CONFIGURED" }
      )
    }

    const parsed = googleSchema.safeParse(req.body)

    if (!parsed.success) {
      return fail(res, 400, "Invalid Google auth payload")
    }

    let email: string | null = null

    if (parsed.data.idToken) {
      try {
        if (debugGoogle) {
          // eslint-disable-next-line no-console
          console.warn("[auth/google] verifyIdToken start", { requestId: req.requestId })
        }
        const ticket = await googleClient.verifyIdToken({
          idToken: parsed.data.idToken.trim(),
          audience: GOOGLE_CLIENT_ID,
        })

        const payload = ticket.getPayload()
        if (payload?.email && googleEmailIsVerified(payload as GoogleUserinfoPayload)) {
          email = normalizeEmail(payload.email)
        }
      } catch (verifyErr) {
        // eslint-disable-next-line no-console
        console.warn("[auth/google] verifyIdToken failed", {
          requestId: req.requestId,
          err: verifyErr,
        })
        return fail(
          res,
          401,
          "Google credential could not be verified. Set GOOGLE_CLIENT_ID to the same Web OAuth client ID as NEXT_PUBLIC_GOOGLE_CLIENT_ID.",
          { code: "GOOGLE_ID_TOKEN_INVALID" }
        )
      }

      if (!email) {
        return fail(res, 401, "Google did not return a verified email for this credential.", {
          code: "GOOGLE_EMAIL_UNVERIFIED",
        })
      }
    } else if (parsed.data.accessToken) {
      if (debugGoogle) {
        // eslint-disable-next-line no-console
        console.warn("[auth/google] resolve email from accessToken", {
          requestId: req.requestId,
          tokenLen: parsed.data.accessToken.length,
        })
      }
      const resolved = await resolveGoogleEmailFromAccessToken(parsed.data.accessToken)
      if (resolved.ok === false) {
        return fail(res, 401, resolved.message, { code: resolved.code })
      }
      email = resolved.email
    }

    if (!email) {
      return fail(res, 400, "Missing Google token.", { code: "GOOGLE_PAYLOAD_INCOMPLETE" })
    }

    if (debugGoogle) {
      // eslint-disable-next-line no-console
      console.warn("[auth/google] email resolved", { requestId: req.requestId, email })
    }

    let user = await prisma.user.findFirst({
      where: {
        email,
        provider: AuthProvider.GOOGLE,
        deletedAt: null,
      },
    })

    if (!user) {
      const shadow = await prisma.user.findFirst({
        where: { email, provider: AuthProvider.GOOGLE },
        select: { id: true, deletedAt: true },
      })

      if (shadow?.deletedAt != null) {
        user = await prisma.user.update({
          where: { id: shadow.id },
          data: {
            deletedAt: null,
            tokenVersion: { increment: 1 },
          },
        })
      } else {
        try {
          user = await prisma.user.create({
            data: {
              email,
              provider: AuthProvider.GOOGLE,
              role: Role.USER,
              plan: Plan.FREE,
              subscriptionStatus: SubscriptionStatus.CANCELED,
              credits: 4,
              tokenVersion: 0,
            },
          })
          googleAccountCreated = true
        } catch (createErr) {
          if (isUniqueConstraintError(createErr)) {
            const row = await prisma.user.findFirst({
              where: { email, provider: AuthProvider.GOOGLE },
            })
            if (row?.deletedAt != null) {
              user = await prisma.user.update({
                where: { id: row.id },
                data: {
                  deletedAt: null,
                  tokenVersion: { increment: 1 },
                },
              })
            } else {
              user = row
            }
          } else {
            throw createErr
          }
        }
      }
    }

    if (!user) {
      return fail(res, 500, "Could not create or load your Google-linked account.", {
        code: "GOOGLE_USER_UNAVAILABLE",
      })
    }

    if (user.banned) {
      return fail(
        res,
        403,
        "This account has been disabled. Contact support if you believe this is a mistake.",
        { code: "ACCOUNT_DISABLED" }
      )
    }

    if (debugGoogle) {
      // eslint-disable-next-line no-console
      console.warn("[auth/google] user row ready, issuing session", {
        requestId: req.requestId,
        userId: user.id,
      })
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    const token = signToken(updated)

    setCookie(res, token)

    if (debugGoogle) {
      // eslint-disable-next-line no-console
      console.warn("[auth/google] cookie set, success", { requestId: req.requestId })
    }

    if (googleAccountCreated) {
      void queueWelcomeEmailForNewUser({
        userId: updated.id,
        email: updated.email,
        displayName: (updated as DbUser).displayName ?? null,
        viaGoogle: true,
      }).catch((err) => {
        log.warn("welcome_email_enqueue_failed", serializeErr(err))
      })
    }

    return ok(res, {
      user: safeUser(updated),
    })
  } catch (err) {
    const anyErr = err as {
      message?: string
      code?: string
      name?: string
      stack?: string
    }
    const prismaMeta =
      err instanceof Prisma.PrismaClientKnownRequestError
        ? { code: err.code, meta: err.meta }
        : undefined
    // eslint-disable-next-line no-console
    console.error("GOOGLE_LOGIN_ERROR", {
      requestId: req.requestId,
      message: anyErr?.message,
      code: anyErr?.code,
      name: anyErr?.name,
      prisma: prismaMeta,
      stack: !isProduction ? anyErr?.stack : undefined,
    })

    if (isUniqueConstraintError(err)) {
      return fail(
        res,
        409,
        "An account already exists for this email. Use email and password, or contact support if you need the Google link restored.",
        { code: "GOOGLE_ACCOUNT_CONFLICT" }
      )
    }

    if (failIfSchemaDrift(res, err, "GOOGLE_LOGIN_DB_SCHEMA_DRIFT")) return

    return fail(
      res,
      500,
      "Google sign-in could not complete due to a server error. Try again in a moment.",
      { code: "GOOGLE_SIGNIN_SERVER_ERROR" }
    )
  }
})

/* =====================================================
LOGOUT
===================================================== */

router.post("/logout", requireAuth, async (req: AuthRequest, res) => {
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { tokenVersion: { increment: 1 } },
  })

  clearCookie(res)

  return ok(res)
})

/* =====================================================
ME
===================================================== */

router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
  })

  if (!user || user.deletedAt) {
    clearCookie(res)

    return fail(res, 401, "Unauthorized")
  }

  return ok(res, {
    user: safeUser(user),
  })
})

/* =====================================================
CHANGE PASSWORD (local accounts only)
===================================================== */

router.post("/change-password", requireAuth, async (req: AuthRequest, res) => {
  const parsed = changePasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    return fail(res, 400, "Invalid request", { issues: parsed.error.flatten() })
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, password: true, provider: true },
  })

  if (!user || !user.password) {
    return fail(
      res,
      400,
      "Password sign-in is not enabled for this account. Use Google or contact support."
    )
  }

  const match = await bcrypt.compare(
    parsed.data.currentPassword,
    user.password
  )
  if (!match) {
    return fail(res, 400, "Current password is incorrect")
  }

  const hashed = await bcrypt.hash(parsed.data.newPassword, 12)
  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashed,
      tokenVersion: { increment: 1 },
    },
  })

  clearCookie(res)
  return ok(res, { message: "Password updated. Sign in again with your new password." })
})

export default router