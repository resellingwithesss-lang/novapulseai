"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import AdminGate from "@/components/auth/AdminGate"

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  const nav = [
    { name: "Overview", href: "/admin" },
    { name: "Revenue", href: "/admin/revenue" },
    { name: "Subscriptions", href: "/admin/subscriptions" },
    { name: "Ad Generator", href: "/admin/ads" },
  ]

  return (
    <AdminGate>
      <div className="min-h-screen bg-[#0B0F19] text-white flex">

      {/* SIDEBAR */}
      <div className="w-64 border-r border-white/10 p-6 space-y-6">
        <div className="text-xl font-bold mb-8">
          NovaPulseAI Admin
        </div>

        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`block px-4 py-2 rounded-lg text-sm ${
              pathname === item.href
                ? "bg-purple-600"
                : "hover:bg-white/10"
            }`}
          >
            {item.name}
          </Link>
        ))}
      </div>

      {/* CONTENT */}
        <div className="flex-1 px-10 py-14">
          {children}
        </div>
      </div>
    </AdminGate>
  )
}