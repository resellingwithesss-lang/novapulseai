"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { api } from "@/lib/api"
import { normalizePlan } from "@/lib/plans"

type User = {
  id: string
  email: string
  plan: string
  credits: number
  banned: boolean
  subscriptionStatus: string
  createdAt: string
}

export default function SubscriptionsPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [planFilter, setPlanFilter] = useState<
    "ALL" | "FREE" | "STARTER" | "PRO" | "ELITE"
  >("ALL")
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED" | "EXPIRED">("ALL")

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await api.get<{ users: User[] }>("/admin/users?limit=100")
      setUsers(res.users || [])
    } catch {
      setUsers([])
      setError("Failed to load subscriptions.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const latestUsers = [...users]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() -
        new Date(a.createdAt).getTime()
    )
    .slice(0, 100)

  const filteredUsers = useMemo(() => {
    return latestUsers
      .filter((user) => {
        if (!search.trim()) return true
        return user.email.toLowerCase().includes(search.toLowerCase())
      })
      .filter((user) => {
        if (planFilter === "ALL") return true
        return normalizePlan(user.plan) === planFilter
      })
      .filter((user) => {
        if (statusFilter === "ALL") return true
        return user.subscriptionStatus === statusFilter
      })
  }, [latestUsers, search, planFilter, statusFilter])

  const statusBadgeClass = (status: string) => {
    if (status === "ACTIVE") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/25"
    if (status === "TRIALING") return "bg-blue-500/15 text-blue-300 border-blue-500/25"
    if (status === "PAST_DUE") return "bg-red-500/15 text-red-300 border-red-500/25"
    return "bg-yellow-500/15 text-yellow-200 border-yellow-500/25"
  }

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Subscriptions</h1>
      <p className="text-sm text-white/55">
        Recent subscription accounts with plan, status, and credit visibility for support and billing operations.
      </p>

      <div className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search email"
          className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm"
        />
        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value as typeof planFilter)}
          className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm"
        >
          <option value="ALL">All Plans</option>
          <option value="FREE">Free</option>
          <option value="STARTER">Starter</option>
          <option value="PRO">Pro</option>
          <option value="ELITE">Elite</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm"
        >
          <option value="ALL">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="TRIALING">Trialing</option>
          <option value="PAST_DUE">Past due</option>
          <option value="CANCELED">Canceled</option>
          <option value="EXPIRED">Expired</option>
        </select>
        <div className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white/65">
          Showing {filteredUsers.length} of {latestUsers.length}
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-sm text-white/60">
          Loading subscriptions...
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
      ) : filteredUsers.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-sm text-white/60">
          No subscriptions match current filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
          <div className="grid grid-cols-12 border-b border-white/10 px-4 py-3 text-xs uppercase tracking-wide text-white/45">
            <div className="col-span-4">Account</div>
            <div className="col-span-2">Plan</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Credits</div>
            <div className="col-span-2">Created</div>
          </div>
          {filteredUsers.map((u) => (
            <div
              key={u.id}
              className="grid grid-cols-12 items-center border-b border-white/5 px-4 py-3 text-sm last:border-none"
            >
              <div className="col-span-4 truncate pr-3 text-white">{u.email}</div>
              <div className="col-span-2 text-purple-300">{normalizePlan(u.plan)}</div>
              <div className="col-span-2">
                <span className={`rounded-full border px-2 py-1 text-xs ${statusBadgeClass(u.subscriptionStatus)}`}>
                  {u.subscriptionStatus}
                </span>
              </div>
              <div className="col-span-2 text-white/70">{u.credits.toLocaleString()}</div>
              <div className="col-span-2 text-white/55">
                {new Date(u.createdAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}