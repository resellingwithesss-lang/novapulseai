"use client"

import { displayPlanForUser, planDisplayName } from "@/lib/plans"

type MetricsUser = {
  plan?: string | null
  role?: string | null
  credits?: number
  subscriptionStatus?: string | null
}

export default function MetricsGrid({ user }: { user: MetricsUser }) {
  const tier = displayPlanForUser(user.plan, user.role)

  return (
    <div className="grid gap-6 md:grid-cols-4">

      <MetricCard
        title="Credits remaining"
        value={user.credits ?? 0}
      />

      <MetricCard
        title="Subscription health"
        value={user.subscriptionStatus ?? "—"}
      />

      <MetricCard
        title="Growth score"
        value="87%"
      />

      <MetricCard
        title="Account tier"
        value={planDisplayName(tier)}
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