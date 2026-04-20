"use client"

import type { ReactNode } from "react"
import AdminPreviewBanner from "@/components/auth/AdminPreviewBanner"
import PreviewRoleBanner from "@/components/auth/PreviewRoleBanner"
import NavPointerProbe from "@/components/debug/NavPointerProbe"
import { AuthProvider } from "@/context/AuthContext"

type AppProvidersProps = {
  children: ReactNode
}

export default function AppProviders({ children }: AppProvidersProps) {
  return (
    <AuthProvider>
      <AdminPreviewBanner />
      <PreviewRoleBanner />
      {process.env.NODE_ENV === "development" ? <NavPointerProbe /> : null}
      {children}
    </AuthProvider>
  )
}
