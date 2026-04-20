"use client"

import Link from "next/link"
import type { ActivityAdJobRow } from "@/lib/activityApi"
import { displayPlanForUser, getPlanCredits, isFreePlan } from "@/lib/plans"

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
  workflowLoading = false,
}: {
  user: AuthUser
  generationsCount: number
  adJobs: ActivityAdJobRow[]
  /** Server workflow counts; omit or pass null only when you intentionally skip workflow nudges. */
  workflow?: DashboardWorkflowSummary | null
  /** When true, show a fixed-layout placeholder until workflow counts are available (avoids CTA swapping). */
  workflowLoading?: boolean
}) {
  if (workflowLoading) {
    return (
      <section
        className="np-card-strong p-6 md:p-7 motion-safe:animate-pulse"
        aria-busy="true"
        aria-label="Loading recommendation"
      >
        <div className="h-2.5 w-28 rounded bg-white/[0.08]" />
        <div className="mt-4 h-6 w-[min(100%,20rem)] max-w-full rounded-md bg-white/[0.07]" />
        <div className="mt-3 h-3 w-full max-w-xl rounded bg-white/[0.055]" />
        <div className="mt-2 h-3 w-[88%] max-w-xl rounded bg-white/[0.05]" />
        <div className="mt-5 h-9 w-36 rounded-lg bg-white/[0.06]" />
      </section>
    )
  }

  const credits = user.credits ?? 0
  const plan = displayPlanForUser(user.plan, user.role)
  const planCap = getPlanCredits(plan)
  const creditPctUsed =
    planCap > 0 ? Math.min(100, Math.round(((planCap - Math.max(0, credits)) / planCap) * 100)) : 0
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
  } else if (!isFreePlan(plan) && planCap > 0 && creditPctUsed >= 85) {
    title = "You're close to running out — keep generating ads"
    sub =
      "Most of this cycle's credits are used. Open billing to add runway so AI Ad Studio and other tools don't stall mid-launch."
    href = "/dashboard/billing"
  } else if (plan === "STARTER" && workflow && workflow.counts.contentPacks > 0 && generationsCount > 0) {
    title = "Unlock better-performing ads and more outputs"
    sub =
      "Pro adds Story Maker plus higher script volume — the bridge to weekly ad and content tests without hitting caps."
    href = "/dashboard/tools/story-maker"
  } else if (plan === "PRO" && generationsCount > 0) {
    title = "Generate multiple high-performing ad variants"
    sub =
      "Elite unlocks AI Ad Studio: URL in, scored angles, AI voiceover, and rendered video ads — no filming or editing on your side."
    href = "/dashboard/tools/ai-ad-generator"
  } else if (generationsCount === 0) {
    title = "Generate your first script pack"
    sub = "Goal-aware scripts in under a minute — best first step for new accounts."
    href = "/dashboard/tools/video"
  }

  return (
    <section className="np-card-strong p-6 md:p-7">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-purple-200/75">
        Recommended next
      </p>
      <h2 className="mt-2 text-lg font-semibold tracking-[-0.015em] text-white/[0.97]">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/58">{sub}</p>
      <Link
        href={href}
        className="np-btn np-btn-secondary mt-4 text-sm outline-none hover:shadow-[0_10px_24px_-14px_rgba(255,255,255,0.3)] focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19] active:bg-white/[0.08]"
      >
        Continue →
      </Link>
    </section>
  )
}
