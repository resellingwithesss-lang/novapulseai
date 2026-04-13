/**
 * Legacy route: marketing-era tools shell. Production traffic should use
 * `/dashboard/tools` (see `next.config` redirect from `/tools`).
 * Kept only so the `/tools` app route remains defined if the redirect is relaxed;
 * do not add new features here — extend `client/src/app/dashboard/tools` instead.
 */
"use client"

import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import AuthGate from "@/components/auth/AuthGate"
import DashboardShell from "@/components/dashboard/DashboardShell"

const ToolGrid = dynamic(
  () => import("@/components/tools/ToolGrid"),
  {
    loading: () => (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-10">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="relative rounded-3xl border border-white/10 p-8 bg-white/[0.04] backdrop-blur-xl"
          >
            <div className="h-16 w-16 rounded-2xl bg-white/10 border border-white/10 mb-6 animate-pulse" />
            <div className="h-6 w-2/3 bg-white/10 rounded animate-pulse" />
            <div className="mt-3 h-4 w-full bg-white/10 rounded animate-pulse" />
            <div className="mt-2 h-4 w-4/5 bg-white/10 rounded animate-pulse" />
          </div>
        ))}
      </div>
    ),
  }
)


export default function ToolsPage() {
  const router = useRouter()

  return (
    <AuthGate>
      <DashboardShell>
        <div className="relative space-y-16 md:space-y-20">
          <section className="relative rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-2xl p-8 md:p-12 transition-all duration-500 hover:border-white/20">
            <div className="absolute inset-x-0 top-0 h-px bg-white/40 rounded-t-3xl" />
            <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-b from-white/10 via-transparent to-transparent opacity-40" />

            <div className="relative z-10 max-w-3xl">
              <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-white leading-tight">
                NovaPulseAI{" "}
                <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Command Center
                </span>
              </h1>

              <p className="mt-6 text-white/60 text-lg leading-relaxed">
                Pick a tool based on your workflow stage: ideation, scripting,
                repurposing, or ad production. Every output is designed to feed
                the next action so your system keeps moving.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-6 text-sm text-white/50">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Live generation system
                </div>
                <div>Unified entitlement and credit checks</div>
                <div>Handoff links between connected tools</div>
              </div>
            </div>
          </section>

          <section className="relative rounded-3xl border border-white/10 bg-white/[0.02] backdrop-blur-xl p-6 md:p-10 transition-all duration-500 hover:border-white/20">
            <ToolGrid />
          </section>

          <section className="grid gap-6 md:grid-cols-3 rounded-3xl border border-white/10 bg-gradient-to-br from-purple-600/5 to-pink-600/5 backdrop-blur-xl p-8 md:p-10">
            <div>
              <div className="text-sm text-white/50">Starter</div>
              <div className="mt-2 text-2xl font-semibold text-white">
                Core Workflow
              </div>
              <div className="mt-2 text-white/50 text-sm">
                Start with Clipper Engine and Prompt Intelligence in a controlled monthly budget.
              </div>
            </div>

            <div>
              <div className="text-sm text-white/50">Pro</div>
              <div className="mt-2 text-2xl font-semibold text-white">
                Expanded Tools
              </div>
              <div className="mt-2 text-white/50 text-sm">
                Unlock Story Maker and Video Script Engine for full mid-tier production flow.
              </div>
            </div>

            <div>
              <div className="text-sm text-white/50">Elite</div>
              <div className="mt-2 text-2xl font-semibold text-white">
                Full Access
              </div>
              <div className="mt-2 text-white/50 text-sm">
                Unlock the full pipeline with Story Video Maker and maximum limits.
              </div>
            </div>
          </section>

          <section className="relative rounded-3xl border border-white/10 bg-gradient-to-br from-purple-600/10 via-purple-500/5 to-pink-600/10 backdrop-blur-xl p-10 md:p-14 text-center transition-all duration-500 hover:border-white/20">
            <div className="absolute inset-x-0 top-0 h-px bg-white/40 rounded-t-3xl" />

            <h2 className="text-3xl font-semibold text-white">
              Need higher throughput?
            </h2>

            <p className="mt-4 text-white/60 max-w-2xl mx-auto">
              Upgrade when your weekly output grows. Pro unlocks expanded workflows.
              Elite unlocks the full pipeline with maximum output and automation.
            </p>

            <div className="mt-10">
              <button
                type="button"
                onClick={() => router.push("/pricing")}
                className="px-10 py-4 rounded-full bg-gradient-to-r from-purple-500 to-pink-600 text-sm font-semibold shadow-lg shadow-purple-500/30 hover:scale-[1.03] hover:shadow-purple-500/40 transition-all duration-300"
              >
                Compare Plans
              </button>
            </div>

            <div className="mt-6 text-xs text-white/40">
              Cancel anytime. No contracts. Instant activation.
            </div>
          </section>
        </div>
      </DashboardShell>
    </AuthGate>
  )
}