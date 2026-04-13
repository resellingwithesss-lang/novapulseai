"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useId, useRef, useState } from "react"
import { ChevronDown, Layers, Mic2, Package } from "lucide-react"

const STUDIO_ROUTES = [
  { href: "/dashboard/workspaces", label: "Workspaces", icon: Layers },
  { href: "/dashboard/brand-voices", label: "Brand voices", icon: Mic2 },
  { href: "/dashboard/content-packs", label: "Content packs", icon: Package },
] as const

function studioActive(pathname: string) {
  return STUDIO_ROUTES.some(
    (r) => pathname === r.href || pathname.startsWith(`${r.href}/`)
  )
}

export default function StudioNavMenu({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() || "/"
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const active = studioActive(pathname)

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

  const baseBtn =
    "relative inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-medium tracking-[-0.01em] outline-none transition-[color,background-color,box-shadow] duration-150 ease-out " +
    "lg:px-3 lg:py-2 focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816]"

  const state = open || active
    ? "bg-gradient-to-b from-white/[0.085] to-white/[0.028] text-white/95 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.055)]"
    : "text-white/54 hover:bg-white/[0.042] hover:text-white/86"

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        className={`group ${baseBtn} ${state}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={menuId}
        id={`${menuId}-trigger`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="relative z-[1]">Studio</span>
        <ChevronDown
          className={`relative z-[1] h-3.5 w-3.5 shrink-0 text-white/45 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
        <span
          aria-hidden
          className={`pointer-events-none absolute -bottom-px left-2.5 right-2.5 h-px rounded-full bg-gradient-to-r from-transparent via-fuchsia-400/50 to-transparent transition-opacity duration-200 lg:left-3 lg:right-3 ${
            active || open ? "opacity-100" : "opacity-0 group-hover:opacity-[0.38]"
          }`}
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={`${menuId}-trigger`}
          className="absolute left-0 top-[calc(100%+10px)] z-[220] min-w-[13.5rem] overflow-hidden rounded-xl border border-white/[0.1] bg-[#0a1020]/95 py-1 shadow-[0_20px_50px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl backdrop-saturate-150"
        >
          <div className="px-1.5 py-1">
            <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/38">
              Create &amp; organize
            </p>
            {STUDIO_ROUTES.map(({ href, label, icon: Icon }) => {
              const itemActive =
                pathname === href || pathname.startsWith(`${href}/`)
              return (
                <Link
                  key={href}
                  href={href}
                  role="menuitem"
                  prefetch
                  onClick={() => {
                    setOpen(false)
                    onNavigate?.()
                  }}
                  className={
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium outline-none transition-colors focus-visible:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-400/35 " +
                    (itemActive
                      ? "bg-white/[0.08] text-white"
                      : "text-white/72 hover:bg-white/[0.055] hover:text-white/92")
                  }
                  aria-current={itemActive ? "page" : undefined}
                >
                  <Icon
                    className="h-4 w-4 shrink-0 text-white/40"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  {label}
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
