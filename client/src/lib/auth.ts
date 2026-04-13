/* =====================================================
   AUTH STORAGE ENGINE — PRODUCTION VERSION
===================================================== */

const TOKEN_KEY = "npai_token"
const USER_KEY = "npai_user"
const META_KEY = "npai_meta"

const STORAGE_VERSION = 2
const MAX_SESSION_AGE = 7 * 24 * 60 * 60 * 1000 // 7 days

type StoredUser = {
  id: string
  email: string
  role: string
  plan: string
  subscriptionStatus: string
  credits: number
  trialExpiresAt?: string
}

type AuthMeta = {
  loginAt: number
  version: number
}

function isBrowser(): boolean {
  return typeof window !== "undefined"
}

function safeParse<T>(value: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

/* =====================================================
   TOKEN HELPERS
===================================================== */

function decodeJwt(token: string): any | null {
  try {
    const payload = token.split(".")[1]
    return JSON.parse(atob(payload))
  } catch {
    return null
  }
}

function isTokenExpired(token: string): boolean {
  const decoded = decodeJwt(token)
  if (!decoded?.exp) return false

  const expiry = decoded.exp * 1000
  return Date.now() > expiry
}

/* =====================================================
   TOKEN MANAGEMENT
===================================================== */

export function getToken(): string | null {
  if (!isBrowser()) return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  if (!isBrowser()) return
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  if (!isBrowser()) return
  localStorage.removeItem(TOKEN_KEY)
}

/* =====================================================
   USER MANAGEMENT
===================================================== */

export function getStoredUser(): StoredUser | null {
  if (!isBrowser()) return null
  return safeParse<StoredUser>(localStorage.getItem(USER_KEY))
}

export function setStoredUser(user: StoredUser) {
  if (!isBrowser()) return
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearStoredUser() {
  if (!isBrowser()) return
  localStorage.removeItem(USER_KEY)
}

/* =====================================================
   META MANAGEMENT
===================================================== */

function setMeta() {
  if (!isBrowser()) return

  const meta: AuthMeta = {
    loginAt: Date.now(),
    version: STORAGE_VERSION,
  }

  localStorage.setItem(META_KEY, JSON.stringify(meta))
}

function clearMeta() {
  if (!isBrowser()) return
  localStorage.removeItem(META_KEY)
}

/* =====================================================
   SESSION VALIDATION
===================================================== */

export function isSessionValid(): boolean {
  if (!isBrowser()) return false

  const token = getToken()
  const user = getStoredUser()
  const meta = safeParse<AuthMeta>(localStorage.getItem(META_KEY))

  if (!token || !user || !meta) return false

  if (meta.version !== STORAGE_VERSION) {
    clearAuth()
    return false
  }

  if (isTokenExpired(token)) {
    clearAuth()
    return false
  }

  if (Date.now() - meta.loginAt > MAX_SESSION_AGE) {
    clearAuth()
    return false
  }

  return true
}

/* =====================================================
   FULL AUTH SETTER
===================================================== */

export function setAuth(data: {
  accessToken: string
  user: StoredUser
}) {
  if (!isBrowser()) return

  setToken(data.accessToken)
  setStoredUser(data.user)
  setMeta()

  // Sync logout across tabs
  window.dispatchEvent(new Event("npai_auth_updated"))
}

/* =====================================================
   CLEAR EVERYTHING
===================================================== */

export function clearAuth() {
  clearToken()
  clearStoredUser()
  clearMeta()

  window.dispatchEvent(new Event("npai_auth_updated"))
}