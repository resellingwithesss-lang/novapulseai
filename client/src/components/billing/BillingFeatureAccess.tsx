import { Shield } from "lucide-react"
import { BillingCard } from "@/components/billing/BillingCard"

export type BillingFeatureRow = {
  name: string
  allowed: boolean
  reason: string | null
  unlock: string
}

type Props = {
  rows: BillingFeatureRow[]
}

export function BillingFeatureAccess({ rows }: Props) {
  return (
    <BillingCard ariaLabelledBy="billing-access-heading">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-purple-200/80" aria-hidden />
        <h2
          id="billing-access-heading"
          className="text-[15px] font-medium tracking-[-0.015em] text-white/95"
        >
          What your plan unlocks
        </h2>
      </div>
      <p className="mt-2 text-sm text-white/48">
        Live checks against your account. If something is blocked, the reason shows here.
      </p>
      <ul className="mt-5 space-y-2">
        {rows.map((feature) => (
          <li
            key={feature.name}
            className="rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-white/88">{feature.name}</span>
              <span
                className={
                  feature.allowed ? "text-sm text-emerald-300/95" : "text-sm text-amber-200/90"
                }
              >
                {feature.allowed ? "Included" : "Not included"}
              </span>
            </div>
            {!feature.allowed ? (
              <p className="mt-2 text-xs leading-relaxed text-white/50">
                {feature.reason || "Upgrade required"} — unlocks on{" "}
                <span className="font-medium text-white/70">{feature.unlock}</span>
              </p>
            ) : null}
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3 text-sm text-white/50">
            Could not load entitlements. Refresh the page.
          </li>
        ) : null}
      </ul>
    </BillingCard>
  )
}
