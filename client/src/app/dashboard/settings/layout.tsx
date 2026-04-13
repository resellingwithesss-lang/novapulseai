"use client"

import type { ReactNode } from "react"
import DashboardShell from "@/components/dashboard/DashboardShell"
import SettingsAccountStrip from "@/components/settings/SettingsAccountStrip"
import SettingsNav from "@/components/settings/SettingsNav"

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardShell showCommandHero={false} contentWidth="readable">
      <a
        href="#settings-main"
        className="absolute left-[-10000px] top-0 z-[300] overflow-hidden whitespace-nowrap focus:left-4 focus:top-20 focus:h-auto focus:w-auto focus:overflow-visible focus:rounded-lg focus:bg-purple-600/95 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:outline-none focus:ring-2 focus:ring-purple-300/60"
      >
        Skip to settings content
      </a>
      <div className="relative flex min-w-0 flex-col gap-10 lg:flex-row lg:items-start lg:gap-14">
        <SettingsNav />
        <div
          id="settings-main"
          className="min-w-0 flex-1 space-y-8 pb-8 outline-none"
          tabIndex={-1}
        >
          <SettingsAccountStrip />
          {children}
        </div>
      </div>
    </DashboardShell>
  )
}
