"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { ApiError } from "@/lib/api"
import {
  fetchCreditLedger,
  fetchSettings,
  type CreditLedgerRow,
  type SettingsUsageSummary,
} from "@/lib/settingsApi"
import {
  getWorkflowLimitsForPlan,
  planDisplayName,
  planIncludedCreditsLine,
  subscriptionStatusDisplay,
} from "@/lib/plans"
import { SettingsCard, SettingsPageHeader } from "@/components/settings/SettingsSection"

function formatWhen(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso))
  } catch {
    return "—"
  }
}

function signedAmount(n: number) {
  if (n > 0) return `+${n}`
  return String(n)
}

function formatReset(iso: string | null) {
  if (!iso) return null
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso))
  } catch {
    return null
  }
}

export default function UsageSettingsPage() {
  const [summary, setSummary] = useState<SettingsUsageSummary | null>(null)
  const [rows, setRows] = useState<CreditLedgerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (soft?: boolean) => {
    if (soft) setRefreshing(true)
    else {
      setLoading(true)
    }
    setError(null)
    try {
      const [s, ledger] = await Promise.all([
        fetchSettings(),
        fetchCreditLedger(50),
      ])
      setSummary(s.usageSummary)
      setRows(ledger.transactions)
    } catch (e) {
      setError((e as ApiError)?.message ?? "Could not load usage.")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-8">
      <SettingsPageHeader
        title="Usage & credits"
        description="Wallet balance, plan tier, studio limits, and your latest credit movements — aligned with Billing and what the tools enforce. Invoices and payment methods stay in Stripe."
        actions={
          !loading && !error ? (
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="rounded-full border border-white/[0.1] bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/80 outline-none transition hover:border-white/16 hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          ) : undefined
        }
      />

      {loading ? (
        <div className="animate-pulse space-y-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-8">
          <div className="h-8 w-1/2 rounded bg-white/10" />
          <div className="h-40 w-full rounded bg-white/10" />
        </div>
      ) : error ? (
        <div className="space-y-4">
          <div
            role="alert"
            className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200/95"
          >
            {error}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-full border border-white/[0.12] bg-white/[0.06] px-4 py-2 text-sm font-medium text-white/88 outline-none transition hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816]"
          >
            Try again
          </button>
        </div>
      ) : summary ? (
        <div className="space-y-6">
          <p className="text-xs text-white/42">{planIncludedCreditsLine(summary.plan)}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40">
                Available credits
              </p>
              <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-white">
                {summary.credits}
              </p>
              {summary.bonusCredits > 0 ? (
                <p className="mt-1 text-xs text-emerald-200/75">
                  Includes {summary.bonusCredits} bonus
                </p>
              ) : null}
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40">
                Plan & subscription
              </p>
              <p className="mt-2 text-lg font-semibold text-white/92">
                {planDisplayName(summary.plan)}
              </p>
              <p className="mt-1 text-xs text-white/50">
                {subscriptionStatusDisplay(summary.subscriptionStatus)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:col-span-2 lg:col-span-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40">
                Lifetime usage
              </p>
              <p className="mt-2 text-lg font-semibold tabular-nums text-white/90">
                {summary.lifetimeCreditsUsed} credits spent
              </p>
              <p className="mt-1 text-xs text-white/45">
                {summary.totalGenerations} generations recorded
              </p>
            </div>
          </div>

          {(summary.monthlyCredits > 0 || summary.monthlyResetAt) && (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40">
                Monthly pool
              </p>
              <p className="mt-2 text-lg font-semibold tabular-nums text-white/90">
                {summary.monthlyCredits} refill credits
              </p>
              {summary.monthlyResetAt ? (
                <p className="mt-1 text-xs text-white/45">
                  Next reset · {formatReset(summary.monthlyResetAt) ?? "—"}
                </p>
              ) : (
                <p className="mt-1 text-xs text-white/45">
                  Reset schedule appears when your plan includes a monthly allowance.
                </p>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40">
              Studio limits ({planDisplayName(summary.plan)})
            </p>
            <p className="mt-2 text-sm text-white/70">
              {(() => {
                const L = getWorkflowLimitsForPlan(summary.plan)
                return `${L.workspaces} workspaces · ${L.brandVoices} brand voices · ${L.contentPacks} content packs`
              })()}
            </p>
            <p className="mt-2 text-xs text-white/40">
              Limits scale with your plan. Upgrade under Billing to raise caps.
            </p>
          </div>

          <SettingsCard
            title="Credit ledger"
            description="Most recent movements (newest first). Detailed billing history is in Stripe from Billing."
          >
            {rows.length === 0 ? (
              <p className="text-sm leading-relaxed text-white/50">
                No credit movements in this window yet. Generate in any tool to see debits and
                refills appear here.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-white/[0.06] bg-black/25 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        When
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Type
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Δ
                      </th>
                      <th scope="col" className="hidden px-4 py-3 font-semibold sm:table-cell">
                        Balance
                      </th>
                      <th scope="col" className="px-4 py-3 font-semibold">
                        Note
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]"
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-white/70">
                          {formatWhen(r.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-white/55">{r.type}</td>
                        <td
                          className={
                            "px-4 py-3 font-medium tabular-nums " +
                            (r.amount >= 0 ? "text-emerald-300/90" : "text-amber-200/85")
                          }
                        >
                          {signedAmount(r.amount)}
                        </td>
                        <td className="hidden px-4 py-3 tabular-nums text-white/45 sm:table-cell">
                          {r.balanceAfter ?? "—"}
                        </td>
                        <td className="max-w-[12rem] truncate px-4 py-3 text-white/50 sm:max-w-xs">
                          {r.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SettingsCard>

          <p className="text-center text-sm text-white/45">
            Need more capacity?{" "}
            <Link
              href="/dashboard/billing"
              className="font-medium text-purple-200/90 underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45"
            >
              Open billing
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  )
}
