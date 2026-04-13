"use client"

import { normalizePlan } from "@/lib/plans"

type PlanBadgeProps = {
  plan?: string | null
  status?: string | null
  trialLabel?: string | null
}

export default function PlanBadge({ plan, status, trialLabel }: PlanBadgeProps) {
  const normalized = normalizePlan(plan)
  const tone =
    normalized === "FREE"
      ? "text-sky-300 border-sky-500/30 bg-sky-500/10"
      : normalized === "ELITE"
        ? "text-pink-300 border-pink-500/30 bg-pink-500/10"
        : normalized === "PRO"
          ? "text-purple-300 border-purple-500/30 bg-purple-500/10"
          : "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}>
        {normalized}
      </span>
      {status && (
        <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/65">
          {status}
        </span>
      )}
      {trialLabel && (
        <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-200">
          {trialLabel}
        </span>
      )}
    </div>
  )
}
