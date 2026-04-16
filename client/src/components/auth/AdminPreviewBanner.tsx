"use client"

import { useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { api, ApiError } from "@/lib/api"

export default function AdminPreviewBanner() {
  const { adminPreview, user, refreshUser, hasResolvedSession } = useAuth()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const exit = useCallback(async () => {
    setErr(null)
    setBusy(true)
    try {
      await api.post("/auth/impersonation/exit")
      await refreshUser({ silent: false })
      router.push("/admin")
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not exit preview"
      setErr(msg)
    } finally {
      setBusy(false)
    }
  }, [refreshUser, router])

  if (!hasResolvedSession || !adminPreview || !user) return null

  return (
    <div
      role="status"
      className="sticky top-0 z-[100] border-b border-amber-400/35 bg-amber-950/95 px-4 py-2.5 text-center text-sm text-amber-50 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.8)]"
    >
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-center gap-2 sm:flex-row sm:gap-4">
        <p className="text-balance">
          <span className="font-semibold text-amber-100">Admin preview</span>
          <span className="text-amber-100/85">
            {" "}
            — signed in as <span className="font-medium text-white">{user.email}</span>
          </span>
          <span className="text-amber-200/75">
            {" "}
            (operator {adminPreview.impersonatorEmail})
          </span>
        </p>
        <button
          type="button"
          onClick={() => void exit()}
          disabled={busy}
          className="shrink-0 rounded-lg border border-amber-300/40 bg-amber-500/20 px-4 py-1.5 text-xs font-semibold text-amber-50 hover:bg-amber-500/30 disabled:opacity-50"
        >
          {busy ? "Restoring…" : "Exit preview"}
        </button>
      </div>
      {err ? (
        <p className="mt-2 text-xs text-red-200/95" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  )
}
