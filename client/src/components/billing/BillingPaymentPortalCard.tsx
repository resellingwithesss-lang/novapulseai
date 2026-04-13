import { CreditCard, ExternalLink } from "lucide-react"
import { BillingCard } from "@/components/billing/BillingCard"

type Props = {
  hasStripeCustomer: boolean
  portalError: string | null
  onOpenPortal: () => void
}

export function BillingPaymentPortalCard({
  hasStripeCustomer,
  portalError,
  onOpenPortal,
}: Props) {
  return (
    <BillingCard ariaLabelledBy="billing-payment-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-purple-200/80" aria-hidden />
            <h2
              id="billing-payment-heading"
              className="text-[15px] font-medium tracking-[-0.015em] text-white/95"
            >
              Payment method & invoices
            </h2>
          </div>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/48">
            Cards and tax invoices live in Stripe&apos;s secure Customer Portal. From there you can
            update your default card, download PDFs, and manage cancellation.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <button
            type="button"
            onClick={() => void onOpenPortal()}
            disabled={!hasStripeCustomer}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.07] px-5 text-sm font-semibold text-white outline-none transition hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Open billing portal
            <ExternalLink className="h-4 w-4 opacity-80" aria-hidden />
          </button>
          {!hasStripeCustomer ? (
            <p className="max-w-xs text-right text-xs text-white/45">
              Available after your first paid subscription checkout.
            </p>
          ) : null}
        </div>
      </div>
      {portalError ? (
        <p className="mt-4 text-sm text-red-300/95" role="alert">
          {portalError}
        </p>
      ) : null}
    </BillingCard>
  )
}
