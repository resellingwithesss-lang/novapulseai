import { ArrowUpRight, Shield } from "lucide-react"
import { billingPlanTagline } from "@/components/billing/utils"
import {
  getPlanPriceGbp,
  PLAN_CONFIG,
  planTierIndex,
  type BillingInterval,
  type UiPlan,
} from "@/lib/plans"

export const BILLING_PAID_TIERS: Exclude<UiPlan, "FREE">[] = ["STARTER", "PRO", "ELITE"]

type Props = {
  normalizedPlan: UiPlan
  billing: BillingInterval
  onBillingChange: (billing: BillingInterval) => void
  showStarterCta: boolean
  showProCta: boolean
  showEliteCta: boolean
  showAnyPlanCta: boolean
  needsPaidRecovery: boolean
  planActionLoading: string | null
  planActionError: string | null
  onPlanChange: (plan: "STARTER" | "PRO" | "ELITE", billing: BillingInterval) => void
}

export function BillingPlansSection({
  normalizedPlan,
  billing,
  onBillingChange,
  showStarterCta,
  showProCta,
  showEliteCta,
  showAnyPlanCta,
  needsPaidRecovery,
  planActionLoading,
  planActionError,
  onPlanChange,
}: Props) {
  return (
    <section aria-labelledby="billing-plans-heading">
      <h2
        id="billing-plans-heading"
        className="text-lg font-semibold tracking-[-0.015em] text-white"
      >
        Plans & upgrades
      </h2>
      <p className="mt-1 text-sm text-white/48">
        Pick a billing interval, then use the buttons below to start checkout or change plans.
      </p>

      <div className="mt-4 inline-flex rounded-full border border-white/[0.08] bg-black/30 p-1">
        {(["monthly", "yearly"] as BillingInterval[]).map((interval) => (
          <button
            key={interval}
            type="button"
            onClick={() => onBillingChange(interval)}
            className={
              "rounded-full px-4 py-1.5 text-xs font-medium transition " +
              (billing === interval
                ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
                : "text-white/55 hover:text-white/85")
            }
          >
            {interval === "monthly" ? "Monthly" : "Yearly"}
          </button>
        ))}
      </div>

      {planActionError ? (
        <p className="mt-4 text-sm text-red-300/95" role="alert">
          {planActionError}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {BILLING_PAID_TIERS.map((tier) => {
          const current = normalizedPlan === tier
          const credits = PLAN_CONFIG[tier].credits
          const price = getPlanPriceGbp(tier, billing)
          const showCta =
            (tier === "STARTER" && showStarterCta) ||
            (tier === "PRO" && showProCta) ||
            (tier === "ELITE" && showEliteCta)

          return (
            <div
              key={tier}
              className={
                "relative flex flex-col rounded-2xl border p-6 transition " +
                (current
                  ? "border-purple-400/35 bg-purple-500/[0.08] ring-1 ring-purple-400/20"
                  : "border-white/[0.08] bg-white/[0.02] hover:border-white/14")
              }
            >
              {current ? (
                <span className="absolute right-4 top-4 rounded-full bg-purple-500/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-100/95">
                  Current
                </span>
              ) : null}
              <p className="text-lg font-semibold text-white">{tier}</p>
              <p className="mt-2 text-sm leading-relaxed text-white/50">
                {billingPlanTagline(tier)}
              </p>
              <p className="mt-4 text-2xl font-semibold tabular-nums text-white">
                £{price.toFixed(2)}
                <span className="text-sm font-normal text-white/45">
                  {billing === "yearly" ? "/yr" : "/mo"}
                </span>
              </p>
              <p className="mt-1 text-[11px] text-white/38">
                {billing === "yearly"
                  ? "Billed yearly via Stripe checkout"
                  : "Billed monthly via Stripe checkout"}
              </p>
              <p className="mt-1 text-xs text-white/45">
                {billing === "yearly"
                  ? `${credits} credits per month included with your plan`
                  : `${credits} credits / month included`}
              </p>
              <div className="mt-6 flex-1" />
              {showCta ? (
                <button
                  type="button"
                  disabled={planActionLoading !== null}
                  onClick={() => void onPlanChange(tier, billing)}
                  className={
                    "inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] disabled:cursor-not-allowed disabled:opacity-50 " +
                    (tier === "ELITE"
                      ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-900/20 hover:opacity-[0.96]"
                      : "border border-white/[0.12] bg-white/[0.06] text-white hover:bg-white/[0.1]")
                  }
                >
                  {planActionLoading === tier
                    ? "Redirecting…"
                    : needsPaidRecovery && normalizedPlan === tier
                      ? "Restore subscription"
                      : tier === "ELITE"
                        ? "Upgrade to Elite"
                        : `Choose ${tier === "PRO" ? "Pro" : "Starter"}`}
                  <ArrowUpRight className="h-4 w-4 opacity-80" aria-hidden />
                </button>
              ) : current ? (
                <p className="text-center text-xs text-white/45">You are on this plan.</p>
              ) : (
                <p className="text-center text-xs text-white/40">
                  {planTierIndex(normalizedPlan) > planTierIndex(tier)
                    ? "Downgrades are managed in Stripe."
                    : "Included in a higher tier."}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {!showAnyPlanCta && normalizedPlan === "ELITE" ? (
        <p className="mt-6 text-center text-sm text-white/50">
          You are on the highest public tier. Use the billing portal for invoices, payment method,
          or cancellation.
        </p>
      ) : null}

      <p className="mt-6 flex flex-wrap items-center justify-center gap-1 text-center text-xs text-white/40">
        <Shield className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Payments secured by Stripe · Cancel or change plan anytime from Billing
      </p>
    </section>
  )
}
