"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  CreditCard,
  LayoutGrid,
  Mic2,
  Shield,
  SlidersHorizontal,
  UserRound,
} from "lucide-react"

const settingsItems = [
  {
    href: "/dashboard/settings/profile",
    label: "Profile",
    description: "Identity & account",
    icon: UserRound,
  },
  {
    href: "/dashboard/settings/preferences",
    label: "Preferences",
    description: "UI & notifications",
    icon: SlidersHorizontal,
  },
  {
    href: "/dashboard/settings/brand-voice-defaults",
    label: "Brand voice defaults",
    description: "Generation voice",
    icon: Mic2,
  },
  {
    href: "/dashboard/settings/workspace-defaults",
    label: "Workspace defaults",
    description: "Where new work opens",
    icon: LayoutGrid,
  },
  {
    href: "/dashboard/settings/security",
    label: "Security",
    description: "Sign-in & password",
    icon: Shield,
  },
  {
    href: "/dashboard/settings/usage",
    label: "Usage & credits",
    description: "Balance & ledger",
    icon: BarChart3,
  },
] as const

const accountItems = [
  {
    href: "/dashboard/billing",
    label: "Billing & plan",
    description: "Stripe, invoices, upgrades",
    icon: CreditCard,
  },
] as const

export default function SettingsNav() {
  const pathname = usePathname() || ""

  const linkClass = (href: string) => {
    const active = pathname === href || pathname.startsWith(`${href}/`)
    return {
      active,
      className:
        "flex items-center gap-3 rounded-xl px-3 py-2.5 outline-none transition lg:py-2.5 " +
        (active
          ? "border border-white/[0.1] bg-white/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
          : "border border-transparent text-white/62 hover:border-white/[0.06] hover:bg-white/[0.04] hover:text-white/88 focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816]"),
    }
  }

  return (
    <aside className="w-full shrink-0 lg:w-56 xl:w-60">
      <nav aria-label="Settings sections" className="lg:sticky lg:top-24">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/38">
          Settings
        </p>
        <ul className="flex flex-row gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {settingsItems.map(({ href, label, description, icon: Icon }) => {
            const { active, className } = linkClass(href)
            return (
              <li key={href} className="shrink-0 lg:w-full">
                <Link
                  href={href}
                  prefetch
                  className={className}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${active ? "text-purple-200/90" : "text-white/38"}`}
                    strokeWidth={1.65}
                    aria-hidden
                  />
                  <span className="min-w-0 text-left">
                    <span className="block text-[13px] font-medium tracking-[-0.01em]">
                      {label}
                    </span>
                    <span className="mt-0.5 hidden text-[11px] leading-snug text-white/38 lg:block">
                      {description}
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>

        <p className="mb-3 mt-8 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/38">
          Account
        </p>
        <ul className="flex flex-row gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {accountItems.map(({ href, label, description, icon: Icon }) => {
            const { active, className } = linkClass(href)
            return (
              <li key={href} className="shrink-0 lg:w-full">
                <Link
                  href={href}
                  prefetch
                  className={className}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${active ? "text-purple-200/90" : "text-white/38"}`}
                    strokeWidth={1.65}
                    aria-hidden
                  />
                  <span className="min-w-0 text-left">
                    <span className="block text-[13px] font-medium tracking-[-0.01em]">
                      {label}
                    </span>
                    <span className="mt-0.5 hidden text-[11px] leading-snug text-white/38 lg:block">
                      {description}
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </aside>
  )
}
