"use client"

import { ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft, Sparkles } from "lucide-react"
import TrialBanner from "@/components/growth/TrialBanner"
import UsageBar from "@/components/growth/UsageBar"
import { useAuth } from "@/context/AuthContext"
import { displayPlanForUser } from "@/lib/plans"
import type { ToolId } from "@/config/tools"

type ToolPageShellProps = {
  /** Stable id for a11y, analytics, and E2E (`data-npai-tool`). */
  toolId?: ToolId
  title: string
  /** One-line outcome: what the user walks away with (shown prominently). */
  outcome?: string
  subtitle: string
  guidance?: string
  statusLabel?: string
  statusTone?: "neutral" | "success" | "warning"
  ctaHref?: string
  ctaLabel?: string
  children: ReactNode
}

export default function ToolPageShell({
  toolId,
  title,
  outcome,
  subtitle,
  guidance,
  statusLabel,
  statusTone = "neutral",
  ctaHref,
  ctaLabel,
  children,
}: ToolPageShellProps) {
  const { user } = useAuth()
  const showTrialBanner =
    user?.subscriptionStatus === "TRIALING" &&
    !!user.trialExpiresAt &&
    displayPlanForUser(user?.plan, user?.role) === "PRO"
  const statusClass =
    statusTone === "success"
      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
      : statusTone === "warning"
        ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
        : "border-white/15 bg-white/5 text-white/70"

  return (
    <main
      className="mx-auto min-w-0 max-w-7xl px-4 py-10 text-white sm:px-6 md:py-12"
      data-npai-tool={toolId}
    >
      <div className="mb-4 space-y-3">
        {showTrialBanner ? <TrialBanner compact /> : <UsageBar />}
      </div>
      <div className="np-card mb-8 p-6 md:p-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/dashboard/tools"
            className="inline-flex items-center gap-2 rounded-lg text-xs font-medium uppercase tracking-[0.08em] text-white/55 outline-none transition-colors hover:text-white/86 focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
          >
            <ArrowLeft size={14} />
            Back to tools
          </Link>
          {statusLabel && (
            <span className={`rounded-full border px-3 py-1 text-xs ${statusClass}`}>
              {statusLabel}
            </span>
          )}
        </div>

        <h1 className="text-3xl font-semibold tracking-[-0.022em] md:text-4xl">{title}</h1>
        {outcome ? (
          <p className="mt-3 max-w-3xl text-base font-medium leading-snug text-white/88 md:text-lg">
            {outcome}
          </p>
        ) : null}
        <p
          className={`max-w-3xl text-base font-normal leading-relaxed text-white/50 md:text-white/52 ${outcome ? "mt-2" : "mt-3"}`}
        >
          {subtitle}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {guidance && (
            <div className="inline-flex max-w-full items-start gap-2 rounded-xl border border-white/[0.078] bg-black/25 px-3 py-2 text-xs leading-relaxed text-white/60">
              <Sparkles size={14} className="mt-0.5 shrink-0 text-purple-200/80" />
              <span>{guidance}</span>
            </div>
          )}
          {ctaHref && ctaLabel && (
            <Link
              href={ctaHref}
              className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-purple-500 to-pink-600 px-4 py-2 text-xs font-semibold tracking-[-0.01em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] outline-none transition-[opacity,box-shadow] duration-200 hover:opacity-[0.97] focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19] active:opacity-[0.93]"
            >
              {ctaLabel}
            </Link>
          )}
        </div>
      </div>

      <div>
        {children}
      </div>
    </main>
  )
}
