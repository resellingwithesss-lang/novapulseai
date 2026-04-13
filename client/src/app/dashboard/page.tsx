"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams, useRouter } from "next/navigation"
import DashboardShell from "@/components/dashboard/DashboardShell"
import { useAuth } from "@/context/AuthContext"
import {
  getSortedOutputHistory,
  type OutputHistoryItem,
} from "@/lib/growth"
import { readOnboardingProfile } from "@/lib/onboardingProfile"
import { useActivityRecent } from "@/hooks/useActivityRecent"
import {
  generationToolHref,
  generationTypeLabel,
} from "@/lib/activityApi"
import { ToolCard } from "./_components/DashboardCards"
import CreatorOnboardingBanner from "./_components/CreatorOnboardingBanner"
import WorkflowGoalTemplates from "./_components/WorkflowGoalTemplates"
import DashboardNextAction from "./_components/DashboardNextAction"
import { useWorkflowSummary } from "@/hooks/useWorkflowSummary"
import {
  fetchBrandVoices,
  fetchWorkspaces,
  type BrandVoiceDto,
  type WorkspaceDto,
} from "@/lib/workflowApi"

export default function DashboardPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { user, status, refreshUser } = useAuth()
  const [recentOutputs, setRecentOutputs] = useState<OutputHistoryItem[]>([])
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [studioWs, setStudioWs] = useState<WorkspaceDto[]>([])
  const [studioBv, setStudioBv] = useState<BrandVoiceDto[]>([])

  const {
    generations,
    adJobs,
    loading: activityLoading,
    error: activityError,
  } = useActivityRecent(Boolean(user))

  const { data: wfData, loading: wfLoading } = useWorkflowSummary(Boolean(user))

  useEffect(() => {
    if (!user) return
    void (async () => {
      try {
        const [ws, bv] = await Promise.all([fetchWorkspaces(), fetchBrandVoices()])
        setStudioWs((ws.workspaces ?? []).slice(0, 4))
        setStudioBv((bv.brandVoices ?? []).slice(0, 4))
      } catch {
        setStudioWs([])
        setStudioBv([])
      }
    })()
  }, [user])

  useEffect(() => {
    const success = searchParams.get("success")
    const canceled = searchParams.get("canceled")

    if (success === "true" || canceled === "true") {
      refreshUser({ silent: true }).catch(() => {})
      router.replace("/dashboard")
    }
  }, [searchParams, router, refreshUser])

  useEffect(() => {
    setRecentOutputs(getSortedOutputHistory().slice(0, 6))
  }, [status])

  useEffect(() => {
    const p = readOnboardingProfile()
    setShowOnboarding(!p?.completed)
  }, [])

  const isPastDue = user?.subscriptionStatus === "PAST_DUE"

  if (status === "loading") {
    return (
      <DashboardShell>
        <div className="animate-pulse space-y-10">
          <div className="h-40 rounded-3xl bg-white/10" />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-28 rounded-2xl bg-white/10" />
            ))}
          </div>
        </div>
      </DashboardShell>
    )
  }

  if (!user) {
    return (
      <DashboardShell>
        <div className="text-red-400">Failed to load dashboard.</div>
      </DashboardShell>
    )
  }

  const recentGens = generations.slice(0, 4)

  return (
    <DashboardShell>
      <div className="space-y-14">
        {isPastDue && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm leading-relaxed text-red-300/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            ⚠ Payment past due — update billing to avoid service interruption.
          </div>
        )}

        {showOnboarding && (
          <CreatorOnboardingBanner onCompleted={() => setShowOnboarding(false)} />
        )}

        <DashboardNextAction
          user={user}
          generationsCount={generations.length}
          adJobs={adJobs}
          workflow={wfLoading ? null : wfData}
        />

        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-5">
          <ToolCard title="Video Script" href="/dashboard/tools/video" />
          <ToolCard title="Clip Generator" href="/dashboard/tools/clipper" />
          <ToolCard title="Prompt Generator" href="/dashboard/tools/prompt" />
          <ToolCard title="Story Maker" href="/dashboard/tools/story-maker" />
          <ToolCard title="Story Video Generator" href="/dashboard/tools/story-video-maker" />
        </section>

        <WorkflowGoalTemplates />

        <section className="np-card p-6 md:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.015em] text-white/[0.97]">Studio</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/50">
                Workspaces, brand voices, and multi-output content packs — your workflow layer on top of tools.
              </p>
            </div>
            <Link
              href="/dashboard/content-packs"
              className="rounded-full border border-purple-400/28 bg-gradient-to-b from-purple-500/14 to-purple-900/8 px-4 py-2 text-sm font-medium tracking-[-0.01em] text-purple-100/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] outline-none ring-1 ring-purple-500/12 transition-[border-color,background-color] hover:border-purple-400/40 focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
            >
              New content pack
            </Link>
          </div>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-white/40">Workspaces</h3>
              <ul className="mt-3 space-y-2 text-sm text-white/78">
                {studioWs.length === 0 && (
                  <li className="text-white/45">None yet — create one to anchor your tools.</li>
                )}
                {studioWs.map((w) => (
                  <li key={w.id}>
                    <Link
                      href="/dashboard/workspaces"
                      className="rounded underline-offset-2 outline-none transition-colors hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
                    >
                      {w.name}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                href="/dashboard/workspaces"
                className="mt-3 inline-block text-xs font-medium text-purple-200/88 underline decoration-white/15 underline-offset-[0.2em] outline-none transition-colors hover:text-purple-100/95 focus-visible:rounded focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
              >
                Manage workspaces
              </Link>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-white/40">Brand voices</h3>
              <ul className="mt-3 space-y-2 text-sm text-white/78">
                {studioBv.length === 0 && (
                  <li className="text-white/45">None yet — save tone & CTA defaults.</li>
                )}
                {studioBv.map((b) => (
                  <li key={b.id}>
                    <Link
                      href="/dashboard/brand-voices"
                      className="rounded underline-offset-2 outline-none transition-colors hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
                    >
                      {b.name}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                href="/dashboard/brand-voices"
                className="mt-3 inline-block text-xs font-medium text-purple-200/88 underline decoration-white/15 underline-offset-[0.2em] outline-none transition-colors hover:text-purple-100/95 focus-visible:rounded focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
              >
                Manage brand voices
              </Link>
            </div>
          </div>
        </section>

        <section className="np-card p-6 md:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-[-0.015em] text-white/[0.97]">Recent account activity</h2>
              <p className="mt-2 text-sm leading-relaxed text-white/50">
                Last generations on your account — open the library for jobs, search, and device shortcuts.
              </p>
            </div>
            <Link
              href="/dashboard/library"
              className="text-sm font-medium text-purple-200/88 underline decoration-white/15 underline-offset-[0.2em] outline-none transition-colors hover:text-purple-100/95 focus-visible:rounded focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
            >
              Open library →
            </Link>
          </div>
          {activityError && (
            <p className="mt-4 text-sm text-amber-200/90">{activityError}</p>
          )}
          {activityLoading && (
            <p className="mt-4 text-sm text-white/45" aria-live="polite">
              Loading activity…
            </p>
          )}
          <ul className="mt-5 space-y-2">
            {!activityLoading && recentGens.length === 0 && (
              <li className="rounded-2xl border border-white/[0.078] bg-black/25 px-4 py-3.5 text-sm leading-relaxed text-white/55">
                No server generations yet — start with Video Script or a workflow template above.
              </li>
            )}
            {recentGens.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-white/[0.078] bg-black/25 px-4 py-3.5"
              >
                <div>
                  <p className="text-xs font-semibold uppercase text-violet-300/90">
                    {generationTypeLabel(g.type)}
                  </p>
                  <p className="mt-1 text-sm text-white/82">{g.inputPreview}</p>
                  <p className="mt-1 text-xs text-white/42">
                    {new Date(g.createdAt).toLocaleString()} · {g.creditsUsed} cr
                  </p>
                </div>
                <Link
                  href={generationToolHref(g.type)}
                  className="shrink-0 text-xs font-medium text-purple-200/88 underline decoration-white/15 underline-offset-[0.2em] outline-none transition-colors hover:text-purple-100/95 focus-visible:rounded focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
                >
                  Open tool
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="np-card p-6 md:p-8">
          <h2 className="text-lg font-semibold tracking-[-0.015em] text-white/[0.97]">Continue on this device</h2>
          <p className="mt-2 text-sm leading-relaxed text-white/50">
            Pinned and recent outputs from your browser — fast return to unfinished work.
          </p>
          <div className="mt-5 space-y-3">
            {recentOutputs.length === 0 && (
              <div className="rounded-2xl border border-white/[0.078] bg-black/25 px-4 py-3.5 text-sm leading-relaxed text-white/55">
                No local shortcuts yet. Generate from any tool to build your continuity list.
              </div>
            )}
            {recentOutputs.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.078] bg-black/25 px-4 py-3.5"
              >
                <div>
                  <p className="text-sm font-medium tracking-[-0.01em] text-white/[0.97]">{item.title}</p>
                  <p className="text-xs text-white/50">
                    {item.summary || item.nextAction || "Continue workflow"}
                    {item.pinned ? " · pinned" : ""}
                  </p>
                </div>
                {item.continuePath && (
                  <Link
                    href={item.continuePath}
                    className="text-xs font-medium text-purple-200/88 underline decoration-white/15 underline-offset-[0.2em] outline-none transition-colors hover:text-purple-100/95 focus-visible:rounded focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
                  >
                    {item.nextAction || "Continue working"}
                  </Link>
                )}
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-2.5 text-xs">
            <Link
              href="/dashboard/library"
              className="rounded-full border border-white/[0.14] bg-white/[0.035] px-3 py-1.5 font-medium text-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] outline-none transition-[background-color,border-color,color] hover:border-white/22 hover:bg-white/[0.055] hover:text-white/86 focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
            >
              Full library
            </Link>
            <Link
              href="/dashboard/tools/story-video-maker"
              className="rounded-full border border-white/[0.14] bg-white/[0.035] px-3 py-1.5 font-medium text-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] outline-none transition-[background-color,border-color,color] hover:border-white/22 hover:bg-white/[0.055] hover:text-white/86 focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
            >
              Finish your video
            </Link>
            <Link
              href="/dashboard/tools/story-maker"
              className="rounded-full border border-white/[0.14] bg-white/[0.035] px-3 py-1.5 font-medium text-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] outline-none transition-[background-color,border-color,color] hover:border-white/22 hover:bg-white/[0.055] hover:text-white/86 focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
            >
              Expand your script
            </Link>
            <Link
              href="/dashboard/tools/video"
              className="rounded-full border border-white/[0.14] bg-white/[0.035] px-3 py-1.5 font-medium text-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] outline-none transition-[background-color,border-color,color] hover:border-white/22 hover:bg-white/[0.055] hover:text-white/86 focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
            >
              Generate variations
            </Link>
          </div>
        </section>
      </div>
    </DashboardShell>
  )
}
