"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ApiError } from "@/lib/api"
import type { MarketingConsentStatus } from "@/context/AuthContext"
import {
  fetchMarketingSubscribers,
  marketingSubscribersCsvUrl,
  type AdminPlan,
  type AdminRole,
  type AdminSubscriptionStatus,
  type MarketingAudienceFilter,
  type MarketingSubscriber,
} from "@/lib/adminMarketingApi"

const PLAN_OPTIONS: Array<{ id: "ALL" | AdminPlan; label: string }> = [
  { id: "ALL", label: "Any plan" },
  { id: "FREE", label: "Free" },
  { id: "STARTER", label: "Starter" },
  { id: "PRO", label: "Pro" },
  { id: "ELITE", label: "Elite" },
]

const STATUS_OPTIONS: Array<{ id: "ALL" | AdminSubscriptionStatus; label: string }> = [
  { id: "ALL", label: "Any subscription" },
  { id: "ACTIVE", label: "Active" },
  { id: "TRIALING", label: "Trialing" },
  { id: "PAST_DUE", label: "Past due" },
  { id: "CANCELED", label: "Canceled" },
  { id: "EXPIRED", label: "Expired" },
  { id: "PAUSED", label: "Paused" },
]

const CONSENT_OPTIONS: Array<{ id: "ALL" | MarketingConsentStatus; label: string }> = [
  { id: "ALL", label: "Any consent status" },
  { id: "OPTED_IN", label: "Opted in" },
  { id: "LEGACY_OPT_IN", label: "Legacy opt-in" },
  { id: "UNKNOWN", label: "Not yet asked" },
  { id: "DISMISSED", label: "Dismissed" },
  { id: "OPTED_OUT", label: "Opted out" },
]

const ROLE_OPTIONS: Array<{ id: "ALL" | AdminRole; label: string }> = [
  { id: "ALL", label: "Any role" },
  { id: "USER", label: "User" },
  { id: "CREATOR", label: "Creator" },
  { id: "ADMIN", label: "Admin" },
  { id: "OWNER", label: "Owner" },
  { id: "SUPER_ADMIN", label: "Owner (legacy)" },
]

const PAGE_SIZE = 50

export default function AdminMarketingSubscribersPage() {
  const [search, setSearch] = useState("")
  const [plan, setPlan] = useState<(typeof PLAN_OPTIONS)[number]["id"]>("ALL")
  const [subscriptionStatus, setSubscriptionStatus] =
    useState<(typeof STATUS_OPTIONS)[number]["id"]>("ALL")
  const [consentStatus, setConsentStatus] =
    useState<(typeof CONSENT_OPTIONS)[number]["id"]>("ALL")
  const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]["id"]>("ALL")
  const [sendableOnly, setSendableOnly] = useState(false)
  const [inactiveDays, setInactiveDays] = useState<string>("")

  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [rows, setRows] = useState<MarketingSubscriber[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const filter = useMemo<MarketingAudienceFilter>(() => {
    const f: MarketingAudienceFilter = {}
    if (search.trim()) f.search = search.trim()
    if (plan !== "ALL") f.plan = [plan]
    if (subscriptionStatus !== "ALL") f.subscriptionStatus = [subscriptionStatus]
    if (consentStatus !== "ALL") f.consentStatus = [consentStatus]
    if (role !== "ALL") f.role = [role]
    if (sendableOnly) f.sendableOnly = true
    const inactiveDaysNum = inactiveDays ? Number(inactiveDays) : NaN
    if (Number.isFinite(inactiveDaysNum) && inactiveDaysNum > 0) {
      f.inactiveDays = Math.floor(inactiveDaysNum)
    }
    return f
  }, [search, plan, subscriptionStatus, consentStatus, role, sendableOnly, inactiveDays])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetchMarketingSubscribers({
        filter,
        page,
        limit: PAGE_SIZE,
      })
      setRows(res.subscribers)
      setTotal(res.total)
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load subscribers."
      setError(message)
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [filter, page])

  useEffect(() => {
    // Reset to page 1 whenever the filter changes.
    setPage(1)
  }, [filter])

  useEffect(() => {
    load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const csvHref = marketingSubscribersCsvUrl(filter)

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
            NovaPulseAI · Growth · Subscribers
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Subscriber console
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Filter the creator base by plan, consent state, and activity. Exports
            are audit-logged with a filter fingerprint.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/marketing"
            className="inline-flex items-center gap-2 rounded-lg bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/80 ring-1 ring-white/10 transition hover:bg-white/[0.08]"
          >
            Back to overview
          </Link>
          <a
            href={csvHref}
            className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_28px_-18px_rgba(124,58,237,0.9)] transition hover:bg-purple-500"
          >
            Export CSV
          </a>
        </div>
      </header>

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Search">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Email or display name…"
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-purple-400/60"
            />
          </Field>
          <Field label="Plan">
            <Select
              value={plan}
              onChange={(v) => setPlan(v as typeof plan)}
              options={PLAN_OPTIONS}
            />
          </Field>
          <Field label="Subscription">
            <Select
              value={subscriptionStatus}
              onChange={(v) => setSubscriptionStatus(v as typeof subscriptionStatus)}
              options={STATUS_OPTIONS}
            />
          </Field>
          <Field label="Consent">
            <Select
              value={consentStatus}
              onChange={(v) => setConsentStatus(v as typeof consentStatus)}
              options={CONSENT_OPTIONS}
            />
          </Field>
          <Field label="Role">
            <Select
              value={role}
              onChange={(v) => setRole(v as typeof role)}
              options={ROLE_OPTIONS}
            />
          </Field>
          <Field label="Inactive for (days)">
            <input
              value={inactiveDays}
              onChange={(e) => setInactiveDays(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="e.g. 30"
              className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-purple-400/60"
            />
          </Field>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-white/70">
            <input
              type="checkbox"
              checked={sendableOnly}
              onChange={(e) => setSendableOnly(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-black/40 text-purple-500 focus:ring-0"
            />
            Only show currently-sendable users
          </label>
          <span className="text-xs text-white/45">
            {loading
              ? "Loading…"
              : `${total.toLocaleString()} ${total === 1 ? "subscriber" : "subscribers"} match`}
          </span>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-white/10">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.12em] text-white/45">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Subscription</th>
              <th className="px-4 py-3">Consent</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Last active</th>
              <th className="px-4 py-3">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-white/40">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-white/50">
                  No subscribers match these filters.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/users/${r.id}`}
                      className="text-white hover:text-purple-300"
                    >
                      {r.email}
                    </Link>
                    {r.displayName ? (
                      <div className="text-xs text-white/45">{r.displayName}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-white/80">{r.plan}</td>
                  <td className="px-4 py-3 text-white/70">
                    {r.subscriptionStatus}
                  </td>
                  <td className="px-4 py-3">
                    <ConsentPill
                      status={r.marketingConsentStatus}
                      sendable={r.marketingEmails}
                    />
                  </td>
                  <td className="px-4 py-3 text-xs text-white/60">
                    {r.marketingConsentSource ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-white/60">
                    {r.lastActiveAt
                      ? new Date(r.lastActiveAt).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-white/60">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <div className="flex items-center justify-between">
        <span className="text-xs text-white/45">
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white/80 transition hover:bg-white/[0.06] disabled:opacity-40"
          >
            Previous
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-white/80 transition hover:bg-white/[0.06] disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
        {label}
      </span>
      {children}
    </label>
  )
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ id: T; label: string }>
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-purple-400/60"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id} className="bg-[#0B0F19]">
          {o.label}
        </option>
      ))}
    </select>
  )
}

function ConsentPill({
  status,
  sendable,
}: {
  status: MarketingConsentStatus
  sendable: boolean
}) {
  const map: Record<MarketingConsentStatus, string> = {
    OPTED_IN: "bg-emerald-500/15 text-emerald-200",
    LEGACY_OPT_IN: "bg-emerald-500/10 text-emerald-200/80",
    UNKNOWN: "bg-amber-500/15 text-amber-200",
    DISMISSED: "bg-white/10 text-white/60",
    OPTED_OUT: "bg-rose-500/15 text-rose-200",
  }
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${map[status]}`}
      >
        {status.replace("_", " ")}
      </span>
      {!sendable ? (
        <span
          title="marketingEmails=false"
          className="inline-flex items-center rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-white/50"
        >
          muted
        </span>
      ) : null}
    </div>
  )
}
