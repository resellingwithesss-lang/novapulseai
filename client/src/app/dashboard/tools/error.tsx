"use client"

import { useEffect } from "react"
import Link from "next/link"

export default function DashboardToolsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("dashboard/tools error:", error)
  }, [error])

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 py-16 text-center text-white">
      <h1 className="text-2xl font-semibold tracking-tight">
        This tool hit a snag
      </h1>
      <p className="mt-3 text-sm text-white/60">
        Something broke while loading or running the workspace. Your session is
        still safe — try again or return to the command center.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-full bg-gradient-to-r from-purple-500 to-pink-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 hover:brightness-105"
        >
          Try again
        </button>
        <Link
          href="/dashboard/tools"
          className="rounded-full border border-white/20 px-5 py-2.5 text-sm font-medium text-white/90 hover:bg-white/10"
        >
          All tools
        </Link>
        <Link
          href="/dashboard"
          className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-medium text-white/70 hover:text-white"
        >
          Dashboard
        </Link>
      </div>
    </main>
  )
}
