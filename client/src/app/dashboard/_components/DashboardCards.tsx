"use client"

import Link from "next/link"
import GlobalPlanBadge from "@/components/growth/PlanBadge"
import { normalizePlan } from "@/lib/plans"

export function MetricCard({
  title,
  value,
}: {
  title: string
  value: string | number
}) {
  return (
    <div className="np-card p-6 transition-[border-color,box-shadow,background-color] duration-200 ease-out hover:border-purple-400/18 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.055),0_8px_36px_rgba(0,0,0,0.16),0_0_40px_rgba(124,58,237,0.045)]">
      <div className="text-xs font-medium uppercase tracking-[0.08em] text-white/40">
        {title}
      </div>

      <div className="mt-2 text-xl font-semibold tracking-[-0.018em] text-white/[0.97]">
        {value}
      </div>
    </div>
  )
}

export function ToolCard({
  title,
  href,
}: {
  title: string
  href: string
}) {
  return (
    <Link
      href={href}
      className="group block rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
    >
      <div className="np-card cursor-pointer p-6 transition-[border-color,box-shadow] duration-200 ease-out group-hover:border-purple-400/18 group-hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.055),0_8px_36px_rgba(0,0,0,0.16),0_0_40px_rgba(124,58,237,0.045)]">
        <div className="font-medium tracking-[-0.015em] text-white/[0.97]">{title}</div>
      </div>
    </Link>
  )
}

export function PlanBadge({
  plan,
  status,
}: {
  plan: string
  status: string
}) {
  const trialLabel =
    status === "TRIALING" && normalizePlan(plan) === "PRO" ? "Pro trial" : null

  return (
    <div className="text-right min-w-[140px]">
      <div className="text-xs font-medium uppercase tracking-[0.08em] text-white/40">
        Current Plan
      </div>

      <div className="mt-2 flex justify-end">
        <GlobalPlanBadge plan={plan} status={status} trialLabel={trialLabel} />
      </div>
    </div>
  )
}
