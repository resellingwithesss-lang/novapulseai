"use client"

import { useCallback, useEffect, useState, useMemo } from "react"
import { api } from "@/lib/api"
import { getPlanMonthlyPriceGbp, normalizePlan } from "@/lib/plans"

type UserRow = {
  id: string
  email: string
  plan: string
  subscriptionStatus: string
  credits: number
  createdAt: string
}

type DashboardStats = {
  stats: {
    totalUsers: number
    activeUsers: number
    trialUsers: number
    totalCreditsRemaining: number
    totalCreditsUsed: number
    metricsScope: string
  }
}

const CURRENCY = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
})

export default function RevenuePage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [stats, setStats] = useState<DashboardStats["stats"] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [usersRes, statsRes] = await Promise.all([
        api.get<{ users: UserRow[] }>("/admin/users?limit=100"),
        api.get<DashboardStats>("/admin/dashboard"),
      ])
      setUsers(usersRes.users || [])
      setStats(statsRes?.stats ?? null)
    } catch {
      setUsers([])
      setStats(null)
      setError("Failed to load revenue metrics.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const activeUsers = useMemo(() => {
    return users.filter((u) => u.subscriptionStatus === "ACTIVE" || u.subscriptionStatus === "TRIALING")
  }, [users])

  const mrr = useMemo(() => {
    return activeUsers.reduce((sum, u) => {
      const plan = normalizePlan(u.plan)
      return sum + getPlanMonthlyPriceGbp(plan)
    }, 0)
  }, [activeUsers])

  const arr = mrr * 12
  const estimatedCosts = mrr * 0.2
  const estimatedGrossMargin = mrr > 0 ? ((mrr - estimatedCosts) / mrr) * 100 : 0

  const planStats = useMemo(() => {
    const stats = {
      FREE: 0,
      STARTER: 0,
      PRO: 0,
      ELITE: 0,
    }

    activeUsers.forEach((u) => {
      const p = normalizePlan(u.plan)
      stats[p]++
    })

    return stats
  }, [activeUsers])

  const totalUsers = activeUsers.length

  const percentage = (count: number) =>
    totalUsers > 0
      ? ((count / totalUsers) * 100).toFixed(1)
      : "0"

  const newLast30Days = useMemo(() => {
    return activeUsers.filter((u) => {
      if (!u.createdAt) return false
      const created = new Date(u.createdAt)
      const now = new Date()
      const diff =
        (now.getTime() - created.getTime()) /
        86400000
      return diff <= 30
    }).length
  }, [activeUsers])

  const growthRate =
    totalUsers > 0
      ? ((newLast30Days / totalUsers) * 100).toFixed(1)
      : "0"

  return (
    <div className="space-y-8">
      <h1 className="bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-4xl font-bold text-transparent">
        Revenue Intelligence
      </h1>
      <p className="text-sm text-white/55">
        Revenue and subscription quality overview. Estimated revenue uses current plan mix from active and trialing accounts.
      </p>

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-white/50">
          Loading financial metrics...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
          <p className="text-sm text-red-200">{error}</p>
          <button
            onClick={fetchUsers}
            className="mt-4 rounded-xl border border-red-300/30 bg-red-500/20 px-4 py-2 text-sm text-red-100 hover:bg-red-500/30"
          >
            Retry
          </button>
        </div>
      ) : activeUsers.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-sm text-white/60">
          No active subscriptions yet.
        </div>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            <Card title="MRR (Estimated)" value={CURRENCY.format(mrr)} highlight />
            <Card title="ARR (Estimated)" value={CURRENCY.format(arr)} />
            <Card title="Gross Margin (Estimated)" value={`${estimatedGrossMargin.toFixed(1)}%`} />
            <Card title="Credits Remaining" value={`${(stats?.totalCreditsRemaining ?? 0).toLocaleString()}`} />
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <PlanCard
              plan="STARTER"
              count={planStats.STARTER}
              percent={percentage(planStats.STARTER)}
            />
            <PlanCard
              plan="PRO"
              count={planStats.PRO}
              percent={percentage(planStats.PRO)}
            />
            <PlanCard
              plan="ELITE"
              count={planStats.ELITE}
              percent={percentage(planStats.ELITE)}
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <div className="mb-2 text-sm text-white/40">Growth (Last 30 Days)</div>
                <div className="text-2xl font-semibold text-green-400">+{newLast30Days} accounts</div>
                <div className="mt-1 text-white/60">Growth rate: {growthRate}%</div>
              </div>
              <div>
                <div className="mb-2 text-sm text-white/40">Data Quality</div>
                <div className="text-white/80">
                  Scope: <span className="font-semibold">{stats?.metricsScope ?? "unknown"}</span>
                </div>
                <div className="mt-1 text-white/60">
                  Active/Trialing users counted: {activeUsers.length}
                </div>
                <div className="mt-1 text-white/60">
                  Estimated monthly infra cost: {CURRENCY.format(estimatedCosts)}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* =====================================================
   UI COMPONENTS
===================================================== */

function Card({
  title,
  value,
  highlight = false,
}: {
  title: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="p-6 rounded-2xl bg-white/[0.04] border border-white/10">
      <div className="text-sm text-white/40 mb-2">
        {title}
      </div>
      <div
        className={`text-2xl font-semibold ${
          highlight
            ? "text-purple-400"
            : "text-white"
        }`}
      >
        {value}
      </div>
    </div>
  )
}

function PlanCard({
  plan,
  count,
  percent,
}: {
  plan: string
  count: number
  percent: string
}) {
  return (
    <div className="p-6 rounded-2xl bg-white/[0.04] border border-white/10">
      <div className="text-sm text-white/40 mb-2">
        {plan}
      </div>

      <div className="text-2xl font-semibold text-purple-400">
        {count}
      </div>

      <div className="text-white/60 text-sm mt-1">
        {percent}% of subscribers
      </div>
    </div>
  )
}