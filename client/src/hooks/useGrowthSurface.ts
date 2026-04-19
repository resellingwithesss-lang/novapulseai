"use client"

import { useMemo } from "react"
import { useAuth } from "@/context/AuthContext"
import { displayPlanForUser, getPlanCredits, type UiPlan } from "@/lib/plans"
import { useEntitlementSnapshot } from "@/hooks/useEntitlementSnapshot"

export type GrowthBanner = {
  message: string
  href: string
  cta: string
  tone: "info" | "warning" | "success"
}

export type GrowthNudge = {
  id: string
  message: string
  href?: string
  cta?: string
}

export type GrowthUpgradePrompt = {
  id: string
  message: string
  requiredPlan?: UiPlan
  href: string
  cta: string
}

type GrowthSurfaceInput = {
  /** 0–1 fraction of credits *remaining* vs plan monthly allocation (optional override) */
  usagePercent?: number
  lastActiveAt?: string | Date | null
}

/**
 * Centralized monetization / retention surfaces (dashboard, tools, billing).
 * Respects entitlement snapshot when loaded; falls back to auth user for plan/credits.
 */
export function useGrowthSurface(overrides?: GrowthSurfaceInput) {
  const { user } = useAuth()
  const { entitlement, loading } = useEntitlementSnapshot()

  const plan = (entitlement?.normalizedPlan ??
    (user ? displayPlanForUser(user.plan, user.role) : "FREE")) as UiPlan
  const creditsRemaining = entitlement?.creditsRemaining ?? user?.credits ?? 0

  const cap = getPlanCredits(plan)
  const usagePct =
    overrides?.usagePercent ??
    (cap > 0 ? Math.min(1, Math.max(0, creditsRemaining / cap)) : 1)

  const lastActive =
    overrides?.lastActiveAt ?? user?.lastActiveAt ?? null
  const lastActiveMs = lastActive ? new Date(lastActive).getTime() : 0
  const inactiveWindowMs = 14 * 24 * 60 * 60 * 1000
  const looksInactive =
    Boolean(lastActiveMs) && Date.now() - lastActiveMs > inactiveWindowMs

  const banner = useMemo((): GrowthBanner | null => {
    if (!user || loading) return null

    if (plan === "PRO" && entitlement && !entitlement.featureAccess.ads.allowed) {
      return {
        message:
          "Unlock better ads with Elite — AI video ads from any product URL, scored variants, no filming.",
        href: "/dashboard/billing",
        cta: "View Elite",
        tone: "info",
      }
    }

    if (plan !== "FREE" && cap > 0 && usagePct <= 0.2) {
      return {
        message:
          "You're close to your limit. Upgrade or pace high-cost runs so campaigns don't stall.",
        href: "/dashboard/billing",
        cta: "Billing & plans",
        tone: "warning",
      }
    }

    if (plan === "FREE" && creditsRemaining <= 2) {
      return {
        message:
          "Free credits are almost gone — Starter unlocks Clipper, Prompt Intelligence, and a real monthly credit pool.",
        href: "/pricing",
        cta: "See Starter",
        tone: "warning",
      }
    }

    if (looksInactive) {
      return {
        message:
          "Create high-performing ads without recording yourself — paste a product link and go.",
        href: "/dashboard/tools/ai-ad-generator",
        cta: "Open AI Ad Generator",
        tone: "success",
      }
    }

    return null
  }, [user, loading, plan, cap, usagePct, creditsRemaining, looksInactive, entitlement])

  const nudges = useMemo((): GrowthNudge[] => {
    const out: GrowthNudge[] = []
    if (entitlement && plan === "STARTER" && entitlement.clipVariantCount <= 6) {
      out.push({
        id: "clip-cap-pro",
        message:
          "Pro raises your clip batch limit and unlocks Story Maker — better for volume testing.",
        href: "/dashboard/billing",
        cta: "Compare Pro",
      })
    }
    return out
  }, [entitlement, plan])

  const upgradePrompts = useMemo((): GrowthUpgradePrompt[] => {
    const prompts: GrowthUpgradePrompt[] = []
    if (plan === "FREE") {
      prompts.push({
        id: "free-to-starter",
        message: "More variants → better performance → higher ROI. Starter adds Clipper + Prompt.",
        requiredPlan: "STARTER",
        href: "/pricing",
        cta: "See plans",
      })
    }
    if (plan === "STARTER" || plan === "PRO") {
      prompts.push({
        id: "elite-ads",
        message: "Unlock more high-performing variants with Elite — full AI Ad Generator pipeline.",
        requiredPlan: "ELITE",
        href: "/dashboard/billing",
        cta: "View Elite",
      })
    }
    return prompts
  }, [plan])

  return {
    loading,
    plan,
    creditsRemaining,
    usagePercent: usagePct,
    banner,
    nudges,
    upgradePrompts,
  }
}
