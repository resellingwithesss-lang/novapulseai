"use client"

import { useMemo } from "react"
import { useAuth } from "@/context/AuthContext"
import { displayPlanForUser } from "@/lib/plans"
import { getTrialCountdown, getTrialUrgency } from "@/lib/growth"

type TrialBannerProps = {
  compact?: boolean
}

export default function TrialBanner({ compact = false }: TrialBannerProps) {
  const { user } = useAuth()
  const showTrial =
    user?.subscriptionStatus === "TRIALING" &&
    !!user?.trialExpiresAt &&
    displayPlanForUser(user?.plan, user?.role) === "PRO"
  const countdown = useMemo(() => getTrialCountdown(user?.trialExpiresAt), [user?.trialExpiresAt])
  const urgency = useMemo(() => getTrialUrgency(user?.trialExpiresAt), [user?.trialExpiresAt])

  if (!showTrial || !countdown) return null

  const tone =
    urgency === "critical"
      ? "border-red-500/30 bg-red-500/10 text-red-100"
      : urgency === "strong"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
        : "border-blue-500/30 bg-blue-500/10 text-blue-100"

  const message =
    urgency === "critical"
      ? "Your PRO trial ends in less than 24 hours."
      : urgency === "strong"
        ? "Your PRO trial is ending soon."
        : "Your PRO trial is active."

  return (
    <div data-testid="trial-banner" className={`rounded-2xl border px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p data-testid="trial-message" className="text-sm font-semibold tracking-[-0.01em]">{message}</p>
          <p data-testid="trial-countdown" className="mt-0.5 text-xs opacity-90">
            Your PRO trial ends in {countdown.days}d {countdown.hours}h.
          </p>
        </div>
        <a
          href="/pricing"
          className={`rounded-full px-4 py-2 text-xs font-semibold outline-none transition-[opacity,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19] ${
            compact
              ? "border border-white/[0.14] bg-white/[0.08] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-white/[0.11]"
              : "bg-gradient-to-r from-purple-500 to-pink-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:opacity-[0.97]"
          }`}
        >
          Upgrade to keep access
        </a>
      </div>
    </div>
  )
}
