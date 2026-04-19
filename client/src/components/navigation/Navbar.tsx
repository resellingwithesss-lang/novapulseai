"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { LogOut, Menu, X } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { isPaidPlan, normalizePlan, planDisplayName } from "@/lib/plans"
import { isAdminOrAboveRole } from "@/lib/roles"
import StudioNavMenu from "@/components/navigation/StudioNavMenu"
import UserAccountMenu from "@/components/navigation/UserAccountMenu"

const APP_NAME = "NovaPulseAI"

function isHashOnlyHref(href: string) {
  return href.startsWith("/#")
}

function navItemActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard"
  if (isHashOnlyHref(href)) return false
  return pathname === href || pathname.startsWith(`${href}/`)
}

function NavLink({
  href,
  children,
  onNavigate,
}: {
  href: string
  children: React.ReactNode
  onNavigate?: () => void
}) {
  const pathname = usePathname() || "/"
  const active = navItemActive(pathname, href)

  const base =
    "relative whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] font-medium tracking-[-0.01em] outline-none transition-[color,background-color,box-shadow] duration-150 ease-out " +
    "lg:px-3 lg:py-2 focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816]"

  const state = active
    ? "bg-gradient-to-b from-white/[0.085] to-white/[0.028] text-white/95 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.055)]"
    : "text-white/54 hover:bg-white/[0.042] hover:text-white/86"

  const line = !isHashOnlyHref(href) && (
    <span
      aria-hidden
      className={`pointer-events-none absolute -bottom-px left-2.5 right-2.5 h-px rounded-full bg-gradient-to-r from-transparent via-fuchsia-400/50 to-transparent transition-opacity duration-200 lg:left-3 lg:right-3 ${
        active ? "opacity-100" : "opacity-0 group-hover:opacity-[0.38]"
      }`}
    />
  )

  if (isHashOnlyHref(href)) {
    return (
      <a
        href={href}
        onClick={onNavigate}
        className={`group ${base} ${state}`}
      >
        <span className="relative z-[1]">{children}</span>
        {line}
      </a>
    )
  }

  return (
    <Link
      href={href}
      onClick={onNavigate}
      prefetch
      className={`group ${base} ${state}`}
      aria-current={active ? "page" : undefined}
    >
      <span className="relative z-[1]">{children}</span>
      {line}
    </Link>
  )
}

export default function Navbar() {
  const pathname = usePathname() || "/"
  const router = useRouter()
  const { user, status, logout, refreshUser } = useAuth()

  const [mobileOpen, setMobileOpen] = useState(false)
  const mobileRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const success = params.get("success")
    const canceled = params.get("canceled")
    const isBillingPage = pathname.startsWith("/dashboard/billing")

    if (success === "true" || canceled === "true" || isBillingPage) {
      refreshUser({ silent: true }).catch(() => {})
    }
  }, [pathname, refreshUser])

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mobileOpen])

  const onLogout = async () => {
    setMobileOpen(false)
    await logout()
    router.replace("/login")
  }

  const identityLabel = useMemo(() => {
    const email = user?.email?.trim()
    if (!email) return "Account"
    return email
  }, [user?.email])

  const planLabel = planDisplayName(user?.plan)
  const creditsRemaining = user?.credits ?? 0
  const hasPaid = Boolean(user && isPaidPlan(user.plan))

  const isLanding = pathname === "/"
  const closeMobile = () => setMobileOpen(false)

  const showGuestChrome = !user

  return (
    <header
      ref={mobileRef}
      className={`sticky top-0 z-[200] ${
        isLanding ? "" : "backdrop-blur-xl backdrop-saturate-150"
      } ${
        isLanding
          ? "border-b border-transparent bg-[#050816]/42 supports-[backdrop-filter]:bg-[#050816]/30"
          : "border-b border-white/[0.08] bg-[#050816]/70 shadow-[0_6px_24px_rgba(0,0,0,0.26),inset_0_1px_0_rgba(255,255,255,0.045)] supports-[backdrop-filter]:bg-[#050816]/55"
      }`}
    >
      {!isLanding && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-purple-500/16 to-transparent"
          aria-hidden
        />
      )}

      {!isLanding && (
        <div
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_100%_80%_at_50%_-40%,rgba(88,28,135,0.14),transparent_55%)]"
          aria-hidden
        />
      )}

      <div className="relative z-[1] mx-auto flex h-16 w-full min-w-0 max-w-none items-center gap-3 px-5 sm:gap-4 sm:px-8 lg:gap-5 lg:px-12 xl:px-16 pointer-events-auto">
        <Link
          href="/"
          className="group shrink-0 rounded-xl px-2.5 py-2 outline-none transition hover:bg-white/[0.045] focus-visible:ring-2 focus-visible:ring-purple-400/55 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816]"
        >
          <span className="np-text-gradient text-[16px] font-semibold tracking-[-0.02em] sm:text-[17px]">
            {APP_NAME}
          </span>
        </Link>

        <nav
          className="hidden min-w-0 flex-1 items-center justify-center md:flex"
          aria-label="Main"
        >
          <div className="flex max-w-full items-center gap-px overflow-visible rounded-full border border-white/[0.065] bg-white/[0.03] px-1 py-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_14px_24px_-24px_rgba(0,0,0,0.8)] lg:px-1.5 lg:py-1">
            {user ? (
              <>
                <NavLink href="/dashboard">Dashboard</NavLink>
                <StudioNavMenu />
                <NavLink href="/dashboard/library">Library</NavLink>
                <NavLink href="/dashboard/tools">Tools</NavLink>
              </>
            ) : (
              <>
                <NavLink href="/#workflow">Product</NavLink>
                <NavLink href="/pricing">Pricing</NavLink>
              </>
            )}
          </div>
        </nav>

        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2 sm:gap-2.5 xl:gap-3">
          {status === "loading" && user && (
            <span
              className="hidden text-xs text-white/35 sm:inline"
              aria-live="polite"
              aria-busy="true"
            >
              …
            </span>
          )}

          {showGuestChrome && (
            <>
              <Link
                href="/login"
                className="hidden rounded-lg px-3 py-2 text-[13px] font-medium text-white/62 outline-none transition hover:bg-white/[0.05] hover:text-white focus-visible:ring-2 focus-visible:ring-purple-400/55 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] sm:inline"
              >
                Log in
              </Link>
              <Link
                href="/register"
                className="hidden rounded-full bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg shadow-purple-900/35 ring-1 ring-white/12 outline-none transition hover:brightness-105 focus-visible:ring-2 focus-visible:ring-purple-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] sm:inline-flex sm:items-center"
              >
                Start free
              </Link>
            </>
          )}

          {user && (
            <>
              <div className="hidden min-w-0 items-center gap-2 sm:flex sm:gap-3">
                <UserAccountMenu
                  email={user.email}
                  planLabel={planLabel}
                  creditsRemaining={creditsRemaining}
                  hasPaid={hasPaid}
                  role={user.role}
                  onLogout={onLogout}
                />
              </div>

              <div className="flex min-w-0 items-center gap-2 sm:hidden">
                <div className="flex min-w-0 max-w-[min(100%,14rem)] items-center gap-1.5 rounded-full border border-white/[0.085] bg-white/[0.04] px-2 py-1">
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.07em] text-purple-200/92">
                    {planLabel}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-white/62">
                    {creditsRemaining}
                    <span className="text-white/36"> cr</span>
                  </span>
                </div>
                <button
                  type="button"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.045] text-white/88 outline-none transition hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816]"
                  aria-expanded={mobileOpen}
                  aria-controls="nav-mobile-drawer"
                  aria-label={mobileOpen ? "Close menu" : "Open menu"}
                  onClick={() => setMobileOpen((o) => !o)}
                >
                  {mobileOpen ? (
                    <X className="h-5 w-5" aria-hidden />
                  ) : (
                    <Menu className="h-5 w-5" aria-hidden />
                  )}
                </button>
              </div>
            </>
          )}

          {showGuestChrome && (
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.045] text-white/88 outline-none transition hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] md:hidden"
              aria-expanded={mobileOpen}
              aria-controls="nav-mobile-drawer"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              onClick={() => setMobileOpen((o) => !o)}
            >
              {mobileOpen ? (
                <X className="h-5 w-5" aria-hidden />
              ) : (
                <Menu className="h-5 w-5" aria-hidden />
              )}
            </button>
          )}
        </div>
      </div>

      {mobileOpen && (
        <div
          id="nav-mobile-drawer"
          className="border-t border-white/[0.075] bg-[#050816]/94 px-4 py-5 shadow-[0_16px_40px_rgba(0,0,0,0.42)] backdrop-blur-xl md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          {!user && (
            <div className="flex flex-col gap-1">
              <MobileRow href="/#workflow" onClick={closeMobile}>
                Product
              </MobileRow>
              <MobileRow href="/pricing" onClick={closeMobile}>
                Pricing
              </MobileRow>
              <MobileRow href="/login" onClick={closeMobile}>
                Log in
              </MobileRow>
              <Link
                href="/register"
                onClick={() => closeMobile()}
                className="mt-3 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 py-3.5 text-center text-sm font-semibold text-white shadow-lg shadow-purple-900/25 outline-none focus-visible:ring-2 focus-visible:ring-purple-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816]"
              >
                Start free
              </Link>
            </div>
          )}
          {user && (
            <div className="flex flex-col gap-0.5">
              <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-white/[0.09] pb-4">
                <span
                  className="rounded-full bg-gradient-to-r from-purple-500/28 to-fuchsia-500/16 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-purple-100/95 ring-1 ring-purple-400/18"
                  title="Current plan"
                >
                  {planLabel}
                </span>
                <span
                  className="text-xs tabular-nums text-white/60"
                  title="Credits remaining"
                >
                  {creditsRemaining} credits
                </span>
              </div>
              <p
                className="mb-2 truncate px-1 text-xs text-white/50"
                title={identityLabel}
              >
                {identityLabel}
              </p>
              <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/38">
                Product
              </p>
              <MobileRow href="/dashboard" onClick={closeMobile}>
                Dashboard
              </MobileRow>
              <p className="mb-1 mt-3 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/38">
                Studio
              </p>
              <MobileRow href="/dashboard/workspaces" onClick={closeMobile}>
                Workspaces
              </MobileRow>
              <MobileRow href="/dashboard/brand-voices" onClick={closeMobile}>
                Brand voices
              </MobileRow>
              <MobileRow href="/dashboard/content-packs" onClick={closeMobile}>
                Content packs
              </MobileRow>
              <MobileRow href="/dashboard/library" onClick={closeMobile}>
                Library
              </MobileRow>
              <MobileRow href="/dashboard/tools" onClick={closeMobile}>
                Tools
              </MobileRow>
              <p className="mb-1 mt-3 border-t border-white/[0.09] pt-4 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/38">
                Account
              </p>
              <MobileRow href="/dashboard/settings" onClick={closeMobile}>
                Settings
              </MobileRow>
              <MobileRow href="/dashboard/billing" onClick={closeMobile}>
                Billing
              </MobileRow>
              <MobileRow href="/dashboard/affiliate" onClick={closeMobile}>
                Referrals
              </MobileRow>
              <MobileRow href="/pricing" onClick={closeMobile}>
                Plans &amp; pricing
              </MobileRow>
              {isAdminOrAboveRole(user.role) && (
                <MobileRow href="/admin" onClick={closeMobile}>
                  Admin
                </MobileRow>
              )}
              {!hasPaid && (
                <Link
                  href="/pricing"
                  onClick={() => closeMobile()}
                  className="mt-3 rounded-full border border-purple-400/40 bg-purple-500/18 py-3.5 text-center text-sm font-semibold text-purple-100 outline-none focus-visible:ring-2 focus-visible:ring-purple-400/55 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816]"
                >
                  Upgrade plan
                </Link>
              )}
              <button
                type="button"
                onClick={onLogout}
                className="mt-2 flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-medium text-red-300/95 outline-none transition hover:bg-red-500/[0.1] focus-visible:ring-2 focus-visible:ring-red-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816]"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                Log out
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  )
}

function MobileRow({
  href,
  onClick,
  children,
}: {
  href: string
  onClick: () => void
  children: React.ReactNode
}) {
  const pathname = usePathname() || "/"
  const active = navItemActive(pathname, href)

  const cls =
    "rounded-xl px-3 py-3.5 text-sm font-medium tracking-[-0.01em] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] " +
    (active
      ? "bg-white/[0.072] text-white/95 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.055)]"
      : "text-white/78 hover:bg-white/[0.055] hover:text-white/88")

  if (isHashOnlyHref(href)) {
    return (
      <a href={href} onClick={() => onClick()} className={cls}>
        {children}
      </a>
    )
  }

  return (
    <Link
      href={href}
      onClick={() => onClick()}
      prefetch
      className={cls}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </Link>
  )
}
