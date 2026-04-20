// client/src/components/auth/AuthGate.tsx
"use client"

import { useAuth } from "@/context/AuthContext"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo } from "react"
import { AuthSessionPendingShell } from "@/components/auth/AuthSessionPendingShell"

export default function AuthGate({
  children,
}: {
  children: React.ReactNode
}) {
  const { status, hasResolvedSession, user } = useAuth()

  const sessionPending =
    !hasResolvedSession || (status === "loading" && !user)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const redirectPath = useMemo(() => {
    if (!pathname) return "/dashboard"
    const query = searchParams?.toString()
    return query ? `${pathname}?${query}` : pathname
  }, [pathname, searchParams])

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(
        `/login?redirect=${encodeURIComponent(redirectPath)}`
      )
    }
  }, [status, router, redirectPath])

  useEffect(() => {
    const handleExpired = () =>
      router.replace(
        `/login?redirect=${encodeURIComponent(redirectPath)}`
      )
    window.addEventListener("novapulseai_auth_expired", handleExpired)
    return () =>
      window.removeEventListener(
        "novapulseai_auth_expired",
        handleExpired
      )
  }, [router, redirectPath])

  if (sessionPending) {
    return <AuthSessionPendingShell />
  }

  // Explicit refresh (e.g. refreshUser({ silent: false })) sets status to "loading" while user stays mounted.
  if (status === "loading" && user) {
    return <>{children}</>
  }

  if (status !== "authenticated") {
    return (
      <AuthSessionPendingShell message="Redirecting to sign in…" />
    )
  }

  return <>{children}</>
}