export function AdminOverviewSkeleton() {
  return (
    <div className="space-y-8 animate-pulse" aria-busy="true" aria-label="Loading overview">
      <div className="space-y-3">
        <div className="h-9 w-64 rounded-lg bg-white/[0.08]" />
        <div className="h-4 max-w-xl rounded bg-white/[0.06]" />
      </div>
      <div className="h-16 rounded-2xl bg-white/[0.05]" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl border border-white/[0.06] bg-white/[0.04]" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-72 rounded-2xl border border-white/[0.06] bg-white/[0.04]" />
        <div className="h-72 rounded-2xl border border-white/[0.06] bg-white/[0.04]" />
      </div>
      <div className="h-56 rounded-2xl border border-white/[0.06] bg-white/[0.04]" />
    </div>
  )
}
