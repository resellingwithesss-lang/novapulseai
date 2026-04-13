"use client"

import { useAuth } from "@/context/AuthContext"
import UsageBar from "@/components/growth/UsageBar"
import {
  getPlanCredits,
  normalizePlan,
} from "@/lib/plans"
import TrialBanner from "@/components/growth/TrialBanner"
import { recordEmailReadyEvent } from "@/lib/growth"
import { useEffect } from "react"

type DashboardShellProps = {
  children: React.ReactNode
  /** When false, hides the global “Command Center” hero so each page can use its own header. */
  showCommandHero?: boolean
  /** Narrower main column for form-heavy workflow pages (still full-width usage bar). */
  contentWidth?: "wide" | "readable"
}

export default function DashboardShell({
  children,
  showCommandHero = true,
  contentWidth = "wide",
}: DashboardShellProps) {
  const { user } = useAuth()

  const credits = user?.credits ?? 0
  const plan = normalizePlan(user?.plan)
  const isProTrial =
    user?.subscriptionStatus === "TRIALING" &&
    !!user?.trialExpiresAt &&
    normalizePlan(user?.plan) === "PRO"
  const monthlyIncludedCredits = getPlanCredits(plan)

  useEffect(() => {
    if (!user) return
    if (
      user.subscriptionStatus === "TRIALING" &&
      user.trialExpiresAt &&
      normalizePlan(user.plan) === "PRO"
    ) {
      const msLeft = new Date(user.trialExpiresAt).getTime() - Date.now()
      if (msLeft > 0 && msLeft <= 1000 * 60 * 60 * 48) {
        const dayKey = new Date().toISOString().slice(0, 10)
        recordEmailReadyEvent("TRIAL_ENDING_SOON", `trial-ending:${user.id}:${dayKey}`, {
          userId: user.id,
          trialExpiresAt: user.trialExpiresAt,
        })
      }
    }
    const usagePct = monthlyIncludedCredits > 0 ? ((monthlyIncludedCredits - credits) / monthlyIncludedCredits) * 100 : 0
    if (usagePct >= 70) {
      const bucket = usagePct >= 90 ? "critical" : "warn"
      recordEmailReadyEvent("CREDITS_LOW", `credits-low:${user.id}:${bucket}`, {
        userId: user.id,
        credits,
        monthlyIncludedCredits,
        usagePct: Math.round(usagePct),
      })
    }
  }, [credits, monthlyIncludedCredits, user])

  return (
    <main className="relative min-h-[calc(100vh-64px)] min-w-0 overflow-x-hidden">

      {/* Ambient wash — same restrained language as marketing hero (no heavy blur orbs). */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_100%_70%_at_50%_-15%,rgba(124,58,237,0.11),transparent_58%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_55%,rgba(236,72,153,0.07),transparent_55%)]" />
      </div>

      <div className="mx-auto max-w-7xl space-y-10 px-4 pb-20 pt-10 sm:px-6 md:space-y-12 md:pt-14">
        {isProTrial ? <TrialBanner /> : <UsageBar />}

        {showCommandHero ? (
          <div className="max-w-2xl space-y-4">
            <h1 className="text-4xl font-semibold leading-[1.08] tracking-[-0.022em] text-white md:text-5xl">
              <span className="text-white">Your Creator</span>
              <span className="block bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
                Command Center
              </span>
            </h1>

            <p className="text-base font-normal leading-relaxed text-white/50 md:text-lg md:leading-[1.7] md:text-white/52">
              One operating system for ideation, scripting, repurposing, and publishing workflows.
              Clear outputs, measurable progress, and less time lost to tool switching.
            </p>
          </div>
        ) : null}

        <div
          className={
            contentWidth === "readable"
              ? "mx-auto w-full max-w-4xl space-y-10 md:space-y-12"
              : "space-y-10 md:space-y-12"
          }
        >
          {children}
        </div>
      </div>
    </main>
  )
}