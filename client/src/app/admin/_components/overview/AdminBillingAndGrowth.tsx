import Link from "next/link"
import { CreditCard, TrendingUp } from "lucide-react"
import type { AdminOverviewBilling, AdminOverviewGrowth } from "./adminOverviewTypes"

type Props = {
  billing: AdminOverviewBilling
  growth: AdminOverviewGrowth
}

export function AdminBillingAndGrowth({ billing, growth }: Props) {
  const planRows = [...growth.payingByPlan].sort((a, b) => b.count - a.count)
  const totalPaying = planRows.reduce((s, r) => s + r.count, 0)

  return (
    <div className="space-y-6">
      <section
        className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        aria-labelledby="admin-billing-heading"
      >
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-purple-200/85" aria-hidden />
          <h2
            id="admin-billing-heading"
            className="text-[15px] font-semibold tracking-[-0.02em] text-white/95"
          >
            Billing & subscriptions
          </h2>
        </div>
        <p className="mt-1 text-sm text-white/45">Counts from user subscription state.</p>
        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/25 px-3 py-2.5">
            <dt className="text-white/50">Past due</dt>
            <dd
              className={`font-semibold tabular-nums ${billing.pastDue > 0 ? "text-red-300" : "text-emerald-300/90"}`}
            >
              {billing.pastDue.toLocaleString()}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/25 px-3 py-2.5">
            <dt className="text-white/50">Paused</dt>
            <dd className="font-semibold tabular-nums text-white/80">{billing.paused.toLocaleString()}</dd>
          </div>
        </dl>
        <Link
          href="/admin/subscriptions"
          className="mt-4 inline-flex text-xs font-semibold uppercase tracking-wide text-purple-200/90 hover:text-purple-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45"
        >
          Open subscriptions →
        </Link>
      </section>

      <section
        className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        aria-labelledby="admin-growth-heading"
      >
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-purple-200/85" aria-hidden />
          <h2
            id="admin-growth-heading"
            className="text-[15px] font-semibold tracking-[-0.02em] text-white/95"
          >
            Growth snapshot
          </h2>
        </div>
        <p className="mt-1 text-sm text-white/45">New accounts and paying plan mix.</p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/[0.06] bg-black/25 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40">
              7 days
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-white">
              {growth.signups7d.toLocaleString()}
            </p>
            <p className="text-xs text-white/45">Signups</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-black/25 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40">
              30 days
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-white">
              {growth.signups30d.toLocaleString()}
            </p>
            <p className="text-xs text-white/45">Signups</p>
          </div>
        </div>

        <h3 className="mt-6 text-xs font-semibold uppercase tracking-[0.1em] text-white/40">
          Paying accounts by plan
        </h3>
        <div className="mt-2 overflow-hidden rounded-xl border border-white/[0.06]">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-white/[0.06] bg-black/30 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Plan
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Accounts
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {planRows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-5 text-center text-white/45">
                    No active or trialing paid rows.
                  </td>
                </tr>
              ) : (
                planRows.map((row) => (
                  <tr key={row.plan} className="border-b border-white/[0.04] last:border-0">
                    <td className="px-3 py-2 font-medium text-white/85">{row.plan}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-white/70">
                      {row.count.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-white/50">
                      {totalPaying > 0 ? `${Math.round((row.count / totalPaying) * 100)}%` : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Link
          href="/admin/revenue"
          className="mt-4 inline-flex text-xs font-semibold uppercase tracking-wide text-purple-200/90 hover:text-purple-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45"
        >
          Revenue detail →
        </Link>
      </section>
    </div>
  )
}
