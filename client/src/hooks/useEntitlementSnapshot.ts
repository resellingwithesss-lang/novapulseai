"use client"

import { useCallback, useEffect, useState } from "react"
import { api, ApiError } from "@/lib/api"
import { planDisplayName } from "@/lib/plans"

export type EntitlementBlockedReason =
  | "ACCOUNT_SUSPENDED"
  | "SUBSCRIPTION_INACTIVE"
  | "TRIAL_EXPIRED"
  | "INSUFFICIENT_CREDITS"
  | "PLAN_UPGRADE_REQUIRED"
  | "ADMIN_REQUIRED"

export type UiMinimumPlan = "FREE" | "STARTER" | "PRO" | "ELITE"

export type FeatureAccessDecision = {
  allowed: boolean
  blockedReason: EntitlementBlockedReason | null
  minimumPlan: UiMinimumPlan | null
  upgradeRequired: boolean
}

export type EntitlementSnapshot = {
  plan: string
  normalizedPlan: UiMinimumPlan
  subscriptionStatus: string
  isTrialActive: boolean
  trialExpiresAt: string | null
  isPaid: boolean
  isUnlimited: boolean
  creditsRemaining: number
  blockedReason: EntitlementBlockedReason | null
  upgradeRequired: boolean
  minimumPlan: UiMinimumPlan | null
  workflowLimits?: {
    maxWorkspaces: number
    maxBrandVoices: number
    maxContentPacks: number
  }
  scriptVariantCount: number
  adVariantCount: number
  clipVariantCount: number
  improveActionsLimit: number
  featureAccess: {
    generation: FeatureAccessDecision
    prompt: FeatureAccessDecision
    storyMaker: FeatureAccessDecision
    clip: FeatureAccessDecision
    ads: FeatureAccessDecision
    admin: FeatureAccessDecision
  }
}

type EntitlementResponse = {
  success?: boolean
  entitlement?: EntitlementSnapshot
}

export function useEntitlementSnapshot() {
  const [entitlement, setEntitlement] = useState<EntitlementSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<EntitlementResponse>("/billing/entitlement", {
        cache: "no-store",
        silent: true,
      })
      setEntitlement(data?.entitlement ?? null)
    } catch (err) {
      const apiErr = err as ApiError
      if (apiErr?.status === 401) {
        setEntitlement(null)
      } else {
        setError(apiErr?.message ?? "Failed to load entitlement")
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    entitlement,
    loading,
    error,
    refresh,
  }
}

export function formatBlockedReason(
  blockedReason: EntitlementBlockedReason | null,
  minimumPlan?: UiMinimumPlan | null
): string | null {
  if (!blockedReason) return null
  switch (blockedReason) {
    case "ACCOUNT_SUSPENDED":
      return "Account suspended"
    case "SUBSCRIPTION_INACTIVE":
      return "Subscribe or update billing to unlock paid tools"
    case "TRIAL_EXPIRED":
      return "Trial expired — choose a plan to continue"
    case "INSUFFICIENT_CREDITS":
      return "No credits remaining"
    case "PLAN_UPGRADE_REQUIRED":
      return minimumPlan
        ? `Upgrade to ${planDisplayName(minimumPlan)} to unlock this tool`
        : "This tool is not on your current plan"
    case "ADMIN_REQUIRED":
      return "Admin access required"
    default:
      return "Access blocked"
  }
}
