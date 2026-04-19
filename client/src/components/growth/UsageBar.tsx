"use client"

import { useMemo } from "react"
import { getPlanCredits, isFreePlan, planDisplayName } from "@/lib/plans"
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
    if (free && pct >= 75)
      return "Free credits are almost gone — move to Starter or Pro for monthly runway and the full stack."
    if (free)
      return "Free tier: Video Script Engine + starter credits. Upgrade when you want Clipper, prompts, Story Maker, or Ad Studio."
    if (pct >= 90)
      return "You are near this cycle's credit ceiling — upgrade or pace heavy jobs (especially Ad Studio renders) so launches don't stall."
    if (pct >= 70)
      return "Most of this cycle's credits are committed — plan your next packs or Elite renders before you hit the wall."
    return "Credit runway looks healthy for this billing period."
  }, [pct, free])

  return (
    <div
      data-testid="usage-bar"
      className="rounded-2xl border border-white/[0.078] bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
    >
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-white/65">
        <span data-testid="usage-summary">
          {free ? "Free" : planDisplayName(plan)} plan · {used}/{total} credits used ({pct}%)
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
