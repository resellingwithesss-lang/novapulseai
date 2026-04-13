import type { BillingStatusChipMeta } from "@/components/billing/types"
import type { UiPlan } from "@/lib/plans"

export function billingStatusChipMeta(status: string): BillingStatusChipMeta {
  switch (status) {
    case "ACTIVE":
      return {
        color: "text-emerald-300",
        bg: "bg-emerald-500/10",
        border: "border-emerald-500/25",
        label: "Active",
      }
    case "TRIALING":
      return {
        color: "text-sky-300",
        bg: "bg-sky-500/10",
        border: "border-sky-500/25",
        label: "Trialing",
      }
    case "PAST_DUE":
      return {
        color: "text-red-300",
        bg: "bg-red-500/10",
        border: "border-red-500/25",
        label: "Past Due",
      }
    case "CANCELED":
      return {
        color: "text-amber-200",
        bg: "bg-amber-500/10",
        border: "border-amber-500/25",
        label: "Canceled",
      }
    case "EXPIRED":
      return {
        color: "text-amber-200/95",
        bg: "bg-amber-500/10",
        border: "border-amber-500/20",
        label: "Expired",
      }
    case "PAUSED":
      return {
        color: "text-white/55",
        bg: "bg-white/[0.06]",
        border: "border-white/12",
        label: "Paused",
      }
    default:
      return {
        color: "text-white/60",
        bg: "bg-white/[0.05]",
        border: "border-white/10",
        label: status,
      }
  }
}

export function formatBillingDate(iso: string | null | undefined) {
  if (!iso) return "—"
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(iso))
  } catch {
    return "—"
  }
}

export function billingPlanTagline(plan: Exclude<UiPlan, "FREE">) {
  switch (plan) {
    case "STARTER":
      return "Clipper + prompt workflows with steady monthly credits."
    case "PRO":
      return "Full creator stack including Story Maker and higher limits."
    case "ELITE":
      return "Maximum credits, Story Video Maker, and scale for teams."
    default:
      return ""
  }
}
