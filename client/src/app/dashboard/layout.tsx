// client/src/app/dashboard/layout.tsx
"use client"

import { ReactNode } from "react"
import AuthGate from "@/components/auth/AuthGate"

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <AuthGate>{children}</AuthGate>
}