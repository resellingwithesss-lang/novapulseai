function Shimmer({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-lg bg-white/[0.08] motion-safe:animate-pulse ${className}`.trim()}
      aria-hidden
    />
  )
}

export function WorkspacesListSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading workspaces">
      <div className="flex items-center justify-between gap-3">
        <Shimmer className="h-5 w-40" />
        <Shimmer className="h-8 w-32 rounded-full" />
      </div>
      <ul className="grid gap-4">
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className="rounded-2xl border border-white/10 bg-black/20 p-5"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:justify-between">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Shimmer className="h-5 w-48" />
                  <Shimmer className="h-5 w-28 rounded-full" />
                </div>
                <Shimmer className="h-4 w-full max-w-md" />
                <Shimmer className="h-3 w-full max-w-sm" />
                <Shimmer className="h-3 w-full max-w-xs" />
              </div>
              <div className="flex flex-col gap-2 lg:w-44">
                <Shimmer className="h-9 w-full rounded-full" />
                <Shimmer className="h-9 w-full rounded-full" />
                <div className="flex gap-2">
                  <Shimmer className="h-9 flex-1 rounded-lg" />
                  <Shimmer className="h-9 w-16 rounded-lg" />
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function BrandVoicesListSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading brand voices">
      <Shimmer className="h-6 w-36" />
      <ul className="grid gap-3">
        {[0, 1].map((i) => (
          <li key={i} className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-col justify-between gap-3 sm:flex-row">
              <div className="min-w-0 flex-1 space-y-2">
                <Shimmer className="h-4 w-44" />
                <Shimmer className="h-3 w-32" />
                <Shimmer className="h-16 w-full max-w-xl rounded-xl" />
                <Shimmer className="h-3 w-24" />
              </div>
              <div className="flex gap-2 sm:flex-col">
                <Shimmer className="h-9 w-20 rounded-lg" />
                <Shimmer className="h-9 w-20 rounded-lg" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Saved grid only — generator + hero stay mounted while lists load. */
export function ContentPacksSavedGridSkeleton() {
  return (
    <ul
      className="mt-6 grid gap-4 sm:grid-cols-2"
      aria-busy="true"
      aria-label="Loading saved packs"
    >
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="rounded-2xl border border-white/10 bg-black/25 p-5">
          <div className="flex gap-2">
            <Shimmer className="h-5 w-20 rounded-full" />
            <Shimmer className="h-4 w-28" />
          </div>
          <Shimmer className="mt-4 h-5 w-full max-w-sm" />
          <Shimmer className="mt-3 h-12 w-full rounded-lg" />
          <div className="mt-4 flex gap-2">
            <Shimmer className="h-6 w-20 rounded-full" />
            <Shimmer className="h-6 w-24 rounded-full" />
          </div>
          <div className="mt-5 flex gap-2 border-t border-white/10 pt-4">
            <Shimmer className="h-9 flex-1 rounded-full" />
            <Shimmer className="h-9 flex-1 rounded-full" />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function LibraryPageSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading library">
      <div className="rounded-2xl border border-white/10 bg-black/20 p-5 md:p-6">
        <Shimmer className="h-4 w-48" />
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <Shimmer className="h-20 rounded-xl" />
          <Shimmer className="h-20 rounded-xl" />
          <Shimmer className="h-20 rounded-xl" />
        </div>
      </div>
      <Shimmer className="h-4 w-56" />
      <ul className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <Shimmer className="h-3 w-24" />
            <Shimmer className="mt-3 h-4 w-full max-w-lg" />
            <Shimmer className="mt-2 h-3 w-2/3" />
            <div className="mt-3 flex gap-2">
              <Shimmer className="h-6 w-20 rounded-md" />
              <Shimmer className="h-6 w-24 rounded-md" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ContentPackDetailSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading pack">
      <Shimmer className="h-4 w-28" />
      <div className="space-y-3">
        <Shimmer className="h-8 w-3/4 max-w-lg" />
        <Shimmer className="h-4 w-full max-w-xl" />
        <Shimmer className="h-3 w-64" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Shimmer key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Shimmer className="h-4 w-full max-w-2xl" />
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Shimmer key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
