"use client"

import Link from "next/link"
import { useCallback } from "react"
import { useAuth } from "@/context/AuthContext"
import {
  formatBlockedReason,
  useEntitlementSnapshot,
} from "@/hooks/useEntitlementSnapshot"
import {
  displayPlanForUser,
  getWorkflowLimitsForPlan,
  planDisplayName,
  subscriptionStatusDisplay,
} from "@/lib/plans"

export default function SettingsAccountStrip() {
  const { user, status } = useAuth()
  const { entitlement, loading: entLoading, refresh } = useEntitlementSnapshot()

  const onRefresh = useCallback(() => {
    void refresh()
  }, [refresh])

  if (status !== "authenticated" || !user) {
    return null
  }

  const uiPlan = displayPlanForUser(user.plan, user.role)
  const plan = planDisplayName(uiPlan)
  const sub = subscriptionStatusDisplay(user.subscriptionStatus)
  const credits = user.credits ?? 0
  const limits = getWorkflowLimitsForPlan(uiPlan)
  const accessNote =
    entitlement &&
    (entitlement.blockedReason || entitlement.upgradeRequired)
      ? formatBlockedReason(entitlement.blockedReason, entitlement.minimumPlan)
      : null

  return (
    <section
      className="rounded-2xl border border-white/[0.09] bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-black/20 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
      aria-label="Account snapshot"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/38">
            Your account
          </p>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-lg font-semibold tracking-tight text-white">
              {plan}
            </span>
            <span className="text-sm text-white/45">·</span>
            <span className="text-sm text-white/55">{sub}</span>
          </div>
          <p className="text-sm tabular-nums text-white/70">
            <span className="font-medium text-white/90">{credits}</span> credits
            available
            {entLoading ? (
              <span className="ml-2 text-xs text-white/35">(syncing access…)</span>
            ) : null}
          </p>
          <p className="max-w-xl text-xs leading-relaxed text-white/40">
            Studio limits on this plan:{" "}
            <span className="text-white/55">
              {limits.workspaces} workspaces · {limits.brandVoices} brand voices ·{" "}
              {limits.contentPacks} content packs
            </span>
          </p>
          {accessNote ? (
            <p
              className="max-w-xl text-xs font-medium text-amber-200/85"
              role="status"
            >
              {accessNote}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={entLoading}
            className="rounded-full border border-white/[0.12] bg-white/[0.05] px-4 py-2 text-xs font-medium text-white/80 outline-none transition hover:border-white/20 hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] disabled:opacity-50"
          >
            {entLoading ? "Refreshing…" : "Refresh access"}
          </button>
          <Link
            href="/dashboard/settings/usage"
            className="inline-flex items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.05] px-4 py-2 text-xs font-medium text-white/80 outline-none transition hover:border-white/20 hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816]"
          >
            Usage detail
          </Link>
          <Link
            href="/dashboard/billing"
            className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-purple-900/20 outline-none transition hover:opacity-[0.96] focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816]"
          >
            Billing & upgrades
          </Link>
        </div>
      </div>
    </section>
  )
}
