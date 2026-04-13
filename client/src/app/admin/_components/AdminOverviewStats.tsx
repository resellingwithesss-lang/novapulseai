"use client"

type PlanDistribution = {
  FREE: number
  STARTER: number
  PRO: number
  ELITE: number
}

type AdminOverviewStatsProps = {
  systemHealth: number
  revenueEstimate: number
  fraudUsers: number
  banRatio: number
  planDistribution: PlanDistribution
}

export default function AdminOverviewStats({
  systemHealth,
  revenueEstimate,
  fraudUsers,
  banRatio,
  planDistribution,
}: AdminOverviewStatsProps) {
  return (
    <div className="mb-10 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      <MetricBlock
        label="System Health"
        value={`${systemHealth}%`}
        tone={systemHealth >= 70 ? "good" : "warn"}
      />
      <MetricBlock
        label="Revenue Estimate"
        value={`£${revenueEstimate.toFixed(2)}`}
        tone="accent"
      />
      <MetricBlock
        label="Fraud Signals"
        value={`${fraudUsers}`}
        tone={fraudUsers > 0 ? "danger" : "good"}
      />
      <MetricBlock
        label="Ban Ratio"
        value={`${banRatio}%`}
        tone="warn"
      />
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-xs uppercase tracking-wide text-white/45">Plan Mix</div>
        <div className="mt-3 space-y-1 text-sm text-white/75">
          <div>Free: {planDistribution.FREE}</div>
          <div>Starter: {planDistribution.STARTER}</div>
          <div>Pro: {planDistribution.PRO}</div>
          <div>Elite: {planDistribution.ELITE}</div>
        </div>
      </div>
    </div>
  )
}

function MetricBlock({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "good" | "warn" | "danger" | "accent"
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-300"
      : tone === "warn"
        ? "text-amber-300"
        : tone === "danger"
          ? "text-red-300"
          : "text-purple-300"

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs uppercase tracking-wide text-white/45">{label}</div>
      <div className={`mt-2 text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  )
}
