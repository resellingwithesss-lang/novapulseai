"use client"

import Link from "next/link"
import DashboardShell from "@/components/dashboard/DashboardShell"
import { useAuth } from "@/context/AuthContext"
import ToolGrid from "@/components/tools/ToolGrid"

export default function ToolsHubPage() {
  const { user, status } = useAuth()

  if (status === "loading") {
    return (
      <DashboardShell>
        <div className="animate-pulse space-y-6">
          <div className="h-10 max-w-md rounded-xl bg-white/10" />
          <div className="grid gap-4 sm:grid-cols-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-36 rounded-2xl bg-white/10" />
            ))}
          </div>
        </div>
      </DashboardShell>
    )
  }

  if (!user) {
    return (
      <DashboardShell>
        <div className="np-card p-8 text-center">
          <p className="text-white/78">Sign in to use creator tools.</p>
          <Link
            href="/login"
            className="mt-4 inline-flex rounded-full bg-gradient-to-r from-purple-500 to-pink-600 px-5 py-2.5 text-sm font-semibold tracking-[-0.01em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] outline-none transition-[opacity] hover:opacity-[0.97] focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
          >
            Log in
          </Link>
        </div>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell>
      <div className="space-y-10">
        <div className="max-w-2xl space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-purple-200/72">
            Creator studio
          </p>
          <h1 className="text-3xl font-semibold tracking-[-0.022em] text-white md:text-4xl">Tools</h1>
          <p className="text-base font-normal leading-relaxed text-white/50 md:text-white/52">
            Everything you need to script, storyboard, clip, and render — in one place. Pick a tool to
            start; outputs sync to your{" "}
            <Link
              href="/dashboard/library"
              className="font-medium text-purple-200/88 underline decoration-white/15 underline-offset-[0.2em] outline-none transition-colors hover:text-purple-100/95 focus-visible:rounded focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
            >
              library
            </Link>{" "}
            when saved server-side.
          </p>
        </div>

        <ToolGrid />
      </div>
    </DashboardShell>
  )
}
