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
import { displayPlanForUser } from "@/lib/plans"
import { isAdminOrAboveRole, isOwnerRole } from "@/lib/roles"
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

/**
 * Client-side Role union (Phase C-lite).
 *
 * Phase A added OWNER and CREATOR to the DB enum. Phase B will migrate rows
 * (SUPER_ADMIN -> OWNER, active USER -> CREATOR). Until Phase B runs, no row
 * holds OWNER / CREATOR, so the extra values here are inert in production.
 *
 * SUPER_ADMIN remains in the union during the transition so existing tokens
 * and API responses keep type-checking; Phase E removes it from the enum and
 * from this union in the same release.
 */
export type Role =
  | "USER"
  | "CREATOR"
  | "ADMIN"
  | "OWNER"
  | "SUPER_ADMIN"

export type MarketingConsentStatus =
  | "UNKNOWN"
  | "OPTED_IN"
  | "OPTED_OUT"
  | "DISMISSED"
  | "LEGACY_OPT_IN"

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
  /** Server-side activity heartbeat; used for subtle re-engagement prompts. */
  lastActiveAt?: string | null
  createdAt: string
  updatedAt: string
  /* Lifecycle marketing consent (Phase 1).
     Read-only on the client; mutations go through /api/marketing/consent
     which refreshUser() after a successful change. */
  marketingConsentStatus?: MarketingConsentStatus
  marketingDismissedAt?: string | null
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

export type AdminPreviewSession = {
  impersonatorId: string
  impersonatorEmail: string
} | null

type AuthContextType = {
  user: User | null
  status: AuthStatus
  /** True after the first /auth/me attempt finishes (success, 401, or error). */
  hasResolvedSession: boolean
  /** Owner preview-as-user: operator context for banner + exit. */
  adminPreview: AdminPreviewSession
  isAuthenticated: boolean
  isAdmin: boolean
  /** True for OWNER or the deprecated SUPER_ADMIN role. */
  isOwner: boolean
  /** @deprecated Use `isOwner`. Alias kept for backward compatibility; Phase C-full removes. */
  isSuperAdmin: boolean
  isTrial: boolean
  isFree: boolean
  isStarter: boolean
  isPro: boolean
  isElite: boolean
  trialDaysLeft: number | null
  trialHoursLeft: number | null
  trialUrgency: "soft" | "strong" | "critical" | null
  login: (email: string, password: string) => Promise<void>
  register: (
    email: string,
    password: string,
    options?: { referralCode?: string }
  ) => Promise<void>
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
  impersonation?: {
    impersonator: { id: string; email: string }
  } | null
}

/* =====================================================
   PROVIDER
===================================================== */

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [hasResolvedSession, setHasResolvedSession] = useState(false)
  const [adminPreview, setAdminPreview] = useState<AdminPreviewSession>(null)

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
        const imp = data?.impersonation?.impersonator

        if (nextUser) {
          safeSet(() => {
            setUser(nextUser)
            setStatus("authenticated")
            if (imp?.id && imp.email) {
              setAdminPreview({
                impersonatorId: imp.id,
                impersonatorEmail: imp.email,
              })
            } else {
              setAdminPreview(null)
            }
          })
          return nextUser
        }

        safeSet(() => {
          setUser(null)
          setStatus("unauthenticated")
          setAdminPreview(null)
        })
        return null
      } catch (err) {
        if (seq !== requestSeq.current) return null

        const apiErr = err as ApiError

        if (apiErr?.status === 401) {
          safeSet(() => {
            setUser(null)
            setStatus("unauthenticated")
            setAdminPreview(null)
          })
          return null
        }

        if (process.env.NODE_ENV !== "production") {
          console.error("Auth refresh failed:", apiErr)
        }

        safeSet(() => {
          setUser(null)
          setStatus("unauthenticated")
          setAdminPreview(null)
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
        setAdminPreview(null)
      })
    }

    window.addEventListener("novapulseai_auth_expired", handleExpired)

    return () => {
      window.removeEventListener("novapulseai_auth_expired", handleExpired)
    }
  }, [safeSet])

  /* =====================================================
     REFRESH SESSION WHEN TAB RETURNS (plan / role changes)
  ===================================================== */

  useEffect(() => {
    if (typeof document === "undefined") return
    let t: ReturnType<typeof setTimeout> | undefined
    const onVis = () => {
      if (document.visibilityState !== "visible") return
      clearTimeout(t)
      t = setTimeout(() => {
        void refreshUserRef.current({ silent: true })
      }, 400)
    }
    document.addEventListener("visibilitychange", onVis)
    return () => {
      document.removeEventListener("visibilitychange", onVis)
      clearTimeout(t)
    }
  }, [])

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
          setAdminPreview(null)
        })
        throw err
      }
    },
    [refreshUser, safeSet]
  )

  const register = useCallback(
    async (
      email: string,
      password: string,
      options?: { referralCode?: string }
    ) => {
      safeSet(() => setStatus("loading"))

      try {
        await api.post("/auth/register", {
          email,
          password,
          ...(options?.referralCode
            ? { referralCode: options.referralCode }
            : {}),
        })
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
          setAdminPreview(null)
        })
        throw err
      }
    },
    [refreshUser, safeSet]
  )

  const logout = useCallback(async () => {
    requestSeq.current += 1

    try {
      await api.post("/auth/logout")
    } catch {
      // ignore logout errors
    }

    await refreshUser({ silent: true })
  }, [refreshUser])

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
      adminPreview,
      isAuthenticated: status === "authenticated",
      isAdmin: isAdminOrAboveRole(user?.role),
      isOwner: isOwnerRole(user?.role),
      isSuperAdmin: isOwnerRole(user?.role),
      isTrial:
        user?.subscriptionStatus === "TRIALING" &&
        displayPlanForUser(user?.plan, user?.role) === "PRO",
      isFree: displayPlanForUser(user?.plan, user?.role) === "FREE",
      isStarter: displayPlanForUser(user?.plan, user?.role) === "STARTER",
      isPro: displayPlanForUser(user?.plan, user?.role) === "PRO",
      isElite: displayPlanForUser(user?.plan, user?.role) === "ELITE",
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
      adminPreview,
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