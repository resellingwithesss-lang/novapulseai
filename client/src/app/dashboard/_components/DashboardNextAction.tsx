"use client"

import Link from "next/link"
import type { ActivityAdJobRow } from "@/lib/activityApi"
import { displayPlanForUser, isFreePlan } from "@/lib/plans"

type AuthUser = {
  credits?: number
  plan?: string | null
  role?: string | null
}

export type DashboardWorkflowSummary = {
  counts: {
    workspaces: number
    brandVoices: number
    contentPacks: number
  }
}

function isJobInflight(status: string) {
  const s = status.toLowerCase()
  return (
    s !== "completed" &&
    s !== "failed" &&
    s !== "cancelled" &&
    s !== "canceled"
  )
}

export default function DashboardNextAction({
  user,
  generationsCount,
  adJobs,
  workflow,
}: {
  user: AuthUser
  generationsCount: number
  adJobs: ActivityAdJobRow[]
  /** When null, workflow-based nudges are skipped (still loading or error). */
  workflow?: DashboardWorkflowSummary | null
}) {
  const credits = user.credits ?? 0
  const plan = displayPlanForUser(user.plan, user.role)
  const inflight = adJobs.filter((j) => isJobInflight(j.status))

  let title = "Repurpose a win into clips"
  let sub = "Short vertical cuts from anything that already performed."
  let href = "/dashboard/tools/clipper"

  if (inflight.length > 0) {
    title = "Check your video job"
    sub = `${inflight.length} render job(s) still updating — open the library for status.`
    href = "/dashboard/library"
  } else if (workflow && workflow.counts.workspaces === 0) {
    title = "Create your first workspace"
    sub = "Anchor niche, audience, and platforms so every tool outputs on-brand."
    href = "/dashboard/workspaces"
  } else if (workflow && workflow.counts.brandVoices === 0) {
    title = "Save a brand voice preset"
    sub = "Lock tone, pacing, and CTA style — apply it across scripts, stories, and packs."
    href = "/dashboard/brand-voices"
  } else if (workflow && workflow.counts.contentPacks === 0) {
    title = "Generate your first content pack"
    sub = "One run: hooks, scripts, titles, captions, CTAs, and clip angles — saved to your library."
    href = "/dashboard/content-packs"
  } else if (isFreePlan(plan) && credits === 0) {
    title = "Unlock more generation"
    sub = "Free credits are spent — upgrade or wait for reset to keep shipping."
    href = "/pricing"
  } else if (generationsCount === 0) {
    title = "Generate your first script pack"
    sub = "Goal-aware scripts in under a minute — best first step for new accounts."
    href = "/dashboard/tools/video"
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-purple-600/10 via-[#0a0d18]/85 to-pink-600/6 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ring-1 ring-inset ring-white/[0.03]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-purple-200/72">
        Recommended next
      </p>
      <h2 className="mt-2 text-lg font-semibold tracking-[-0.015em] text-white/[0.97]">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/50">{sub}</p>
      <Link
        href={href}
        className="mt-4 inline-flex items-center justify-center rounded-full border border-white/[0.14] bg-white/[0.06] px-5 py-2.5 text-sm font-semibold tracking-[-0.01em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] outline-none transition-[background-color,border-color] duration-200 ease-out hover:border-white/22 hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19] active:bg-white/[0.08]"
      >
        Continue →
      </Link>
    </section>
  )
}
