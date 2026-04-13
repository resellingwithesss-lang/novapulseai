import type { AdminOverviewKpis } from "./adminOverviewTypes"

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
})

type Props = {
  kpis: AdminOverviewKpis
}

function Kpi({
  label,
  value,
  hint,
  emphasize,
}: {
  label: string
  value: string
  hint?: string
  emphasize?: boolean
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${emphasize ? "text-purple-200" : "text-white"}`}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-white/45">{hint}</p> : null}
    </div>
  )
}

export function AdminKpiGrid({ kpis }: Props) {
  const paying = kpis.activeSubscriptions + kpis.trialingSubscriptions

  return (
    <section aria-labelledby="admin-kpi-heading">
      <h2 id="admin-kpi-heading" className="sr-only">
        Key metrics
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <Kpi label="Total users" value={kpis.totalUsers.toLocaleString()} />
        <Kpi
          label="Paying subs"
          value={paying.toLocaleString()}
          hint={`${kpis.activeSubscriptions} active · ${kpis.trialingSubscriptions} trialing`}
        />
        <Kpi
          label="Est. MRR"
          value={gbp.format(kpis.estimatedMrrGbp)}
          hint="Plan list price × active + trialing"
          emphasize
        />
        <Kpi
          label="Credits used (lifetime)"
          value={kpis.creditsUsedLifetime.toLocaleString()}
          hint={`${kpis.creditsRemaining.toLocaleString()} remaining in wallets`}
        />
        <Kpi
          label="Generation runs"
          value={kpis.generationRunsLifetime.toLocaleString()}
          hint="Story / video / blueprint (all-time)"
        />
        <Kpi
          label="Ad jobs"
          value={`${kpis.adJobsActive} active`}
          hint={`${kpis.adJobsFailed24h} failed 24h · ${kpis.adJobsFailedTotal} failed total`}
        />
      </div>
    </section>
  )
}
