import Link from "next/link"
import { ExternalLink, Receipt } from "lucide-react"
import type { BillingInvoiceRow } from "@/components/billing/types"
import { BillingCard } from "@/components/billing/BillingCard"

type Props = {
  invoices: BillingInvoiceRow[]
  hasStripeCustomer: boolean
}

export function BillingInvoicesSection({ invoices, hasStripeCustomer }: Props) {
  return (
    <BillingCard ariaLabelledBy="billing-invoices-heading">
      <div className="flex items-center gap-2">
        <Receipt className="h-4 w-4 text-purple-200/80" aria-hidden />
        <h2
          id="billing-invoices-heading"
          className="text-[15px] font-medium tracking-[-0.015em] text-white/95"
        >
          Recent invoices
        </h2>
      </div>
      <p className="mt-2 text-sm text-white/48">
        PDF receipts open in a new tab. Full history is always available in the billing portal.
      </p>

      {invoices.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-white/[0.1] bg-black/15 px-4 py-10 text-center text-sm text-white/50">
          {hasStripeCustomer
            ? "No invoices yet — they will appear here after your first successful charge."
            : "No billing history yet. Invoices appear after you subscribe to a paid plan."}
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-white/[0.06]">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-white/[0.06] bg-black/25 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Date
                </th>
                <th scope="col" className="px-4 py-3">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Amount
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Receipt
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr
                  key={invoice.id}
                  className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-white/75">
                    {new Date(invoice.created * 1000).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 capitalize text-white/55">
                    {invoice.status?.replace(/_/g, " ") ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-white/88">
                    £{(invoice.amount_paid / 100).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {invoice.hosted_invoice_url ? (
                      <a
                        href={invoice.hosted_invoice_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-purple-200/90 underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45"
                      >
                        View
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    ) : (
                      <span className="text-white/35">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-center text-sm text-white/45">
        Questions? See{" "}
        <Link
          href="/pricing"
          className="font-medium text-purple-200/90 underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45"
        >
          Pricing
        </Link>{" "}
        or open the portal for account-level details.
      </p>
    </BillingCard>
  )
}
