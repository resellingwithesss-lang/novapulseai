"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import AdminGate from "@/components/auth/AdminGate"
import { LayoutDashboard, Megaphone, CreditCard, Repeat, Users } from "lucide-react"

const navGroups: {
  label: string
  items: { name: string; href: string; icon: typeof LayoutDashboard }[]
}[] = [
  {
    label: "Operations",
    items: [
      { name: "Overview", href: "/admin", icon: LayoutDashboard },
      { name: "Referrals", href: "/admin/referrals", icon: Users },
    ],
  },
  {
    label: "Commercial",
    items: [
      { name: "Revenue", href: "/admin/revenue", icon: CreditCard },
      { name: "Subscriptions", href: "/admin/subscriptions", icon: Repeat },
    ],
  },
  {
    label: "Production",
    items: [{ name: "Ad Generator", href: "/admin/ads", icon: Megaphone }],
  },
]

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <AdminGate>
      <div className="flex min-h-screen bg-[#0B0F19] text-white">
        <aside className="flex w-64 shrink-0 flex-col border-r border-white/10">
          <div className="border-b border-white/10 p-6">
            <div className="text-lg font-semibold tracking-tight text-white">NovaPulseAI</div>
            <div className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-white/40">
              Operator console
            </div>
          </div>
          <nav className="flex-1 space-y-6 overflow-y-auto p-4" aria-label="Admin">
            {navGroups.map((group) => (
              <div key={group.label}>
                <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const active =
                      pathname === item.href ||
                      (item.href !== "/admin" && pathname.startsWith(item.href + "/"))
                    const Icon = item.icon
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition ${
                          active
                            ? "bg-purple-600/90 text-white shadow-[0_12px_28px_-18px_rgba(124,58,237,0.9)]"
                            : "text-white/70 hover:bg-white/[0.06] hover:text-white"
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                        {item.name}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 px-6 py-10 sm:px-10 lg:py-12">{children}</div>
      </div>
    </AdminGate>
  )
}
