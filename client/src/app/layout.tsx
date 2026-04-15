import "./globals.css"
import type { ReactNode } from "react"
import AppProviders from "@/providers/AppProviders"
import Navbar from "@/components/navigation/Navbar"
import AdminHotkeyPanel from "@/components/admin/AdminHotkeyPanel"

/* ================= CORE CONFIG ================= */

const APP_NAME = "NovaPulseAI"
const APP_DESCRIPTION =
  "NovaPulseAI is the AI content operating system for creators and teams that need repeatable output, stronger retention, and clearer ROI from every video."

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000"

/* ================= METADATA ================= */

export const metadata = {
  title: {
    default: APP_NAME,
    template: `%s • ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  metadataBase: new URL(APP_URL),
  applicationName: APP_NAME,
}

/* ================= ROOT LAYOUT ================= */

export default function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className="scroll-smooth"
    >
      <body
        className="
          min-h-screen
          bg-[#0b0f19]
          text-white
          antialiased
          selection:bg-purple-600
          selection:text-white
        "
      >
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10"
        >
          <div className="pointer-events-none absolute inset-0 bg-[#0b0f19]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_25%,rgba(139,92,246,0.15),transparent_60%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_70%,rgba(236,72,153,0.12),transparent_60%)]" />
        </div>

        <AppProviders>
          <div
            id="npai-app-shell"
            className="relative min-h-screen w-full min-w-0 max-w-none overflow-x-hidden bg-[#050816] pointer-events-auto"
          >
            <Navbar />
            <AdminHotkeyPanel />

            <div className="relative z-0 w-full max-w-none">{children}</div>
          </div>
        </AppProviders>
      </body>
    </html>
  )
}