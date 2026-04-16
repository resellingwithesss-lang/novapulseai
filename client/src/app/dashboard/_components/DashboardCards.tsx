"use client"

import Link from "next/link"
import GlobalPlanBadge from "@/components/growth/PlanBadge"
import { displayPlanForUser } from "@/lib/plans"

export function MetricCard({
  title,
  value,
}: {
  title: string
  value: string | number
}) {
  return (
    <div className="np-card-soft p-6 transition-[border-color,box-shadow,background-color] duration-200 ease-out hover:border-white/[0.09] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_14px_28px_rgba(0,0,0,0.2)]">
      <div className="text-xs font-medium uppercase tracking-[0.08em] text-white/46">
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
      className="group block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
    >
      <div className="np-card-soft cursor-pointer p-5 transition-[border-color,box-shadow,transform] duration-200 ease-out group-hover:border-white/[0.1] group-hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.045),0_16px_28px_rgba(0,0,0,0.24)] group-hover:-translate-y-[1px]">
        <div className="font-medium tracking-[-0.015em] text-white/[0.95]">{title}</div>
      </div>
    </Link>
  )
}

export function PlanBadge({
  plan,
  status,
  role,
}: {
  plan: string
  status: string
  role?: string | null
}) {
  const uiPlan = displayPlanForUser(plan, role)
  const trialLabel =
    status === "TRIALING" && uiPlan === "PRO" ? "Pro trial" : null

  return (
    <div className="text-right min-w-[140px]">
      <div className="text-xs font-medium uppercase tracking-[0.08em] text-white/40">
        Current Plan
      </div>

      <div className="mt-2 flex justify-end">
        <GlobalPlanBadge plan={uiPlan} status={status} trialLabel={trialLabel} />
      </div>
    </div>
  )
}
