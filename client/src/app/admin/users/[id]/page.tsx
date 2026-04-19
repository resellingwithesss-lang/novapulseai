"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { api, ApiError } from "@/lib/api"
import { useAuth } from "@/context/AuthContext"
import { normalizePlan } from "@/lib/plans"

type AdminUserDetail = {
  id: string
  email: string
  displayName: string | null
  role: string
  plan: string
  subscriptionStatus: string
  subscriptionStartedAt: string | null
  subscriptionEndsAt: string | null
  cancelAtPeriodEnd: boolean
  trialExpiresAt: string | null
  credits: number
  monthlyCredits: number
  bonusCredits: number
  lifetimeCreditsUsed: number
  monthlyResetAt: string | null
  banned: boolean
  deletedAt: string | null
  createdAt: string
  provider: string
}

type Aggregates = {
  transactionCount: number
  generationCount: number
  adJobCount: number
}

type DetailResponse = {
  user: AdminUserDetail
  aggregates: Aggregates
}

type Transaction = {
  id: string
  amount: number
  type: string
  reason: string
  balanceAfter: number | null
  requestId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

type TransactionsResponse = {
  page: number
  limit: number
  total: number
  transactions: Transaction[]
}

const PLAN_OPTIONS = ["FREE", "STARTER", "PRO", "ELITE"] as const

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { isSuperAdmin } = useAuth()
  const userId = params?.id

  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [txPage, setTxPage] = useState(1)
  const [txTotal, setTxTotal] = useState(0)
  const [txLoading, setTxLoading] = useState(true)
  const [txError, setTxError] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)

  const [creditAmount, setCreditAmount] = useState<string>("")
  const [creditReason, setCreditReason] = useState<string>("")
  const [planValue, setPlanValue] = useState<(typeof PLAN_OPTIONS)[number]>("FREE")
  const [banReason, setBanReason] = useState<string>("")

  const loadDetail = useCallback(async () => {
    if (!userId) return
    try {
      setLoading(true)
      setError(null)
      const res = await api.get<DetailResponse>(`/admin/users/${userId}`)
      setDetail(res)
      setPlanValue(normalizePlan(res.user.plan) as (typeof PLAN_OPTIONS)[number])
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load user."
      setError(message)
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [userId])

  const loadTransactions = useCallback(async () => {
    if (!userId) return
    try {
      setTxLoading(true)
      setTxError(null)
      const res = await api.get<TransactionsResponse>(
        `/admin/users/${userId}/credit-transactions?page=${txPage}&limit=25`
      )
      setTransactions(res.transactions ?? [])
      setTxTotal(res.total ?? 0)
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load credit history."
      setTxError(message)
      setTransactions([])
    } finally {
      setTxLoading(false)
    }
  }, [userId, txPage])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  useEffect(() => {
    loadTransactions()
  }, [loadTransactions])

  const adjustCredits = useCallback(async () => {
    if (!userId) return
    const parsed = Number(creditAmount)
    if (!Number.isInteger(parsed) || parsed === 0) {
      setActionError("Amount must be a non-zero integer.")
      return
    }
    if (!creditReason.trim() || creditReason.trim().length < 3) {
      setActionError("A reason is required (3+ chars).")
      return
    }
    const verb = parsed > 0 ? "grant" : "debit"
    if (!window.confirm(`Confirm ${verb} of ${Math.abs(parsed)} credits for this user?`)) return
    setBusy(true)
    setActionError(null)
    setActionNotice(null)
    try {
      const res = await api.patch<{ balanceAfter: number }>(
        `/admin/users/${userId}/credits`,
        { amount: parsed, reason: creditReason.trim() }
      )
      setActionNotice(`Credits adjusted. New balance: ${res.balanceAfter.toLocaleString()}.`)
      setCreditAmount("")
      setCreditReason("")
      await Promise.all([loadDetail(), loadTransactions()])
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Request failed."
      setActionError(message)
    } finally {
      setBusy(false)
    }
  }, [userId, creditAmount, creditReason, loadDetail, loadTransactions])

  const updatePlan = useCallback(async () => {
    if (!userId) return
    if (!window.confirm(`Set plan to ${planValue}?`)) return
    setBusy(true)
    setActionError(null)
    setActionNotice(null)
    try {
      await api.patch(`/admin/users/${userId}/plan`, {
        plan: planValue,
        reason: creditReason.trim() || undefined,
      })
      setActionNotice(`Plan set to ${planValue}.`)
      await loadDetail()
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Request failed."
      setActionError(message)
    } finally {
      setBusy(false)
    }
  }, [userId, planValue, creditReason, loadDetail])

  const toggleBan = useCallback(async () => {
    if (!userId || !detail) return
    const nextBanned = !detail.user.banned
    const verb = nextBanned ? "ban" : "unban"
    if (!window.confirm(`Confirm ${verb} for ${detail.user.email}?`)) return
    setBusy(true)
    setActionError(null)
    setActionNotice(null)
    try {
      await api.patch(`/admin/users/${userId}/ban`, {
        banned: nextBanned,
        reason: banReason.trim() || undefined,
      })
      setActionNotice(nextBanned ? "User banned." : "User unbanned.")
      setBanReason("")
      await loadDetail()
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Request failed."
      setActionError(message)
    } finally {
      setBusy(false)
    }
  }, [userId, detail, banReason, loadDetail])

  const softDelete = useCallback(async () => {
    if (!userId || !detail) return
    if (!isSuperAdmin) {
      setActionError("Only Owners can soft-delete accounts.")
      return
    }
    if (
      !window.confirm(
        `Soft-delete ${detail.user.email}? They will be signed out and hidden from lists. Can only be reversed by database edit.`
      )
    ) {
      return
    }
    setBusy(true)
    setActionError(null)
    setActionNotice(null)
    try {
      await api.delete(`/admin/users/${userId}`, {
        body: banReason.trim() ? { reason: banReason.trim() } : undefined,
      })
      setActionNotice("User deleted.")
      setTimeout(() => router.push("/admin/users"), 600)
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Request failed."
      setActionError(message)
    } finally {
      setBusy(false)
    }
  }, [userId, detail, isSuperAdmin, banReason, router])

  const totalTxPages = useMemo(() => Math.max(1, Math.ceil(txTotal / 25)), [txTotal])

  if (loading && !detail) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-sm text-white/60">
        Loading user…
      </div>
    )
  }
  if (error || !detail) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
        {error ?? "User not found."}
        <div className="mt-4">
          <Link
            href="/admin/users"
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80"
          >
            Back to users
          </Link>
        </div>
      </div>
    )
  }

  const { user, aggregates } = detail

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <Link
            href="/admin/users"
            className="text-xs uppercase tracking-[0.12em] text-white/45 hover:text-white/75"
          >
            ← Users
          </Link>
          <h1 className="mt-2 text-3xl font-bold">{user.email}</h1>
          <p className="mt-1 text-sm text-white/55">
            {user.displayName ? `${user.displayName} · ` : ""}
            {user.provider}
            {user.deletedAt ? " · Deleted" : ""}
            {user.banned ? " · Banned" : ""}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="rounded-full border border-purple-400/30 bg-purple-500/10 px-2.5 py-1 text-purple-200">
            {normalizePlan(user.plan)}
          </span>
          <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-white/70">
            {user.subscriptionStatus}
          </span>
          <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">
            {user.credits.toLocaleString()} credits
          </span>
        </div>
      </div>

      {actionNotice ? (
        <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100/90">
          {actionNotice}
        </div>
      ) : null}
      {actionError ? (
        <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100/95">
          {actionError}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Current credits" value={user.credits.toLocaleString()} />
        <Stat label="Monthly cap" value={user.monthlyCredits.toLocaleString()} />
        <Stat label="Bonus credits" value={user.bonusCredits.toLocaleString()} />
        <Stat label="Lifetime used" value={user.lifetimeCreditsUsed.toLocaleString()} />
        <Stat label="Transactions" value={aggregates.transactionCount.toLocaleString()} />
        <Stat label="Generations" value={aggregates.generationCount.toLocaleString()} />
        <Stat label="Ad jobs" value={aggregates.adJobCount.toLocaleString()} />
        <Stat
          label="Monthly reset"
          value={user.monthlyResetAt ? new Date(user.monthlyResetAt).toLocaleDateString() : "—"}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-white/60">
            Credit adjustment
          </h2>
          <p className="mt-1 text-xs text-white/45">
            Positive amounts grant credits, negative amounts debit. A reason is required; it is
            written to the ledger and the audit log.
          </p>
          <div className="mt-4 space-y-2">
            <input
              type="number"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              placeholder="e.g. 100 or -50"
              className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={creditReason}
              onChange={(e) => setCreditReason(e.target.value)}
              placeholder="Reason (required)"
              className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={busy}
              onClick={adjustCredits}
              className="w-full rounded-lg border border-emerald-400/35 bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
            >
              Apply adjustment
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-white/60">
            Plan + access
          </h2>
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs text-white/55">Plan</label>
              <div className="mt-1 flex gap-2">
                <select
                  value={planValue}
                  onChange={(e) => setPlanValue(e.target.value as (typeof PLAN_OPTIONS)[number])}
                  className="np-select np-select--sm flex-1"
                >
                  {PLAN_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy}
                  onClick={updatePlan}
                  className="rounded-lg border border-purple-400/35 bg-purple-500/15 px-3 py-2 text-sm font-medium text-purple-100 hover:bg-purple-500/25 disabled:opacity-50"
                >
                  Apply
                </button>
              </div>
              {planValue === "ELITE" && !isSuperAdmin ? (
                <p className="mt-2 text-xs text-amber-200/80">
                  ELITE can only be assigned by Owners.
                </p>
              ) : null}
            </div>

            <div>
              <label className="text-xs text-white/55">Ban reason (optional)</label>
              <input
                type="text"
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="Context for ban / unban / delete"
                className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={toggleBan}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50 ${
                    user.banned
                      ? "border-emerald-400/35 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
                      : "border-red-400/35 bg-red-500/15 text-red-100 hover:bg-red-500/25"
                  }`}
                >
                  {user.banned ? "Unban" : "Ban"}
                </button>
                <button
                  type="button"
                  disabled={busy || !isSuperAdmin}
                  onClick={softDelete}
                  className="flex-1 rounded-lg border border-red-500/40 bg-red-500/20 px-3 py-2 text-sm font-medium text-red-100 hover:bg-red-500/30 disabled:opacity-40"
                  title={
                    isSuperAdmin
                      ? "Soft-delete this user"
                      : "Only Owners can soft-delete"
                  }
                >
                  Soft delete
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="flex items-baseline justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-white/60">
            Credit transactions
          </h2>
          <span className="text-xs text-white/45">{txTotal.toLocaleString()} total</span>
        </div>
        {txLoading ? (
          <div className="px-5 py-4 text-sm text-white/55">Loading…</div>
        ) : txError ? (
          <div className="px-5 py-4 text-sm text-red-200">{txError}</div>
        ) : transactions.length === 0 ? (
          <div className="px-5 py-4 text-sm text-white/55">No transactions yet.</div>
        ) : (
          <div>
            <div className="grid grid-cols-12 border-b border-white/5 px-5 py-2 text-[11px] uppercase tracking-wide text-white/45">
              <div className="col-span-3">When</div>
              <div className="col-span-2">Type</div>
              <div className="col-span-1 text-right">Amount</div>
              <div className="col-span-2 text-right">Balance after</div>
              <div className="col-span-4">Reason</div>
            </div>
            {transactions.map((t) => (
              <div
                key={t.id}
                className="grid grid-cols-12 items-baseline border-b border-white/5 px-5 py-3 text-sm last:border-none"
              >
                <div className="col-span-3 text-white/75">
                  {new Date(t.createdAt).toLocaleString()}
                </div>
                <div className="col-span-2 text-white/60">{t.type}</div>
                <div
                  className={`col-span-1 text-right font-mono ${
                    t.amount < 0 ? "text-red-200" : "text-emerald-200"
                  }`}
                >
                  {t.amount > 0 ? `+${t.amount}` : t.amount}
                </div>
                <div className="col-span-2 text-right text-white/80">
                  {t.balanceAfter === null ? "—" : t.balanceAfter.toLocaleString()}
                </div>
                <div className="col-span-4 truncate text-white/70">{t.reason}</div>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-white/5 px-5 py-3 text-xs text-white/55">
              <span>
                Page {txPage} / {totalTxPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={txPage <= 1}
                  onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border border-white/15 bg-white/5 px-3 py-1 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={txPage >= totalTxPages}
                  onClick={() => setTxPage((p) => Math.min(totalTxPages, p + 1))}
                  className="rounded-lg border border-white/15 bg-white/5 px-3 py-1 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-white/45">{label}</div>
      <div className="mt-1 text-base text-white">{value}</div>
    </div>
  )
}
