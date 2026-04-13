"use client"

export default function MetricsGrid({ user }: any) {
  const isEnterprise = user.plan === "ENTERPRISE"

  return (
    <div className="grid gap-6 md:grid-cols-4">

      <MetricCard
        title="Credits Remaining"
        value={isEnterprise ? "∞ Unlimited" : user.credits}
      />

      <MetricCard
        title="Subscription Health"
        value={user.subscriptionStatus}
      />

      <MetricCard
        title="Growth Score"
        value="87%"
      />

      <MetricCard
        title="Account Tier"
        value={user.plan}
      />

    </div>
  )
}

function MetricCard({ title, value }: any) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 hover:bg-white/[0.06] transition">
      <div className="text-xs text-white/50">
        {title}
      </div>
      <div className="mt-2 text-lg font-semibold text-white">
        {value}
      </div>
    </div>
  )
}