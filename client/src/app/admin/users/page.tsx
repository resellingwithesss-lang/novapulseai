"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { api, ApiError } from "@/lib/api"
import { normalizePlan } from "@/lib/plans"
import { isAdminOrAboveRole, roleDisplayName } from "@/lib/roles"

type AdminUserRow = {
  id: string
  email: string
  role: string
  plan: string
  subscriptionStatus: string
  credits: number
  banned: boolean
  createdAt: string
}

type UsersResponse = {
  page: number
  limit: number
  total: number
  users: AdminUserRow[]
}

const PLAN_OPTIONS = ["ALL", "FREE", "STARTER", "PRO", "ELITE"] as const
const STATUS_OPTIONS = [
  "ALL",
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
  "CANCELED",
  "EXPIRED",
  "PAUSED",
] as const

export default function AdminUsersPage() {
  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit] = useState(25)
  const [search, setSearch] = useState("")
  const [planFilter, setPlanFilter] = useState<(typeof PLAN_OPTIONS)[number]>("ALL")
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("ALL")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("limit", String(limit))
      if (search.trim()) params.set("search", search.trim())
      if (planFilter !== "ALL") params.set("plan", planFilter)
      if (statusFilter !== "ALL") params.set("subscriptionStatus", statusFilter)
      const res = await api.get<UsersResponse>(`/admin/users?${params.toString()}`)
      setRows(res.users ?? [])
      setTotal(res.total ?? 0)
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load users."
      setError(message)
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, limit, search, planFilter, statusFilter])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const totalPages = Math.max(1, Math.ceil(total / limit))
  const pageLabel = useMemo(() => `Page ${page} / ${totalPages}`, [page, totalPages])

  const statusBadgeClass = (status: string) => {
    if (status === "ACTIVE") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/25"
    if (status === "TRIALING") return "bg-blue-500/15 text-blue-300 border-blue-500/25"
    if (status === "PAST_DUE") return "bg-red-500/15 text-red-300 border-red-500/25"
    if (status === "CANCELED") return "bg-zinc-500/15 text-zinc-300 border-zinc-500/25"
    return "bg-yellow-500/15 text-yellow-200 border-yellow-500/25"
  }

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    fetchUsers()
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Users</h1>
          <p className="mt-1 text-sm text-white/55">
            Server-paginated directory of NovaPulse accounts. Open a user to adjust plan, credits,
            or ban state with full audit trails.
          </p>
        </div>
        <div className="text-xs uppercase tracking-[0.12em] text-white/45">
          {total.toLocaleString()} accounts
        </div>
      </div>

      <form
        onSubmit={onSubmitSearch}
        className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-5"
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search email"
          className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm md:col-span-2"
        />
        <select
          value={planFilter}
          onChange={(e) => {
            setPlanFilter(e.target.value as (typeof PLAN_OPTIONS)[number])
            setPage(1)
          }}
          className="np-select np-select--sm w-full"
        >
          {PLAN_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p === "ALL" ? "All plans" : p}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as (typeof STATUS_OPTIONS)[number])
            setPage(1)
          }}
          className="np-select np-select--sm w-full"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === "ALL" ? "All statuses" : s}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg border border-purple-400/35 bg-purple-500/15 px-3 py-2 text-sm font-medium text-purple-100 hover:bg-purple-500/25"
        >
          Apply
        </button>
      </form>

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-sm text-white/60">
          Loading users…
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
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-sm text-white/60">
          No users match current filters.
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
          {rows.map((u) => (
            <Link
              key={u.id}
              href={`/admin/users/${u.id}`}
              className="grid grid-cols-12 items-center border-b border-white/5 px-4 py-3 text-sm transition last:border-none hover:bg-white/[0.04]"
            >
              <div className="col-span-4 truncate pr-3 text-white">
                <span>{u.email}</span>
                {u.banned ? (
                  <span className="ml-2 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-red-200">
                    Banned
                  </span>
                ) : null}
                {isAdminOrAboveRole(u.role) ? (
                  <span className="ml-2 rounded-full border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
                    {roleDisplayName(u.role)}
                  </span>
                ) : null}
              </div>
              <div className="col-span-2 text-purple-300">{normalizePlan(u.plan)}</div>
              <div className="col-span-2">
                <span className={`rounded-full border px-2 py-1 text-xs ${statusBadgeClass(u.subscriptionStatus)}`}>
                  {u.subscriptionStatus}
                </span>
              </div>
              <div className="col-span-2 text-white/80">{u.credits.toLocaleString()}</div>
              <div className="col-span-2 text-white/55">
                {new Date(u.createdAt).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-white/60">
        <span>{pageLabel}</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
