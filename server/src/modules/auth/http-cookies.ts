import type { Response } from "express"

const isProduction = process.env.NODE_ENV === "production"

export function cookieSameSite(): "lax" | "strict" | "none" {
  const raw = process.env.AUTH_COOKIE_SAMESITE?.trim().toLowerCase()
  if (raw === "none" || raw === "strict") return raw
  return "lax"
}

function cookieSecure(sameSite: ReturnType<typeof cookieSameSite>): boolean {
  return isProduction || sameSite === "none"
}

export function setAuthTokenCookie(res: Response, token: string) {
  const sameSite = cookieSameSite()
  const secure = cookieSecure(sameSite)
  res.cookie("token", token, {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  })
}

export function clearAuthTokenCookie(res: Response) {
  const sameSite = cookieSameSite()
  const secure = cookieSecure(sameSite)
  res.clearCookie("token", {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
  })
}

const IMP_RESTORE_MAX_MS = 4 * 60 * 60 * 1000

/** Backs up the operator cookie before issuing a preview-as-user session. */
export function setImpRestoreCookie(res: Response, token: string) {
  const sameSite = cookieSameSite()
  const secure = cookieSecure(sameSite)
  res.cookie("imp_restore", token, {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: IMP_RESTORE_MAX_MS,
    path: "/",
  })
}

export function clearImpRestoreCookie(res: Response) {
  const sameSite = cookieSameSite()
  const secure = cookieSecure(sameSite)
  res.clearCookie("imp_restore", {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
  })
}
