"use client"

import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { useGrowthSurface } from "@/hooks/useGrowthSurface"

/**
 * Contextual upgrade / retention strip on the dashboard (non-blocking).
 */
export default function DashboardGrowthBanner() {
  const { user } = useAuth()
  const { banner, loading } = useGrowthSurface()

  if (!user || loading || !banner) return null

  return (
    <div className="rounded-2xl border border-purple-500/25 bg-gradient-to-r from-purple-600/[0.18] to-pink-600/[0.12] px-5 py-4 text-sm text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl leading-relaxed">{banner.message}</p>
        <Link
          href={banner.href}
          className="shrink-0 rounded-full bg-white/15 px-4 py-2 text-xs font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/25"
        >
          {banner.cta}
        </Link>
      </div>
    </div>
  )
}
