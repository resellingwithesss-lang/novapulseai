import DashboardShell from "@/components/dashboard/DashboardShell"

export function BillingPageSkeleton() {
  return (
    <DashboardShell showCommandHero={false} contentWidth="readable">
      <div className="space-y-6 pb-16">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-white/10" />
        <div className="h-4 max-w-md animate-pulse rounded bg-white/10" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-56 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.03]" />
          <div className="h-56 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.03]" />
        </div>
        <div className="h-40 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.03]" />
      </div>
    </DashboardShell>
  )
}
