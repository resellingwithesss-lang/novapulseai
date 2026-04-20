"use client"

/**
 * Shared loading shell while /auth/me is in flight or during sign-in before user is attached.
 * Keeps background + vertical rhythm aligned with dashboard routes to reduce perceived flicker.
 */
export function AuthSessionPendingShell({
  message = "Loading your workspace…",
}: {
  message?: string
}) {
  return (
    <main className="relative min-h-[calc(100dvh-4rem)] min-w-0 overflow-x-hidden bg-[#050816]">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_110%_72%_at_50%_-18%,rgba(124,58,237,0.08),transparent_62%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_55%,rgba(236,72,153,0.05),transparent_60%)]" />
      </div>
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-6 px-6 py-24 sm:px-8 md:py-32 lg:px-12">
        <div
          className="h-10 w-48 rounded-xl bg-white/[0.06] motion-safe:animate-pulse"
          aria-hidden
        />
        <div className="flex w-full max-w-md flex-col gap-3">
          <div className="h-4 w-full rounded-md bg-white/[0.05] motion-safe:animate-pulse" />
          <div className="h-4 w-[88%] rounded-md bg-white/[0.05] motion-safe:animate-pulse" />
          <div className="h-4 w-[72%] rounded-md bg-white/[0.05] motion-safe:animate-pulse" />
        </div>
        <p className="text-sm text-white/50" aria-live="polite">
          {message}
        </p>
      </div>
    </main>
  )
}

export function AdminSessionPendingShell() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0B0F19] px-6 text-white">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex w-full gap-3">
          <div className="h-12 w-12 shrink-0 rounded-lg bg-white/[0.07] motion-safe:animate-pulse" />
          <div className="flex flex-1 flex-col justify-center gap-2">
            <div className="h-3 w-[65%] rounded bg-white/[0.08] motion-safe:animate-pulse" />
            <div className="h-3 w-[45%] rounded bg-white/[0.06] motion-safe:animate-pulse" />
          </div>
        </div>
        <p className="text-center text-sm text-white/55" aria-live="polite">
          Verifying admin access…
        </p>
      </div>
    </main>
  )
}
