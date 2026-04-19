"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { BillingBanners } from "@/components/billing/BillingBanners"
import { BillingCreditsCard } from "@/components/billing/BillingCreditsCard"
import type { BillingFeatureRow } from "@/components/billing/BillingFeatureAccess"
import { BillingFeatureAccess } from "@/components/billing/BillingFeatureAccess"
import { BillingInvoicesSection } from "@/components/billing/BillingInvoicesSection"
import { BillingPageLoadError } from "@/components/billing/BillingPageLoadError"
import { BillingPageSkeleton } from "@/components/billing/BillingPageSkeleton"
import { BillingPaymentPortalCard } from "@/components/billing/BillingPaymentPortalCard"
import { BillingPlanCard } from "@/components/billing/BillingPlanCard"
import { BillingPlansSection } from "@/components/billing/BillingPlansSection"
import BillingMarketingCard from "@/components/marketing/BillingMarketingCard"
import type { BillingInvoiceRow, BillingSubscription } from "@/components/billing/types"
import DashboardShell from "@/components/dashboard/DashboardShell"
import { useAuth } from "@/context/AuthContext"
import { formatBlockedReason, useEntitlementSnapshot } from "@/hooks/useEntitlementSnapshot"
import { useGrowthSurface } from "@/hooks/useGrowthSurface"
import Link from "next/link"
import { api, ApiError } from "@/lib/api"
import { formatBillingCheckoutError } from "@/lib/billing-user-messages"
import {
  displayPlanForUser,
  getPlanCredits,
  isPaidPlan,
  isUpgradeToPlan,
  planDisplayName,
  type BillingInterval,
  type UiPlan,
} from "@/lib/plans"

export default function BillingPage() {
  const searchParams = useSearchParams()
  const { user, refreshUser } = useAuth()
  const { entitlement, refresh: refreshEntitlement } = useEntitlementSnapshot()
  const { banner: growthBanner, loading: growthLoading } = useGrowthSurface()
  const [subscription, setSubscription] = useState<BillingSubscription | null>(null)
  const [invoices, setInvoices] = useState<BillingInvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [portalError, setPortalError] = useState<string | null>(null)
  const [planActionLoading, setPlanActionLoading] = useState<string | null>(null)
  const [planActionError, setPlanActionError] = useState<string | null>(null)
  const [planNotice, setPlanNotice] = useState<string | null>(null)
  const [billing, setBilling] = useState<BillingInterval>("monthly")

  const loadBilling = useCallback(async (isMounted?: () => boolean) => {
    if (isMounted && !isMounted()) return
    try {
      if (!isMounted || isMounted()) {
        setLoading(true)
        setError(null)
      }
      const [subData, invData] = await Promise.all([
        api.get<{ subscription?: BillingSubscription }>("/billing/subscription"),
        api.get<{ invoices?: BillingInvoiceRow[] }>("/billing/invoices"),
      ])

      if (!isMounted || isMounted()) {
        setSubscription(subData?.subscription ?? null)
        setInvoices(invData?.invoices ?? [])
      }
    } catch (err) {
      console.error("Billing load error:", err)
      if (!isMounted || isMounted()) {
        setError(
          err instanceof ApiError
            ? err.message
            : "We could not load billing. Check your connection and try again."
        )
      }
    } finally {
      if (!isMounted || isMounted()) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    let mounted = true
    const isMounted = () => mounted
    void loadBilling(isMounted)
    return () => {
      mounted = false
    }
  }, [loadBilling])

  useEffect(() => {
    const success = searchParams.get("success")
    const canceled = searchParams.get("canceled")

    if (success !== "true" && canceled !== "true") return

    void refreshUser({ silent: true })
    const timer = window.setTimeout(() => {
      void loadBilling()
      void refreshEntitlement()
    }, 1200)

    return () => {
      window.clearTimeout(timer)
    }
  }, [searchParams, refreshUser, loadBilling, refreshEntitlement])

  const checkoutBanner = useMemo(() => {
    const success = searchParams.get("success") === "true"
    const canceled = searchParams.get("canceled") === "true"
    return { success, canceled }
  }, [searchParams])

  const openPortal = async () => {
    try {
      setPortalError(null)
      const data = await api.post<{ url?: string }>("/billing/portal")
      if (data?.url) {
        window.location.href = data.url
      } else {
        setPortalError("Stripe did not return a portal link. Try again.")
      }
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : "Could not open the billing portal."
      setPortalError(msg)
    }
  }

  const startPlanChange = async (
    plan: "STARTER" | "PRO" | "ELITE",
    billingType: BillingInterval
  ) => {
    try {
      setPlanActionLoading(plan)
      setPlanActionError(null)
      setPlanNotice(null)
      const endpoint =
        subscription?.subscriptionStatus === "ACTIVE" ||
        subscription?.subscriptionStatus === "TRIALING"
          ? "/billing/change-plan"
          : "/billing/checkout"
      const data = await api.post<{
        url?: string
        type?: string
        effectiveAt?: string
        targetPlan?: string
      }>(endpoint, {
        plan,
        billing: billingType,
      })
      if (data?.url) {
        window.location.href = data.url
        return
      }
      if (data?.type === "scheduled_downgrade") {
        const when = data.effectiveAt
          ? new Date(data.effectiveAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : "the end of your billing period"
        setPlanNotice(
          `Downgrade scheduled — you keep your current access until ${when}.`
        )
        await loadBilling()
        await refreshEntitlement()
        await refreshUser({ silent: true })
        return
      }
      if (data?.type === "updated" || data?.type === "no_change") {
        setPlanActionError(null)
        setPlanNotice(
          data.type === "updated"
            ? "Your subscription was updated in Stripe."
            : "You’re already on this plan in Stripe."
        )
        await loadBilling()
        await refreshEntitlement()
        await refreshUser({ silent: true })
        return
      }
      await loadBilling()
      await refreshEntitlement()
      await refreshUser({ silent: true })
    } catch (error: unknown) {
      setPlanActionError(formatBillingCheckoutError(error))
    } finally {
      setPlanActionLoading(null)
    }
  }

  const normalizedPlan: UiPlan = displayPlanForUser(
    user?.plan ?? subscription?.plan ?? undefined,
    user?.role
  )
  const planLimit = getPlanCredits(normalizedPlan)

  const daysUntilPeriodEnd = useMemo(() => {
    if (!subscription?.subscriptionEndsAt) return null
    const diff = new Date(subscription.subscriptionEndsAt).getTime() - Date.now()
    if (diff <= 0) return 0
    return Math.ceil(diff / 86400000)
  }, [subscription])

  const trialDaysLeft =
    subscription?.subscriptionStatus === "TRIALING" &&
    subscription.trialExpiresAt &&
    normalizedPlan === "PRO"
      ? Math.max(
          0,
          Math.ceil(
            (new Date(subscription.trialExpiresAt).getTime() - Date.now()) / 86400000
          )
        )
      : null

  const needsPaidRecovery = Boolean(
    subscription &&
      isPaidPlan(subscription.plan) &&
      (subscription.subscriptionStatus === "PAST_DUE" ||
        subscription.subscriptionStatus === "CANCELED" ||
        subscription.subscriptionStatus === "EXPIRED" ||
        subscription.subscriptionStatus === "PAUSED")
  )

  const showStarterCta = Boolean(
    subscription &&
      (isUpgradeToPlan(subscription.plan, "STARTER") ||
        (needsPaidRecovery && normalizedPlan === "STARTER"))
  )
  const showProCta = Boolean(
    subscription &&
      (isUpgradeToPlan(subscription.plan, "PRO") || (needsPaidRecovery && normalizedPlan === "PRO"))
  )
  const showEliteCta = Boolean(
    subscription &&
      (isUpgradeToPlan(subscription.plan, "ELITE") ||
        (needsPaidRecovery && normalizedPlan === "ELITE"))
  )
  const showAnyPlanCta = showStarterCta || showProCta || showEliteCta

  const hasStripeCustomer = subscription?.hasStripeCustomer === true

  const featureRows: BillingFeatureRow[] = entitlement
    ? [
        {
          name: "Script generation",
          allowed: entitlement.featureAccess.generation.allowed,
          reason: formatBlockedReason(
            entitlement.featureAccess.generation.blockedReason,
            entitlement.featureAccess.generation.minimumPlan
          ),
          unlock: planDisplayName(
            entitlement.featureAccess.generation.minimumPlan ?? "PRO"
          ),
        },
        {
          name: "Story Maker",
          allowed: entitlement.featureAccess.storyMaker.allowed,
          reason: formatBlockedReason(
            entitlement.featureAccess.storyMaker.blockedReason,
            entitlement.featureAccess.storyMaker.minimumPlan
          ),
          unlock: planDisplayName(
            entitlement.featureAccess.storyMaker.minimumPlan ?? "PRO"
          ),
        },
        {
          name: "Clipper engine",
          allowed: entitlement.featureAccess.clip.allowed,
          reason: formatBlockedReason(
            entitlement.featureAccess.clip.blockedReason,
            entitlement.featureAccess.clip.minimumPlan
          ),
          unlock: planDisplayName(
            entitlement.featureAccess.clip.minimumPlan ?? "STARTER"
          ),
        },
        {
          name: "Story Video Maker",
          allowed: entitlement.featureAccess.ads.allowed,
          reason: formatBlockedReason(
            entitlement.featureAccess.ads.blockedReason,
            entitlement.featureAccess.ads.minimumPlan
          ),
          unlock: planDisplayName(
            entitlement.featureAccess.ads.minimumPlan ?? "ELITE"
          ),
        },
      ]
    : []

  if (loading) {
    return <BillingPageSkeleton />
  }

  if (error || !subscription) {
    return (
      <BillingPageLoadError
        message={error ?? "Billing data is unavailable."}
        onRetry={() => void loadBilling()}
      />
    )
  }

  return (
    <DashboardShell showCommandHero={false} contentWidth="readable">
      <div className="space-y-10 pb-20">
        <BillingBanners
          checkoutSuccess={checkoutBanner.success}
          checkoutCanceled={checkoutBanner.canceled}
          subscription={subscription}
          normalizedPlan={normalizedPlan}
          trialDaysLeft={trialDaysLeft}
          needsPaidRecovery={needsPaidRecovery}
          hasStripeCustomer={hasStripeCustomer}
          onOpenPortal={() => void openPortal()}
        />

        {!growthLoading && growthBanner ? (
          <div className="rounded-2xl border border-purple-500/25 bg-gradient-to-r from-purple-600/[0.18] to-pink-600/[0.12] px-5 py-4 text-sm text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-2xl leading-relaxed">{growthBanner.message}</p>
              <Link
                href={growthBanner.href}
                className="shrink-0 rounded-full bg-white/15 px-4 py-2 text-xs font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/25"
              >
                {growthBanner.cta}
              </Link>
            </div>
          </div>
        ) : null}

        <header className="border-b border-white/[0.07] pb-8">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-white md:text-3xl md:leading-tight">
            Billing & plan
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/48 md:text-[0.9375rem]">
            One place for your subscription, credits, invoices, and Stripe billing details. Charges
            are processed securely by Stripe — NovaPulseAI never stores your card number. The plan
            shown here matches what the app uses for access and credits.
          </p>
        </header>

        <div className="grid gap-5 lg:grid-cols-2">
          <BillingPlanCard
            subscription={subscription}
            normalizedPlan={normalizedPlan}
            memberSince={subscription.subscriptionStartedAt ?? user?.createdAt}
            daysUntilPeriodEnd={daysUntilPeriodEnd}
            needsPaidRecovery={needsPaidRecovery}
          />
          <BillingCreditsCard
            creditsAvailable={user?.credits}
            planLimit={planLimit}
            normalizedPlan={normalizedPlan}
          />
        </div>

        <BillingPaymentPortalCard
          hasStripeCustomer={hasStripeCustomer}
          portalError={portalError}
          onOpenPortal={openPortal}
        />

        <BillingFeatureAccess rows={featureRows} />

        {planNotice ? (
          <p className="text-sm text-emerald-300/95" role="status">
            {planNotice}
          </p>
        ) : null}

        <BillingMarketingCard />

        <BillingPlansSection
          normalizedPlan={normalizedPlan}
          billing={billing}
          onBillingChange={setBilling}
          showStarterCta={showStarterCta}
          showProCta={showProCta}
          showEliteCta={showEliteCta}
          showAnyPlanCta={showAnyPlanCta}
          needsPaidRecovery={needsPaidRecovery}
          planActionLoading={planActionLoading}
          planActionError={planActionError}
          onPlanChange={startPlanChange}
        />

        <BillingInvoicesSection invoices={invoices} hasStripeCustomer={hasStripeCustomer} />
      </div>
    </DashboardShell>
  )
}
