"use client"

import { Check } from "lucide-react"

type BillingType = "monthly" | "yearly"
type UiPlan = "STARTER" | "PRO" | "ELITE"

const PLAN_HEADLINE: Record<UiPlan, string> = {
  STARTER: "Starter",
  PRO: "Pro",
  ELITE: "Elite",
}

export type PricingFeatureGroup = {
  heading: string
  items: string[]
}

type PricingPlanCardProps = {
  title: UiPlan
  subtitle: string
  /** One line: who this tier is for */
  audience?: string
  price: number
  billing: BillingType
  creditsLine: string
  /** Short line under credits — how credits relate to runs */
  creditsExplainer?: string
  /** Prefer grouped features for scanability */
  featureGroups?: PricingFeatureGroup[]
  /** Fallback flat list */
  features?: string[]
  buttonText: string
  highlight?: boolean
  topBadge?: string
  pillBadge?: string
  /** Pro = primary filled CTA; others = strong outline */
  ctaVariant?: "primary" | "secondary"
  loading: boolean
  current: boolean
  onClick: () => void
}

function formatPlanPrice(pence: number): string {
  const whole = pence % 100 === 0
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(pence / 100)
}

export default function PricingPlanCard({
  title,
  subtitle,
  audience,
  price,
  billing,
  creditsLine,
  creditsExplainer,
  featureGroups,
  features = [],
  buttonText,
  highlight = false,
  topBadge,
  pillBadge,
  ctaVariant = "secondary",
  loading,
  current,
  onClick,
}: PricingPlanCardProps) {
  const isPrimaryCta = ctaVariant === "primary"

  const frameClass = highlight
    ? "bg-gradient-to-b from-violet-300/32 via-fuchsia-400/16 to-transparent p-px shadow-[0_26px_56px_-28px_rgba(139,92,246,0.5)] ring-1 ring-violet-300/22"
    : "bg-gradient-to-b from-white/[0.1] to-white/[0.035] p-px shadow-[0_18px_40px_-30px_rgba(0,0,0,0.8)]"

  const innerClass = highlight
    ? "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] lg:z-10"
    : "hover:border-white/[0.1]"

  const badgeClass = highlight
    ? "border-violet-300/30 bg-gradient-to-r from-violet-500/75 via-fuchsia-500/72 to-pink-500/75 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white shadow-[0_10px_28px_rgba(76,29,149,0.35)]"
    : title === "ELITE"
      ? "border-amber-300/35 bg-gradient-to-r from-amber-500/75 to-orange-500/75 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white shadow-[0_8px_22px_rgba(120,53,15,0.3)]"
      : "border-white/12 bg-white/[0.08] px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/88"

  const pillClass = highlight
    ? "border-emerald-400/35 bg-emerald-500/15 text-emerald-100/95"
    : "border-white/12 bg-white/[0.06] text-white/70"

  const ctaClass = isPrimaryCta
    ? "bg-gradient-to-r from-violet-600/95 via-fuchsia-600/90 to-pink-600/88 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_12px_36px_-16px_rgba(168,85,247,0.85)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_16px_40px_-14px_rgba(192,132,252,0.75)]"
    : "border border-white/[0.12] bg-white/[0.045] text-white/92 hover:border-white/[0.2] hover:bg-white/[0.08]"

  const groups =
    featureGroups && featureGroups.length > 0
      ? featureGroups
      : [{ heading: "Included", items: features }]

  return (
    <div
      className={`relative rounded-[1.35rem] transition duration-300 ease-out ${
        highlight ? "lg:-my-1" : ""
      } ${frameClass} hover:shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)]`}
    >
      <div
      className={`relative flex h-full flex-col rounded-[1.25rem] border border-white/[0.06] bg-[#0a0d16]/90 px-7 pb-8 pt-9 backdrop-blur-xl transition duration-300 ease-out motion-safe:hover:-translate-y-0.5 ${innerClass}`}
      >
        {topBadge && (
          <div
            className={`absolute -top-px left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border ${badgeClass}`}
          >
            {topBadge}
          </div>
        )}

        {pillBadge ? (
          <div
            className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-[11px] font-medium tracking-wide ${pillClass}`}
          >
            {pillBadge}
          </div>
        ) : (
          <div className="h-[26px]" aria-hidden />
        )}

        <h3 className="mt-4 text-2xl font-semibold tracking-tight text-white sm:text-[1.65rem]">
          {PLAN_HEADLINE[title]}
        </h3>
        {audience ? (
          <p className="mt-1.5 text-xs font-medium uppercase tracking-[0.12em] text-violet-200/75">
            {audience}
          </p>
        ) : null}
        <p className="mt-2.5 text-sm leading-relaxed text-white/58">{subtitle}</p>

        <div className="mt-8 border-t border-white/[0.055] pt-7">
          <div className="flex flex-wrap items-baseline gap-1.5">
            <span className="text-[2.65rem] font-semibold leading-none tabular-nums tracking-tight text-white sm:text-5xl">
              {formatPlanPrice(price)}
            </span>
          </div>
          <p className="mt-2 text-sm text-white/56">
            {billing === "monthly" ? "per month, billed monthly" : "per year, billed annually"}
          </p>
          <p className="mt-3 text-sm font-semibold text-violet-200/90">{creditsLine}</p>
          {creditsExplainer ? (
            <p className="mt-2 text-xs leading-relaxed text-white/48">{creditsExplainer}</p>
          ) : null}
        </div>

        <div className="mt-8 flex flex-1 flex-col gap-6">
          {groups.map((group) => (
            <div key={group.heading}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/46">
                {group.heading}
              </p>
              <ul className="mt-3 space-y-2.5 text-sm leading-snug text-white/78">
                {group.items.map((item) => (
                  <li key={`${group.heading}-${item}`} className="flex gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-violet-400/24 bg-violet-500/[0.09]">
                      <Check className="h-3 w-3 text-violet-200" strokeWidth={2.5} aria-hidden />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3.5 py-2.5 text-[11px] leading-relaxed text-white/52">
          Secure checkout with Stripe. Change or cancel your subscription anytime from Billing.
        </div>

        <button
          type="button"
          onClick={onClick}
          disabled={loading || current}
          className={`np-btn mt-6 flex h-12 w-full text-sm outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0d16] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ${ctaClass}`}
        >
          {current ? "Your current plan" : loading ? "Opening checkout…" : buttonText}
        </button>
      </div>
    </div>
  )
}
