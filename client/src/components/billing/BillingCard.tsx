import type { ReactNode } from "react"

type BillingCardProps = {
  children: ReactNode
  className?: string
  /** When set, the card is a landmark labelled by that element id (use on inner heading). */
  ariaLabelledBy?: string
  /** When no visible heading, pass an accessible name for the region. */
  ariaLabel?: string
}

export function BillingCard({
  children,
  className = "",
  ariaLabelledBy,
  ariaLabel,
}: BillingCardProps) {
  return (
    <section
      role="region"
      aria-labelledby={ariaLabelledBy || undefined}
      aria-label={ariaLabelledBy ? undefined : ariaLabel}
      className={`rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-7 ${className}`.trim()}
    >
      {children}
    </section>
  )
}
