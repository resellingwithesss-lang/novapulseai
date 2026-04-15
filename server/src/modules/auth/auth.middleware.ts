import { Request, Response, NextFunction } from "express"
import jwt, { JwtPayload as DefaultJwtPayload } from "jsonwebtoken"
import { prisma } from "../../lib/prisma"
import { User } from "@prisma/client"
import { log } from "../../lib/logger"

const MAX_JWT_CHARS = 12_000

function extractBearerToken(header: string | undefined): string | null {
  if (!header || !header.startsWith("Bearer ")) return null
  const raw = header.slice("Bearer ".length).trim()
  return raw.length > 0 ? raw : null
}

export interface AuthRequest extends Request {
  user?: User
}

interface JwtPayload extends DefaultJwtPayload {
  sub?: string
  tokenVersion?: number
}

function requestIdFrom(req: Request): string | undefined {
  const id = (req as Request & { requestId?: string }).requestId
  return typeof id === "string" && id.trim() ? id.trim() : undefined
}

function unauthorized(res: Response, req: Request, message = "Unauthorized") {
  const requestId = requestIdFrom(req)
  return res.status(401).json({
    success: false,
    message,
    code: "UNAUTHORIZED",
    ...(requestId ? { requestId } : {}),
  })
}

function forbidden(res: Response, req: Request, message: string) {
  const requestId = requestIdFrom(req)
  return res.status(403).json({
    success: false,
    message,
    code: "FORBIDDEN",
    ...(requestId ? { requestId } : {}),
  })
}

function isValidJwtPayload(payload: unknown): payload is JwtPayload {
  if (!payload || typeof payload !== "object") return false
  const p = payload as JwtPayload
  return typeof p.sub === "string" && typeof p.tokenVersion === "number"
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    //////////////////////////////////////////////////////
    // 🔥 COOKIE OR BEARER SUPPORT (UPGRADED)
    //////////////////////////////////////////////////////

    let token: string | undefined =
      typeof req.cookies?.token === "string" ? req.cookies.token.trim() : undefined

    if (!token) {
      const bearer = extractBearerToken(req.headers.authorization)
      if (bearer) token = bearer
    }

    if (!token || token.length > MAX_JWT_CHARS) {
      return unauthorized(res, req)
    }

    const secret = process.env.JWT_SECRET
    if (!secret) {
      log.error("auth_misconfigured", { reason: "JWT_SECRET missing" })
      const requestId = requestIdFrom(req)
      return res.status(500).json({
        success: false,
        message: "Server misconfigured",
        code: "JWT_SECRET_MISSING",
        ...(requestId ? { requestId } : {}),
      })
    }

    let decoded: JwtPayload

    try {
      decoded = jwt.verify(token, secret, {
        algorithms: ["HS256"],
      }) as JwtPayload
    } catch {
      return unauthorized(res, req)
    }

    if (!isValidJwtPayload(decoded)) {
      return unauthorized(res, req, "Invalid token")
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
    })

    if (!user) return unauthorized(res, req)
    if (user.deletedAt) return forbidden(res, req, "Account deleted")
    if (user.banned) return forbidden(res, req, "Account banned")
    if (user.tokenVersion !== decoded.tokenVersion)
      return unauthorized(res, req, "Session expired")

    req.user = user
    return next()
  } catch (err) {
    log.error("auth_middleware_error", {
      requestId: typeof req.requestId === "string" ? req.requestId : undefined,
      message: err instanceof Error ? err.message : String(err),
    })
    return unauthorized(res, req)
  }
}