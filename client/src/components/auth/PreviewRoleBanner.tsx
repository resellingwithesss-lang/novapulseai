"use client"

import { useAuth } from "@/context/AuthContext"

/**
 * Product demo accounts (`PREVIEW` role): full creator tools, no admin console.
 */
export default function PreviewRoleBanner() {
  const { user, hasResolvedSession } = useAuth()

  if (!hasResolvedSession || !user || user.role !== "PREVIEW") return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-3 pt-2"
      role="status"
    >
      <div className="pointer-events-auto max-w-lg rounded-full border border-cyan-400/35 bg-cyan-950/90 px-4 py-1.5 text-center text-[11px] font-medium text-cyan-100 shadow-lg shadow-black/40 backdrop-blur-sm">
        Preview account — full product access for demos. Not for production billing.
      </div>
    </div>
  )
}
