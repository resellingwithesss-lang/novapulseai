"use client"

import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { useEntitlementSnapshot } from "@/hooks/useEntitlementSnapshot"
import { PLAN_CONFIG, type UiPlan } from "@/lib/plans"

/**
 * Contextual upgrade / retention strip on the dashboard (non-blocking).
 */
export default function DashboardGrowthBanner() {
  const { user } = useAuth()
  const { entitlement, loading } = useEntitlementSnapshot()

  if (!user || loading || !entitlement) return null

  const plan = entitlement.normalizedPlan as UiPlan
  const cap = PLAN_CONFIG[plan]?.credits ?? 0
  const remaining = entitlement.creditsRemaining
  const pct = cap > 0 ? remaining / cap : 1

  const lastActiveMs = user.lastActiveAt
    ? new Date(user.lastActiveAt).getTime()
    : 0
  const inactiveWindowMs = 14 * 24 * 60 * 60 * 1000
  const looksInactive =
    Boolean(lastActiveMs) && Date.now() - lastActiveMs > inactiveWindowMs

  let message: string | null = null
  let href = "/dashboard/billing"
  let cta = "Compare plans"

  if (plan === "PRO" && !entitlement.featureAccess.ads.allowed) {
    message =
      "Generate better-performing ads with Elite — AI video ads from any product URL, scored variants, no filming."
    cta = "View Elite"
  } else if (plan !== "FREE" && cap > 0 && pct <= 0.2) {
    message =
      "You're close to your monthly credit limit. Upgrade or pace high-cost runs so campaigns don't stall."
    cta = "Billing & plans"
  } else if (plan === "FREE" && remaining <= 2) {
    message =
      "Free credits are almost gone — Starter unlocks Clipper, Prompt Intelligence, and a real monthly credit pool."
    href = "/pricing"
    cta = "See Starter"
  } else if (looksInactive) {
    message =
      "Create your next ad — paste a product link and let AI handle script, voice, and visuals."
    href = "/dashboard/tools/ai-ad-generator"
    cta = "Open AI Ad Generator"
  }

  if (!message) return null

  return (
    <div className="rounded-2xl border border-purple-500/25 bg-gradient-to-r from-purple-600/[0.18] to-pink-600/[0.12] px-5 py-4 text-sm text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl leading-relaxed">{message}</p>
        <Link
          href={href}
          className="shrink-0 rounded-full bg-white/15 px-4 py-2 text-xs font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/25"
        >
          {cta}
        </Link>
      </div>
    </div>
  )
}
