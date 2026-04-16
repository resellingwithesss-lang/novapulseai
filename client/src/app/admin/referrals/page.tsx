"use client"

import { useCallback, useEffect, useState } from "react"
import { api, ApiError } from "@/lib/api"

type Summary = {
  totalCommissions: number
  attributedSignups: number
  byStatus: { status: string; count: number; totalCommissionMinor: number }[]
  rateBps: number
  firstPaymentOnly: boolean
}

type CommissionRow = {
  id: string
  status: string
  currency: string
  invoiceAmountMinor: number
  commissionRateBps: number
  commissionAmountMinor: number
  plan: string | null
  stripeInvoiceId: string
  stripeEventId: string | null
  createdAt: string
  referrer: { id: string; email: string; referralCode: string | null }
  referee: { id: string; email: string }
}

function money(minor: number, currency: string) {
  const c = currency.toUpperCase() === "GBP" ? "GBP" : currency.toUpperCase()
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: c.length === 3 ? c : "GBP",
    }).format(minor / 100)
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`
  }
}

export default function AdminReferralsPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [rows, setRows] = useState<CommissionRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState("all")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [sRes, cRes] = await Promise.all([
        api.get<{ success?: boolean } & Summary>("/admin/referrals/summary"),
        api.get<{
          success?: boolean
          commissions: CommissionRow[]
          total: number
          page: number
          limit: number
        }>(
          `/admin/referrals/commissions?page=${page}&limit=25${
            statusFilter !== "all"
              ? `&status=${encodeURIComponent(statusFilter)}`
              : ""
          }&search=${encodeURIComponent(query.trim())}`
        ),
      ])
      setSummary(sRes as Summary)
      setRows(cRes.commissions || [])
      setTotal(cRes.total ?? 0)
    } catch (e) {
      setSummary(null)
      setRows([])
      setError(e instanceof ApiError ? e.message : "Failed to load referrals.")
    } finally {
      setLoading(false)
    }
  }, [page, query, statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  const patchStatus = async (id: string, status: string) => {
    if (status === "VOID") {
      const ok = window.confirm(
        "Void this commission row? It will be excluded from totals in NovaPulse. Stripe and the customer’s subscription are unchanged."
      )
      if (!ok) return
    }
    if (status === "PAID") {
      const ok = window.confirm(
        "Record this commission as paid in the internal ledger? This does not move money, create a Stripe transfer, or change the invoice in Stripe."
      )
      if (!ok) return
    }
    try {
      setBusyId(id)
      setActionError(null)
      setActionNotice(null)
      await api.patch(`/admin/referrals/commissions/${encodeURIComponent(id)}`, { status })
      setActionNotice("Status updated.")
      window.setTimeout(() => setActionNotice(null), 4000)
      await load()
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Update failed")
    } finally {
      setBusyId(null)
    }
  }

  const pct = summary ? (summary.rateBps / 100).toFixed(1) : "—"

  return (
    <main className="mx-auto max-w-6xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Referrals &amp; affiliate</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/55">
          Attributed signups and commission rows created from Stripe <code className="text-white/50">invoice.paid</code>{" "}
          (default {pct}% of qualifying amount, first paid invoice unless configured otherwise). Actions
          below only change labels in this database—use your normal process to pay partners outside the
          product.
        </p>
      </header>

      <section
        className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-sm leading-relaxed text-white/60"
        aria-label="Commission status workflow"
      >
        <p className="font-medium text-white/85">How statuses work</p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-white/55">
          <li>
            <span className="text-white/70">Pending</span> — created automatically from a qualifying
            payment; ready for your review.
          </li>
          <li>
            <span className="text-white/70">Approved</span> — you&apos;ve cleared it for payout
            outside NovaPulse.
          </li>
          <li>
            <span className="text-white/70">Paid</span> — you&apos;ve logged that the partner was
            paid (bookkeeping only; no money movement from this UI).
          </li>
          <li>
            <span className="text-white/70">Void</span> — exclude from totals; does not refund or
            alter Stripe.
          </li>
        </ul>
      </section>

      {error ? (
        <div
          className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-100"
          role="alert"
        >
          {error}
          <button
            type="button"
            className="mt-3 block text-xs font-medium text-red-200 underline"
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      ) : null}

      {actionError ? (
        <div
          className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-100"
          role="alert"
        >
          {actionError}
          <button
            type="button"
            className="mt-2 block text-xs text-red-200 underline"
            onClick={() => setActionError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {actionNotice ? (
        <div
          className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 text-sm text-emerald-50/95"
          role="status"
        >
          {actionNotice}
        </div>
      ) : null}

      {summary && !loading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
              Attributed signups
            </p>
            <p className="mt-2 text-2xl font-semibold text-white">{summary.attributedSignups}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
              Commission rows
            </p>
            <p className="mt-2 text-2xl font-semibold text-white">{summary.totalCommissions}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
              First invoice only
            </p>
            <p className="mt-2 text-lg font-medium text-white">
              {summary.firstPaymentOnly ? "Yes" : "No (renewals eligible)"}
            </p>
          </div>
        </div>
      ) : null}

      {summary?.byStatus?.length ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-sm font-semibold text-white/90">By status</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {summary.byStatus.map((b) => (
              <li
                key={b.status}
                className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm"
              >
                <span className="text-white/50">{b.status}</span>
                <span className="mt-1 block font-medium text-white">
                  {b.count} · {money(b.totalCommissionMinor, "gbp")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!loading && !error && summary && summary.totalCommissions === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-sm text-white/55">
          No commission rows yet. Rows appear when a referred customer pays and Stripe delivers a
          qualifying <code className="text-white/60">invoice.paid</code> event.
        </div>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white/90">Commissions</h2>
            <p className="text-xs text-white/45">
              Search by referrer email, referee email, or Stripe invoice id. Invoice ids are the
              source of truth for idempotency.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
              placeholder="Search…"
              className="min-w-[12rem] rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm text-white"
            />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value)
                setPage(1)
              }}
              className="rounded-lg border border-white/15 bg-black/35 px-3 py-2 text-sm text-white"
            >
              <option value="all">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="PAID">Paid</option>
              <option value="VOID">Void</option>
            </select>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-white/45">
                <th className="pb-2 pr-3">Created</th>
                <th className="pb-2 pr-3">Referrer</th>
                <th className="pb-2 pr-3">Referee</th>
                <th className="pb-2 pr-3">Plan</th>
                <th className="pb-2 pr-3">Invoice</th>
                <th className="pb-2 pr-3">Commission</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2 align-top">
                  <span className="block">Actions</span>
                  <span className="mt-0.5 block text-[10px] font-normal normal-case tracking-normal text-white/35">
                    Ledger only
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-white/50">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-2 py-10 text-center text-sm text-white/50">
                    No rows match this filter. Try clearing search or set status to &quot;All
                    statuses&quot;.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-white/[0.06] text-white/80">
                    <td className="py-3 pr-3 align-top text-xs text-white/55">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 pr-3 align-top">
                      <div className="text-white/90">{r.referrer.email}</div>
                      <div className="text-[11px] text-white/45">
                        {r.referrer.referralCode || "—"}
                      </div>
                    </td>
                    <td className="py-3 pr-3 align-top text-white/90">{r.referee.email}</td>
                    <td className="py-3 pr-3 align-top text-xs">{r.plan || "—"}</td>
                    <td className="py-3 pr-3 align-top">
                      <code className="text-[11px] text-purple-200/90">{r.stripeInvoiceId}</code>
                    </td>
                    <td className="py-3 pr-3 align-top tabular-nums">
                      {money(r.commissionAmountMinor, r.currency)}
                      <div className="text-[10px] text-white/40">
                        of {money(r.invoiceAmountMinor, r.currency)} @ {r.commissionRateBps / 100}%
                      </div>
                    </td>
                    <td className="py-3 pr-3 align-top">
                      <span className="rounded-full border border-white/15 bg-black/30 px-2 py-0.5 text-[11px] uppercase tracking-wide text-white/70">
                        {r.status}
                      </span>
                    </td>
                    <td className="py-3 align-top">
                      <div className="flex flex-wrap gap-1">
                        {r.status === "PENDING" ? (
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void patchStatus(r.id, "APPROVED")}
                            className="rounded-md border border-emerald-500/35 bg-emerald-500/15 px-2 py-1 text-[11px] text-emerald-100 disabled:opacity-50"
                          >
                            Approve
                          </button>
                        ) : null}
                        {r.status === "APPROVED" || r.status === "PENDING" ? (
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void patchStatus(r.id, "PAID")}
                            className="rounded-md border border-purple-500/35 bg-purple-500/15 px-2 py-1 text-[11px] text-purple-100 disabled:opacity-50"
                          >
                            Record paid
                          </button>
                        ) : null}
                        {r.status !== "VOID" ? (
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void patchStatus(r.id, "VOID")}
                            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-white/60 disabled:opacity-50"
                          >
                            Void
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-white/45">
          <span>
            Page {page} · {total} total
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-white/15 px-3 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page * 25 >= total}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-white/15 px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}
