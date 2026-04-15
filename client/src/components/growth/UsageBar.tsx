"use client"

import { useMemo } from "react"
import { getPlanCredits, isFreePlan } from "@/lib/plans"
import { useAuth } from "@/context/AuthContext"
import { useEffectivePlan } from "@/hooks/useEffectivePlan"

export default function UsageBar() {
  const { user } = useAuth()
  const plan = useEffectivePlan()
  const total = getPlanCredits(plan)
  const free = isFreePlan(plan)
  const remaining = Math.max(0, user?.credits ?? 0)
  const used = Math.max(0, total - remaining)
  const pct = Math.min(100, Math.round((used / total) * 100))
  const tone =
    pct >= 90
      ? "from-red-500 to-pink-600"
      : pct >= 70
        ? "from-amber-500 to-orange-600"
        : "from-emerald-500 to-teal-600"

  const message = useMemo(() => {
    if (free && pct >= 75) return "Free credits almost gone — upgrade for full tools and monthly limits."
    if (free) return "Free account: Video Script Engine only. Upgrade to unlock the full workflow."
    if (pct >= 90) return "You are near your limit. Upgrade now to avoid interruptions."
    if (pct >= 70) return "Usage is high this cycle. Plan ahead for uninterrupted output."
    return "Usage is healthy."
  }, [pct, free])

  return (
    <div
      data-testid="usage-bar"
      className="rounded-2xl border border-white/[0.078] bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
    >
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-white/65">
        <span data-testid="usage-summary">
          {free ? "Free" : plan} usage: {used}/{total} credits ({pct}% used)
        </span>
        {pct >= 70 && (
          <a
            href="/pricing"
            className="shrink-0 font-medium text-purple-200/88 underline decoration-white/20 underline-offset-[0.2em] outline-none transition-colors hover:text-purple-100/95 focus-visible:rounded focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
          >
            Upgrade
          </a>
        )}
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
        <div className={`h-2.5 bg-gradient-to-r ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-white/50">{message}</p>
    </div>
  )
}
