import DashboardShell from "@/components/dashboard/DashboardShell"

type Props = {
  message: string
  onRetry: () => void
}

export function BillingPageLoadError({ message, onRetry }: Props) {
  return (
    <DashboardShell showCommandHero={false} contentWidth="readable">
      <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-5 py-6 text-left sm:text-center">
        <p className="text-sm font-medium text-red-200/95">{message}</p>
        <p className="mt-2 text-xs leading-relaxed text-red-100/55 sm:mx-auto sm:max-w-md">
          If this persists, confirm you are online and signed in, then retry. Billing data loads
          from Stripe and your account record.
        </p>
        <button
          type="button"
          onClick={() => onRetry()}
          className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.06] px-5 text-sm font-medium text-white outline-none transition hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] sm:w-auto"
        >
          Try again
        </button>
      </div>
    </DashboardShell>
  )
}
