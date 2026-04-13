"use client"

import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

export default function AdminGate({
  children,
}: {
  children: React.ReactNode
}) {
  const { status, isAdmin } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/login?redirect=${encodeURIComponent("/admin")}`)
    }
  }, [status, router])

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0B0F19] text-white">
        <p className="text-sm text-white/60">Verifying admin access…</p>
      </main>
    )
  }

  if (status === "unauthenticated") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0B0F19] text-white">
        <p className="text-sm text-white/50">Redirecting to sign in…</p>
      </main>
    )
  }

  if (!isAdmin) {
    return (
      <main className="mx-auto min-h-screen max-w-lg bg-[#0B0F19] px-6 py-24 text-center text-white">
        <h1 className="text-xl font-semibold">Access restricted</h1>
        <p className="mt-2 text-sm text-white/55">
          This area is only available to administrators.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block text-sm font-medium text-purple-300 underline"
        >
          Back to dashboard
        </Link>
      </main>
    )
  }

  return <>{children}</>
}
