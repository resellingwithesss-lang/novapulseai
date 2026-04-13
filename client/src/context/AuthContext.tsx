"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  ReactNode,
} from "react"
import { api, ApiError } from "@/lib/api"
import { normalizePlan } from "@/lib/plans"
import { getTrialUrgency } from "@/lib/growth"

/* =====================================================
   TYPES
===================================================== */

export type Plan =
  | "FREE"
  | "STARTER"
  | "PRO"
  | "ELITE"

export type SubscriptionStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "EXPIRED"
  | "PAUSED"

export type Role =
  | "USER"
  | "ADMIN"
  | "SUPER_ADMIN"

export type User = {
  id: string
  email: string
  displayName?: string | null
  provider?: "LOCAL" | "GOOGLE" | "GITHUB"
  emailVerified?: boolean
  role: Role
  plan: Plan
  subscriptionStatus: SubscriptionStatus
  credits: number
  trialExpiresAt: string | null
  createdAt: string
  updatedAt: string
}

/* =====================================================
   STATUS
===================================================== */

type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"

type RefreshOptions = {
  silent?: boolean
  /** When true, network/HTTP failures (except 401) rethrow after clearing local session. */
  rethrow?: boolean
}

type AuthContextType = {
  user: User | null
  status: AuthStatus
  /** True after the first /auth/me attempt finishes (success, 401, or error). */
  hasResolvedSession: boolean
  isAuthenticated: boolean
  isAdmin: boolean
  isTrial: boolean
  isFree: boolean
  isStarter: boolean
  isPro: boolean
  isElite: boolean
  trialDaysLeft: number | null
  trialHoursLeft: number | null
  trialUrgency: "soft" | "strong" | "critical" | null
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: (options?: RefreshOptions) => Promise<User | null>
}

/* =====================================================
   CONTEXT
===================================================== */

const AuthContext = createContext<AuthContextType | null>(null)

/* =====================================================
   API TYPES
===================================================== */

type MeResponse = {
  success?: boolean
  user: User | null
}

/* =====================================================
   PROVIDER
===================================================== */

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [hasResolvedSession, setHasResolvedSession] = useState(false)

  const requestSeq = useRef(0)
  const mounted = useRef(false)

  /* =====================================================
     SAFE STATE SETTER
  ===================================================== */

  const safeSet = useCallback((fn: () => void) => {
    if (!mounted.current) return
    fn()
  }, [])

  /* =====================================================
     REFRESH USER
  ===================================================== */

  const refreshUser = useCallback(
    async (options?: RefreshOptions): Promise<User | null> => {
      const silent = options?.silent ?? true
      const rethrow = options?.rethrow ?? false
      const seq = ++requestSeq.current

      if (!silent) {
        safeSet(() => setStatus("loading"))
      }

      try {
        const data = await api.get<MeResponse>("/auth/me")

        if (seq !== requestSeq.current) return null

        const nextUser: User | null = data?.user ?? null

        if (nextUser) {
          safeSet(() => {
            setUser(nextUser)
            setStatus("authenticated")
          })
          return nextUser
        }

        safeSet(() => {
          setUser(null)
          setStatus("unauthenticated")
        })
        return null
      } catch (err) {
        if (seq !== requestSeq.current) return null

        const apiErr = err as ApiError

        if (apiErr?.status === 401) {
          safeSet(() => {
            setUser(null)
            setStatus("unauthenticated")
          })
          return null
        }

        if (process.env.NODE_ENV !== "production") {
          console.error("Auth refresh failed:", apiErr)
        }

        safeSet(() => {
          setUser(null)
          setStatus("unauthenticated")
        })

        if (rethrow) {
          throw apiErr
        }
        return null
      } finally {
        // Must not use `safeSet`: React Strict Mode can run effect cleanup (mounted=false)
        // between the /auth/me response and this finally, which would leave the UI stuck on
        // "Checking saved session…" forever (hasResolvedSession never flips).
        setHasResolvedSession(true)
      }
    },
    [safeSet]
  )

  const refreshUserRef = useRef(refreshUser)
  refreshUserRef.current = refreshUser

  /* =====================================================
     INITIAL BOOTSTRAP
  ===================================================== */

  useEffect(() => {
    mounted.current = true
    // Silent bootstrap: initial state is already "loading"; avoid re-blocking the tree.
    // Run once per mount (empty deps). Including `refreshUser` in deps can churn the effect
    // before the first /auth/me finishes in dev (Strict Mode + HMR), so the session banner
    // never clears and no outbound /auth/me is observed for a long time.
    void refreshUserRef.current({ silent: true })

    return () => {
      mounted.current = false
    }
  }, [])

  /* =====================================================
     AUTH EXPIRY LISTENER
  ===================================================== */

  useEffect(() => {
    const handleExpired = () => {
      requestSeq.current += 1

      safeSet(() => {
        setUser(null)
        setStatus("unauthenticated")
      })
    }

    window.addEventListener("novapulseai_auth_expired", handleExpired)

    return () => {
      window.removeEventListener("novapulseai_auth_expired", handleExpired)
    }
  }, [safeSet])

  /* =====================================================
     AUTH ACTIONS
  ===================================================== */

  const login = useCallback(
    async (email: string, password: string) => {
      safeSet(() => setStatus("loading"))

      try {
        await api.post("/auth/login", { email, password })
        const next = await refreshUser({ silent: true, rethrow: true })
        if (!next) {
          throw new ApiError(
            "Sign-in succeeded but your session was not saved (cookie missing). Use the same host for the site and API (e.g. only localhost or only 127.0.0.1), disable blocking extensions, or confirm the API is running on port 5000.",
            401,
            "SESSION_NOT_ESTABLISHED"
          )
        }
      } catch (err) {
        safeSet(() => {
          setUser(null)
          setStatus("unauthenticated")
        })
        throw err
      }
    },
    [refreshUser, safeSet]
  )

  const register = useCallback(
    async (email: string, password: string) => {
      safeSet(() => setStatus("loading"))

      try {
        await api.post("/auth/register", { email, password })
        const next = await refreshUser({ silent: true, rethrow: true })
        if (!next) {
          throw new ApiError(
            "Account created but your session was not saved (cookie missing). Try the same host (localhost vs 127.0.0.1), check extensions, and confirm the API is running.",
            401,
            "SESSION_NOT_ESTABLISHED"
          )
        }
      } catch (err) {
        safeSet(() => {
          setUser(null)
          setStatus("unauthenticated")
        })
        throw err
      }
    },
    [refreshUser, safeSet]
  )

  const logout = useCallback(async () => {
    requestSeq.current += 1

    safeSet(() => {
      setUser(null)
      setStatus("unauthenticated")
    })

    try {
      await api.post("/auth/logout")
    } catch {
      // ignore logout errors
    }
  }, [safeSet])

  /* =====================================================
     DERIVED STATE
  ===================================================== */

  const trialDaysLeft = useMemo(() => {
    if (!user?.trialExpiresAt) return null

    const diff =
      new Date(user.trialExpiresAt).getTime() - Date.now()

    return Math.max(
      Math.ceil(diff / (1000 * 60 * 60 * 24)),
      0
    )
  }, [user?.trialExpiresAt])
  const trialHoursLeft = useMemo(() => {
    if (!user?.trialExpiresAt) return null
    const diff = new Date(user.trialExpiresAt).getTime() - Date.now()
    return Math.max(Math.ceil(diff / (1000 * 60 * 60)), 0)
  }, [user?.trialExpiresAt])
  const trialUrgency = useMemo(
    () => getTrialUrgency(user?.trialExpiresAt ?? null),
    [user?.trialExpiresAt]
  )

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      status,
      hasResolvedSession,
      isAuthenticated: status === "authenticated",
      isAdmin:
        user?.role === "ADMIN" ||
        user?.role === "SUPER_ADMIN",
      isTrial:
        user?.subscriptionStatus === "TRIALING" &&
        normalizePlan(user?.plan) === "PRO",
      isFree: normalizePlan(user?.plan) === "FREE",
      isStarter: normalizePlan(user?.plan) === "STARTER",
      isPro: normalizePlan(user?.plan) === "PRO",
      isElite: normalizePlan(user?.plan) === "ELITE",
      trialDaysLeft,
      trialHoursLeft,
      trialUrgency,
      login,
      register,
      logout,
      refreshUser,
    }),
    [
      user,
      status,
      hasResolvedSession,
      trialDaysLeft,
      trialHoursLeft,
      trialUrgency,
      login,
      register,
      logout,
      refreshUser,
    ]
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

/* =====================================================
   HOOK
===================================================== */

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider")
  }

  return context
}