"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { api, ApiError } from "@/lib/api"
import PricingPlanCard, {
  type PricingFeatureGroup,
} from "./_components/PricingPlanCard"
import {
  PLAN_CONFIG as SHARED_PLAN_CONFIG,
  WORKFLOW_LIMITS,
  displayPlanForUser,
  normalizePlan,
  planDisplayName,
} from "@/lib/plans"
import { useAuth } from "@/context/AuthContext"
import {
  writeCheckoutPlanIntent,
  readCheckoutPlanIntent,
  clearCheckoutPlanIntent,
  peekResumeCheckoutFlag,
  clearResumeCheckoutFlag,
} from "@/lib/planIntent"

type BillingType = "monthly" | "yearly"
type UiPlan = "STARTER" | "PRO" | "ELITE"

type Subscription = {
  plan?: "FREE" | "STARTER" | "PRO" | "ELITE"
  subscriptionStatus?:
    | "TRIALING"
    | "ACTIVE"
    | "PAST_DUE"
    | "CANCELED"
    | "EXPIRED"
    | "PAUSED"
}

type PlanConfig = {
  stripePlan: "STARTER" | "PRO" | "ELITE"
  monthly: number
  yearly: number
  credits: string
  subtitle: string
  audience: string
  creditsExplainer: string
  featureGroups: PricingFeatureGroup[]
  buttonText: string
  highlight?: boolean
  topBadge?: string
  pillBadge?: string
  ctaVariant?: "primary" | "secondary"
}

const CREDITS_GUIDE =
  "One credit isn’t one word — it’s one billed run. Scripts, clips, and video jobs consume credits based on length and tool; heavier outputs use more. Your balance and ledger match Billing & Settings."

const PLAN_DISPLAY_CONFIG: Record<UiPlan, PlanConfig> = {
  STARTER: {
    stripePlan: "STARTER",
    monthly: Math.round(SHARED_PLAN_CONFIG.STARTER.monthlyPriceGbp * 100),
    yearly: 14400,
    credits: `${SHARED_PLAN_CONFIG.STARTER.credits} credits / month`,
    audience: "For solo creators shipping weekly",
    subtitle:
      "Ship clips and sharpened prompts faster — without stitching tools together in five tabs.",
    creditsExplainer:
      "Enough runway for steady Clipper + Prompt runs each month. Upgrade when you add scripts or Story Maker.",
    featureGroups: [
      {
        heading: "Automation",
        items: [
          "Clipper Engine — repurpose long-form into short-form",
          "Prompt Intelligence — research-backed prompt packs",
        ],
      },
      {
        heading: "Studio limits",
        items: [
          `Up to ${WORKFLOW_LIMITS.STARTER.workspaces} workspaces`,
          `${WORKFLOW_LIMITS.STARTER.brandVoices} brand voices · ${WORKFLOW_LIMITS.STARTER.contentPacks} content packs`,
        ],
      },
      {
        heading: "Account",
        items: ["Self-serve Billing · usage visibility", "Same credit rules as Pro & Elite"],
      },
    ],
    buttonText: "Get Starter",
    ctaVariant: "secondary",
  },
  PRO: {
    stripePlan: "PRO",
    monthly: Math.round(SHARED_PLAN_CONFIG.PRO.monthlyPriceGbp * 100),
    yearly: 28800,
    credits: `${SHARED_PLAN_CONFIG.PRO.credits.toLocaleString()} credits / month`,
    audience: "For creators scaling scripts & stories",
    subtitle:
      "Add long-form scripts and Story Maker to your stack — the sweet spot before you need Story Video Maker at Elite scale.",
    creditsExplainer:
      "High monthly credits for script + story loops alongside Clipper and Prompt. Same entitlement engine as Billing.",
    featureGroups: [
      {
        heading: "Everything in Starter, plus",
        items: [
          "Video Script Engine — structured scripts from your brief",
          "Story Maker — narrative arcs and beats for serial content",
        ],
      },
      {
        heading: "Studio limits",
        items: [
          `Up to ${WORKFLOW_LIMITS.PRO.workspaces} workspaces`,
          `${WORKFLOW_LIMITS.PRO.brandVoices} brand voices · ${WORKFLOW_LIMITS.PRO.contentPacks} content packs`,
        ],
      },
      {
        heading: "Trial",
        items: [
          `Try Pro free for ${SHARED_PLAN_CONFIG.PRO.trialDays || 3} days via Stripe, then paid Pro unless you cancel`,
        ],
      },
    ],
    buttonText: `Start ${SHARED_PLAN_CONFIG.PRO.trialDays || 3}-day Pro trial`,
    highlight: true,
    topBadge: "Most creators choose Pro",
    pillBadge: `${SHARED_PLAN_CONFIG.PRO.trialDays || 3}-day trial · Stripe`,
    ctaVariant: "primary",
  },
  ELITE: {
    stripePlan: "ELITE",
    monthly: Math.round(SHARED_PLAN_CONFIG.ELITE.monthlyPriceGbp * 100),
    yearly: 48000,
    credits: `${SHARED_PLAN_CONFIG.ELITE.credits.toLocaleString()} credits / month`,
    audience: "For power users & lean teams",
    subtitle:
      "Maximum monthly credits plus Story Video Maker — when you’re running full video workflows, not one-off clips.",
    creditsExplainer:
      "Elite is built for volume: ads-quality video jobs, large packs, and the highest studio caps on the product.",
    featureGroups: [
      {
        heading: "Everything in Pro, plus",
        items: [
          "Story Video Maker — end-to-end video generation track",
          "Top monthly credit pool for sustained campaigns",
        ],
      },
      {
        heading: "Studio limits",
        items: [
          `Up to ${WORKFLOW_LIMITS.ELITE.workspaces} workspaces`,
          `${WORKFLOW_LIMITS.ELITE.brandVoices} brand voices · ${WORKFLOW_LIMITS.ELITE.contentPacks} content packs`,
        ],
      },
      {
        heading: "Why upgrade here",
        items: ["Same secure Stripe checkout as Starter & Pro", "One subscription — all tools unlocked"],
      },
    ],
    buttonText: "Go Elite",
    topBadge: "Best for volume",
    pillBadge: "Full tool access",
    ctaVariant: "secondary",
  },
}

export default function PricingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { refreshUser, user, status } = useAuth()
  const [billing, setBilling] = useState<BillingType>("monthly")
  const [loadingPlan, setLoadingPlan] = useState<UiPlan | null>(null)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [loadingSub, setLoadingSub] = useState(true)
  const [pageNotice, setPageNotice] = useState<{
    text: string
    tone: "success" | "neutral"
  } | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const resumeAttempted = useRef(false)

  useEffect(() => {
    let alive = true

    ;(async () => {
      try {
        const data = await api.get<{
          subscription?: Subscription
        }>("/billing/subscription", {
          cache: "no-store",
          silent: true,
        })

        if (!alive) return

        if (data?.subscription) {
          setSubscription(data.subscription)
        }
      } catch {
        // ignore subscription fetch failure
      } finally {
        if (alive) {
          setLoadingSub(false)
        }
      }
    })()

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const success = searchParams.get("success")
    const canceled = searchParams.get("canceled")
    if (success !== "true" && canceled !== "true") return

    if (success === "true") {
      setPageNotice({
        text: "Checkout complete. Syncing your updated plan...",
        tone: "success",
      })
    } else {
      setPageNotice({
        text: "Checkout canceled. Your current plan remains unchanged.",
        tone: "neutral",
      })
    }

    const sync = async () => {
      await refreshUser({ silent: true })
      try {
        const data = await api.get<{ subscription?: Subscription }>("/billing/subscription", {
          cache: "no-store",
          silent: true,
        })
        setSubscription(data?.subscription ?? null)
      } catch {
        // Keep notice visible; subscription panel will retain prior state.
      }
    }

    void sync()
  }, [searchParams, refreshUser])

  const startCheckout = useCallback(
    async (
      plan: UiPlan,
      billingOverride?: BillingType
    ): Promise<boolean> => {
      const selectedBilling = billingOverride ?? billing

      if (status === "loading") {
        setCheckoutError("Verifying your session… try again in a moment.")
        return false
      }

      if (!user) {
        writeCheckoutPlanIntent({ plan, billing: selectedBilling })
        router.push(
          `/register?plan=${encodeURIComponent(plan)}&billing=${encodeURIComponent(selectedBilling)}`
        )
        return false
      }

      try {
        setLoadingPlan(plan)
        setCheckoutError(null)

        const config = PLAN_DISPLAY_CONFIG[plan]
        const isActive =
          subscription?.subscriptionStatus === "ACTIVE" ||
          subscription?.subscriptionStatus === "TRIALING"
        const endpoint = isActive
          ? "/billing/change-plan"
          : "/billing/checkout"

        const data = await api.post<{
          url?: string
        }>(endpoint, {
          plan: config.stripePlan,
          billing: selectedBilling,
        })

        if (data?.url) {
          clearCheckoutPlanIntent()
          window.location.href = data.url
          return true
        }

        clearCheckoutPlanIntent()
        window.location.href = "/dashboard/billing"
        return true
      } catch (error: unknown) {
        const msg =
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Something went wrong."
        setCheckoutError(msg)
        return false
      } finally {
        setLoadingPlan(null)
      }
    },
    [billing, router, status, subscription, user]
  )

  useEffect(() => {
    if (resumeAttempted.current) return
    if (!peekResumeCheckoutFlag()) return
    if (status !== "authenticated" || !user) return

    const intent = readCheckoutPlanIntent()
    if (!intent) {
      clearResumeCheckoutFlag()
      return
    }

    resumeAttempted.current = true
    clearResumeCheckoutFlag()
    setBilling(intent.billing)

    void (async () => {
      const left = await startCheckout(intent.plan, intent.billing)
      if (!left) {
        resumeAttempted.current = false
      }
    })()
  }, [user, status, startCheckout])

  const pricingTierLabel = useMemo(() => {
    if (status === "authenticated" && user) {
      return displayPlanForUser(subscription?.plan ?? user.plan, user.role)
    }
    if (subscription?.plan) return normalizePlan(subscription.plan)
    return null
  }, [status, user, subscription?.plan])

  function isCurrentPlan(plan: UiPlan): boolean {
    if (!pricingTierLabel) return false
    return (
      pricingTierLabel === normalizePlan(PLAN_DISPLAY_CONFIG[plan].stripePlan)
    )
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[#0b0f19]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_60%_at_50%_-10%,rgba(124,58,237,0.22),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_25%,rgba(139,92,246,0.18),transparent_45%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_88%_30%,rgba(236,72,153,0.12),transparent_42%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,rgba(0,0,0,0.35)_100%)]" />
      </div>

      <section className="mx-auto max-w-7xl px-6 pb-32 pt-20 sm:pt-28 lg:pt-32">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/38">
            Pricing
          </p>
          <h1 className="mt-3 text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-[3.35rem]">
            <span className="text-white/95">Simple plans. </span>
            <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-pink-400 bg-clip-text text-transparent">
              Serious output.
            </span>
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-white/52 sm:mt-5 sm:text-lg">
            Credits power every run — scripts, clips, and video workflows. Start free, graduate to
            Starter for automation, <span className="text-white/72">choose Pro when you need scripts + Story Maker</span>, or Elite when you’re
            driving Story Video Maker at scale.
          </p>

          <div className="mt-7 flex justify-center sm:mt-9">
            <div
              className="inline-flex rounded-full border border-white/[0.08] bg-black/35 p-1 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] backdrop-blur-md"
              role="group"
              aria-label="Billing period"
            >
              {(["monthly", "yearly"] as BillingType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setBilling(type)}
                  className={`min-w-[7.5rem] rounded-full px-6 py-2.5 text-sm font-medium transition ${
                    billing === type
                      ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-md shadow-violet-950/40"
                      : "text-white/50 hover:text-white/85"
                  }`}
                >
                  {type === "monthly" ? "Monthly" : "Yearly"}
                </button>
              ))}
            </div>
          </div>

          {!loadingSub && pricingTierLabel && (
            <p className="mt-5 text-sm text-white/38">
              Current plan ·{" "}
              <span className="text-white/55">{planDisplayName(pricingTierLabel)}</span>
            </p>
          )}
          {pageNotice && (
            <p
              className={`mt-3 text-sm ${
                pageNotice.tone === "success" ? "text-emerald-300/95" : "text-amber-200/90"
              }`}
            >
              {pageNotice.text}
            </p>
          )}
          {checkoutError && <p className="mt-3 text-sm text-red-300/95">{checkoutError}</p>}
          <p className="mx-auto mt-4 max-w-2xl text-xs leading-relaxed text-white/38">
            Free includes {SHARED_PLAN_CONFIG.FREE.credits} credits and Video Script only. Paid plans bill
            securely through Stripe; cancel or change anytime from Billing. Pro includes a one-time{" "}
            {SHARED_PLAN_CONFIG.PRO.trialDays || 3}-day trial, then continues as paid Pro unless you
            cancel during the trial.
          </p>
        </div>

        <div className="mx-auto mt-14 max-w-3xl rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-center sm:px-6 sm:text-left">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-200/75">
            How credits work
          </p>
          <p className="mt-2 text-sm leading-relaxed text-white/50">{CREDITS_GUIDE}</p>
        </div>

        <div className="mx-auto mt-12 max-w-3xl">
          <div className="rounded-[1.25rem] bg-gradient-to-b from-cyan-400/22 via-sky-500/12 to-transparent p-px shadow-[0_20px_50px_-24px_rgba(34,211,238,0.2)]">
            <div className="flex flex-col gap-5 rounded-[1.2rem] border border-white/[0.07] bg-[#0b0f19]/88 px-6 py-6 backdrop-blur-xl transition motion-safe:hover:border-cyan-400/20 sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:px-8 sm:py-7">
              <div className="text-center sm:text-left">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200/85">
                  Free
                </p>
                <p className="mt-2 text-sm leading-relaxed text-white/58">
                  {SHARED_PLAN_CONFIG.FREE.credits} credits to prove value · Video Script Engine · No
                  card · Same upgrade path as paid tiers
                </p>
              </div>
              <a
                href="/register"
                className="inline-flex shrink-0 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-500/[0.12] px-6 py-2.5 text-sm font-semibold text-cyan-50 transition hover:border-cyan-300/55 hover:bg-cyan-500/[0.2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
              >
                Start free
              </a>
            </div>
          </div>
        </div>

        <div className="mt-14 grid items-end gap-8 md:grid-cols-3 md:gap-6 lg:gap-7">
          {(Object.keys(PLAN_DISPLAY_CONFIG) as UiPlan[]).map((plan) => {
            const config = PLAN_DISPLAY_CONFIG[plan]
            const price =
              billing === "monthly" ? config.monthly : config.yearly

            return (
              <PricingPlanCard
                key={plan}
                title={plan}
                subtitle={config.subtitle}
                audience={config.audience}
                price={price}
                billing={billing}
                creditsLine={config.credits}
                creditsExplainer={config.creditsExplainer}
                featureGroups={config.featureGroups}
                buttonText={config.buttonText}
                highlight={config.highlight}
                topBadge={config.topBadge}
                pillBadge={config.pillBadge}
                ctaVariant={config.ctaVariant}
                loading={loadingPlan === plan}
                current={isCurrentPlan(plan)}
                onClick={() => startCheckout(plan)}
              />
            )
          })}
        </div>

        <div className="mx-auto mt-16 max-w-4xl border-t border-white/[0.07] pt-12">
          <div className="grid gap-6 text-center sm:grid-cols-3 sm:text-left">
            <div>
              <p className="text-sm font-medium text-white/80">Secure billing</p>
              <p className="mt-1 text-xs leading-relaxed text-white/45">
                Card details stay with Stripe — we never store your full card number.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-white/80">Self-serve changes</p>
              <p className="mt-1 text-xs leading-relaxed text-white/45">
                Upgrade, downgrade, or open invoices from Billing whenever you need.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-white/80">Aligned with the app</p>
              <p className="mt-1 text-xs leading-relaxed text-white/45">
                Credits, plan names, and limits match Billing & Settings — one source of truth.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
