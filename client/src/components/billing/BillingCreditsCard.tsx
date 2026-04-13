import { BillingCard } from "@/components/billing/BillingCard"
import { planDisplayName, type UiPlan } from "@/lib/plans"

type Props = {
  creditsAvailable: number | string | null | undefined
  planLimit: number
  normalizedPlan: UiPlan
}

export function BillingCreditsCard({ creditsAvailable, planLimit, normalizedPlan }: Props) {
  return (
    <BillingCard ariaLabelledBy="billing-credits-heading">
      <p
        id="billing-credits-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40"
      >
        Credits & allowance
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <span className="text-3xl font-semibold tabular-nums tracking-tight text-white">
          {creditsAvailable ?? "—"}
        </span>
        <span className="pb-1 text-sm text-white/45">credits available now</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-white/50">
        Credits power script, clip, story, and video runs. When you hit zero, upgrade or wait for
        your plan&apos;s monthly refresh (paid plans).
      </p>
      <dl className="mt-6 space-y-3 border-t border-white/[0.06] pt-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-white/45">Included per month</dt>
          <dd
            data-testid="billing-monthly-limit"
            className="font-semibold tabular-nums text-white/90"
          >
            {planLimit}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-white/45">Plan tier</dt>
          <dd className="font-medium text-white/88">{planDisplayName(normalizedPlan)}</dd>
        </div>
      </dl>
    </BillingCard>
  )
}
