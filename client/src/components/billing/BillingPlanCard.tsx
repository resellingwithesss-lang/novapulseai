import type { BillingSubscription } from "@/components/billing/types"
import { billingStatusChipMeta, formatBillingDate } from "@/components/billing/utils"
import { BillingCard } from "@/components/billing/BillingCard"
import type { UiPlan } from "@/lib/plans"

type Props = {
  subscription: BillingSubscription
  normalizedPlan: UiPlan
  memberSince: string | null | undefined
  daysUntilPeriodEnd: number | null
  needsPaidRecovery: boolean
}

export function BillingPlanCard({
  subscription,
  normalizedPlan,
  memberSince,
  daysUntilPeriodEnd,
  needsPaidRecovery,
}: Props) {
  const meta = billingStatusChipMeta(subscription.subscriptionStatus)
  const renewalLabel = subscription.cancelAtPeriodEnd ? "Access until" : "Next renewal"

  return (
    <BillingCard ariaLabelledBy="billing-plan-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p
            id="billing-plan-heading"
            className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40"
          >
            Current plan
          </p>
          <p
            data-testid="billing-current-plan"
            className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl"
          >
            {normalizedPlan}
          </p>
        </div>
        <span
          data-testid="billing-status"
          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${meta.bg} ${meta.border} ${meta.color}`}
        >
          {meta.label}
        </span>
      </div>

      <dl className="mt-6 space-y-3 text-sm">
        <div className="flex justify-between gap-4 border-t border-white/[0.06] pt-4">
          <dt className="text-white/45">Member since</dt>
          <dd className="font-medium text-white/88">{formatBillingDate(memberSince)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-white/45">{renewalLabel}</dt>
          <dd className="font-medium text-white/88">
            {formatBillingDate(subscription.subscriptionEndsAt)}
          </dd>
        </div>
        {daysUntilPeriodEnd !== null && daysUntilPeriodEnd > 0 ? (
          <div className="flex justify-between gap-4">
            <dt className="text-white/45">Days in this period</dt>
            <dd className="font-medium tabular-nums text-white/88">{daysUntilPeriodEnd}</dd>
          </div>
        ) : null}
      </dl>

      {needsPaidRecovery ? (
        <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/80">
          Your paid plan needs attention in Stripe (past due, canceled, or expired). Use{" "}
          <strong className="text-amber-50">Subscribe</strong> below for your tier to restore
          billing, or open the portal if you already have a card on file.
        </p>
      ) : null}
    </BillingCard>
  )
}
