"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import {
  ChevronDown,
  CreditCard,
  Coins,
  LogOut,
  Settings,
  Shield,
  Sparkles,
} from "lucide-react"
import type { Role } from "@/context/AuthContext"

type Props = {
  email: string
  planLabel: string
  creditsRemaining: number
  hasPaid: boolean
  role: Role
  onLogout: () => Promise<void>
  onNavigate?: () => void
}

function initialsFromEmail(email: string) {
  const local = email.split("@")[0]?.trim() || "?"
  const parts = local.split(/[._\-]+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0]![0] + parts[1]![0]).toUpperCase().slice(0, 2)
  }
  return local.slice(0, 2).toUpperCase() || "?"
}

export default function UserAccountMenu({
  email,
  planLabel,
  creditsRemaining,
  hasPaid,
  role,
  onLogout,
  onNavigate,
}: Props) {
  const pathname = usePathname() || "/"
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const initials = useMemo(() => initialsFromEmail(email), [email])
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN"

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (rootRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    document.addEventListener("mousedown", onDoc)
    window.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      window.removeEventListener("keydown", onKey)
    }
  }, [open])

  const row =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-white/78 outline-none transition-colors hover:bg-white/[0.055] hover:text-white/92 focus-visible:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-400/35"

  const close = () => {
    setOpen(false)
    onNavigate?.()
  }

  const handleLogout = async () => {
    setBusy(true)
    try {
      await onLogout()
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        className="flex max-w-full items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] py-1 pl-1 pr-2 outline-none transition hover:border-white/16 hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] sm:pr-2.5"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={menuId}
        id={`${menuId}-trigger`}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500/35 via-violet-600/25 to-fuchsia-500/20 text-[11px] font-semibold tracking-tight text-white ring-1 ring-white/10"
          aria-hidden
        >
          {initials}
        </span>
        <span className="hidden min-w-0 flex-1 flex-col items-start text-left sm:flex">
          <span className="w-full truncate text-[12px] font-medium leading-tight text-white/80">
            {email}
          </span>
          <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.06em] text-white/38">
            <span>{planLabel}</span>
            <ChevronDown
              className={`h-3 w-3 shrink-0 text-white/35 transition-transform duration-200 ${
                open ? "rotate-180" : ""
              }`}
              aria-hidden
            />
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-white/40 sm:hidden ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={`${menuId}-trigger`}
          className="absolute right-0 top-[calc(100%+10px)] z-[220] w-[min(calc(100vw-2rem),17.5rem)] overflow-hidden rounded-xl border border-white/[0.1] bg-[#0a1020]/95 py-1 shadow-[0_20px_50px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl backdrop-saturate-150"
        >
          <div className="border-b border-white/[0.08] px-3 py-3 sm:hidden">
            <p className="truncate text-[13px] font-medium text-white/88">{email}</p>
            <p className="mt-0.5 text-[11px] text-white/45">{planLabel} plan</p>
          </div>

          <div className="px-2 py-2">
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-white/[0.07] bg-black/25 px-2.5 py-2">
              <div className="flex items-center gap-2 text-white/70">
                <Coins className="h-4 w-4 text-amber-200/55" strokeWidth={1.75} aria-hidden />
                <span className="text-[12px] font-medium">Credits</span>
              </div>
              <span className="tabular-nums text-[14px] font-semibold text-white/92">
                {creditsRemaining}
              </span>
            </div>

            <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/38">
              Account
            </p>
            <Link href="/dashboard/settings" role="menuitem" prefetch className={row} onClick={close}>
              <Settings className="h-4 w-4 text-white/40" strokeWidth={1.75} aria-hidden />
              Settings
            </Link>
            <Link href="/dashboard/billing" role="menuitem" prefetch className={row} onClick={close}>
              <CreditCard className="h-4 w-4 text-white/40" strokeWidth={1.75} aria-hidden />
              Billing
            </Link>
            <Link href="/pricing" role="menuitem" prefetch className={row} onClick={close}>
              <Sparkles className="h-4 w-4 text-white/40" strokeWidth={1.75} aria-hidden />
              Plans &amp; pricing
            </Link>
          </div>

          {isAdmin && (
            <div className="border-t border-white/[0.08] px-2 py-2">
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/38">
                Administration
              </p>
              <Link href="/admin" role="menuitem" prefetch className={row} onClick={close}>
                <Shield className="h-4 w-4 text-fuchsia-300/55" strokeWidth={1.75} aria-hidden />
                Admin
              </Link>
            </div>
          )}

          {!hasPaid && (
            <div className="border-t border-white/[0.08] px-2 py-2">
              <Link
                href="/pricing"
                role="menuitem"
                prefetch
                onClick={close}
                className="flex w-full items-center justify-center rounded-lg border border-purple-400/35 bg-gradient-to-b from-purple-500/22 to-purple-900/15 py-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-purple-100/95 outline-none ring-1 ring-purple-500/15 transition hover:border-purple-400/50 focus-visible:ring-2 focus-visible:ring-purple-400/45"
              >
                Upgrade plan
              </Link>
            </div>
          )}

          <div className="border-t border-white/[0.08] px-2 py-2">
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={handleLogout}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-red-300/90 outline-none transition-colors hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-400/35 disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              {busy ? "Signing out…" : "Log out"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
