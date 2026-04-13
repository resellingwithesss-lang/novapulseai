"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { api, ApiError } from "@/lib/api"
import { AdminActivityFeed } from "./_components/overview/AdminActivityFeed"
import { AdminAlertsBanner } from "./_components/overview/AdminAlertsBanner"
import { AdminBillingAndGrowth } from "./_components/overview/AdminBillingAndGrowth"
import { AdminJobsTables } from "./_components/overview/AdminJobsTables"
import { AdminKpiGrid } from "./_components/overview/AdminKpiGrid"
import { AdminOperationalHealth } from "./_components/overview/AdminOperationalHealth"
import { AdminOverviewHeader } from "./_components/overview/AdminOverviewHeader"
import { AdminOverviewSkeleton } from "./_components/overview/AdminOverviewSkeleton"
import type { AdminOverviewPayload } from "./_components/overview/adminOverviewTypes"

export default function AdminHomePage() {
  const [data, setData] = useState<AdminOverviewPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await api.get<
        AdminOverviewPayload & { success?: boolean; message?: string }
      >("/admin/overview")
      if (res && typeof res === "object" && "kpis" in res) {
        setData({
          refreshedAt: res.refreshedAt,
          kpis: res.kpis,
          billing: res.billing,
          health: res.health,
          growth: res.growth,
          alerts: res.alerts,
          activity: res.activity,
        })
      } else {
        setData(null)
        setError("Unexpected response from overview API.")
      }
    } catch (e) {
      console.error(e)
      setData(null)
      setError(
        e instanceof ApiError
          ? e.message
          : "Could not load overview. Check API connectivity and try again."
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !data) {
    return (
      <main className="max-w-7xl">
        <AdminOverviewSkeleton />
      </main>
    )
  }

  if (error && !data) {
    return (
      <main className="max-w-7xl space-y-6">
        <AdminOverviewHeader refreshedAt={null} loading={false} onRefresh={() => void load()} />
        <div
          className="rounded-2xl border border-red-500/30 bg-red-500/[0.1] px-5 py-6"
          role="alert"
        >
          <p className="text-sm font-medium text-red-100/95">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.06] px-5 text-sm font-medium text-white hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45"
          >
            Retry
          </button>
        </div>
      </main>
    )
  }

  if (!data) {
    return null
  }

  return (
    <main className="max-w-7xl space-y-10 pb-12">
      <AdminOverviewHeader
        refreshedAt={data.refreshedAt}
        loading={loading}
        onRefresh={() => void load()}
      />

      <AdminAlertsBanner alerts={data.alerts} />

      <AdminKpiGrid kpis={data.kpis} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <AdminOperationalHealth health={data.health} />
          <AdminJobsTables health={data.health} />
        </div>
        <AdminBillingAndGrowth billing={data.billing} growth={data.growth} />
      </div>

      <AdminActivityFeed items={data.activity} />

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] pt-8 text-sm text-white/45">
        <Link
          href="/dashboard"
          className="font-medium text-purple-200/90 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45"
        >
          ← Return to app dashboard
        </Link>
        <span aria-hidden className="text-white/25">
          ·
        </span>
        <span className="text-xs text-white/35">
          Est. MRR uses list prices from server config (same basis as Revenue page).
        </span>
      </footer>
    </main>
  )
}
