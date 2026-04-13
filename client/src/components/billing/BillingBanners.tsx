import { AlertTriangle, CheckCircle2, ExternalLink, Receipt, Sparkles } from "lucide-react"
import type { BillingSubscription } from "@/components/billing/types"
import { formatBillingDate } from "@/components/billing/utils"
import type { UiPlan } from "@/lib/plans"

type Props = {
  checkoutSuccess: boolean
  checkoutCanceled: boolean
  subscription: BillingSubscription
  normalizedPlan: UiPlan
  trialDaysLeft: number | null
  needsPaidRecovery: boolean
  hasStripeCustomer: boolean
  onOpenPortal: () => void
}

export function BillingBanners({
  checkoutSuccess,
  checkoutCanceled,
  subscription,
  normalizedPlan,
  trialDaysLeft,
  needsPaidRecovery,
  hasStripeCustomer,
  onOpenPortal,
}: Props) {
  const showCancelScheduled =
    subscription.cancelAtPeriodEnd &&
    (subscription.subscriptionStatus === "ACTIVE" ||
      subscription.subscriptionStatus === "TRIALING")

  const showCanceledEnded =
    subscription.subscriptionStatus === "CANCELED" && !showCancelScheduled

  return (
    <div className="space-y-4">
      {checkoutSuccess ? (
        <div
          className="flex items-start gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100/95"
          role="status"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden />
          <div>
            <p className="font-medium">Payment successful</p>
            <p className="mt-0.5 text-emerald-100/75">
              Your plan and credits can take a moment to sync. This page refreshes automatically.
            </p>
          </div>
        </div>
      ) : null}

      {checkoutCanceled ? (
        <div
          className="flex items-start gap-3 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-white/70"
          role="status"
        >
          <Receipt className="mt-0.5 h-4 w-4 shrink-0 text-white/45" aria-hidden />
          <div>
            <p className="font-medium text-white/88">Checkout canceled</p>
            <p className="mt-0.5 text-white/55">
              No charges were made. Pick a plan below when you are ready.
            </p>
          </div>
        </div>
      ) : null}

      {subscription.subscriptionStatus === "PAST_DUE" ? (
        <div
          className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/[0.12] px-4 py-3 text-sm"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-red-100/95">Payment failed — update your card</p>
            <p className="mt-1 text-red-100/70">
              Stripe could not charge your default payment method. Update it in the billing portal
              to avoid losing paid access.
            </p>
            {hasStripeCustomer ? (
              <button
                type="button"
                onClick={onOpenPortal}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-white/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/40"
              >
                Update payment method
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {showCancelScheduled ? (
        <div
          className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90"
          role="status"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
          <div>
            <p className="font-medium">Subscription ending</p>
            <p className="mt-0.5 text-amber-100/75">
              You keep access until{" "}
              <span className="font-medium text-amber-50">
                {formatBillingDate(subscription.subscriptionEndsAt)}
              </span>
              . Resume anytime from the billing portal if you change your mind.
            </p>
          </div>
        </div>
      ) : null}

      {showCanceledEnded ? (
        <div
          className="flex items-start gap-3 rounded-2xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-white/75"
          role="status"
        >
          <Receipt className="mt-0.5 h-4 w-4 shrink-0 text-white/45" aria-hidden />
          <div>
            <p className="font-medium text-white/88">Subscription canceled</p>
            <p className="mt-0.5 text-white/55">
              Paid access follows your plan state in Stripe. If you still need tools, choose your
              tier below or reopen the billing portal.
            </p>
          </div>
        </div>
      ) : null}

      {subscription.subscriptionStatus === "EXPIRED" ||
      subscription.subscriptionStatus === "PAUSED" ? (
        <div
          className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.08] px-4 py-3 text-sm text-amber-100/85"
          role="status"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300/90" aria-hidden />
          <div>
            <p className="font-medium text-amber-50/95">
              {subscription.subscriptionStatus === "PAUSED" ? "Subscription paused" : "Subscription expired"}
            </p>
            <p className="mt-0.5 text-amber-100/70">
              Restore access with the plan buttons below or manage billing in Stripe.
            </p>
          </div>
        </div>
      ) : null}

      {trialDaysLeft !== null && trialDaysLeft > 0 ? (
        <div
          className="flex items-start gap-3 rounded-2xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-sm text-sky-100/90"
          role="status"
        >
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-hidden />
          <div>
            <p className="font-medium">Pro trial active</p>
            <p className="mt-0.5 text-sky-100/75">
              {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"} left on your trial. Unless you
              cancel, you will roll onto paid Pro at the end of the trial.
            </p>
          </div>
        </div>
      ) : null}

      {normalizedPlan === "FREE" &&
      subscription.subscriptionStatus !== "TRIALING" &&
      !needsPaidRecovery ? (
        <div
          className="rounded-2xl border border-purple-500/20 bg-purple-500/[0.08] px-4 py-3 text-sm text-white/80"
          role="region"
          aria-label="Free plan"
        >
          <p className="font-medium text-white/90">You are on Free</p>
          <p className="mt-1 text-white/60">
            Includes a small credit pool for the Video Script Engine. Upgrade to unlock clip,
            prompt, story, and video pipelines with monthly credits.
          </p>
        </div>
      ) : null}
    </div>
  )
}
