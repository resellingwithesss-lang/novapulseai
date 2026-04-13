// client/src/components/auth/AuthGate.tsx
"use client"

import { useAuth } from "@/context/AuthContext"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo } from "react"

export default function AuthGate({
  children,
}: {
  children: React.ReactNode
}) {
  const { status } = useAuth()
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

  if (status === "loading") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="text-sm text-white/60">
          Loading your workspace…
        </div>
      </main>
    )
  }

  if (status !== "authenticated") return null

  return <>{children}</>
}