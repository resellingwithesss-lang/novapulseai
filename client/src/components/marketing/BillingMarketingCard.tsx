"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { useMarketingConsent } from "@/hooks/useMarketingConsent"
import { BILLING_CARD_COPY } from "./consentCopy"

const DISMISS_COOLDOWN_DAYS = 14

function shouldShow(params: {
  status: string | undefined
  dismissedAt: string | null | undefined
  now: number
}): boolean {
  if (!params.status) return false
  if (params.status === "OPTED_IN" || params.status === "OPTED_OUT") return false
  if (params.status === "DISMISSED" && params.dismissedAt) {
    const elapsed = params.now - new Date(params.dismissedAt).getTime()
    return elapsed >= DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
  }
  return true
}

/**
 * Billing-page consent card. Intentionally reuses the same consent primitives
 * as the dashboard banner but leads with the "member-only offers" angle,
 * which converts best at upgrade-intent moments (Stripe redirect return,
 * billing page views, past-due recovery flow).
 */
export default function BillingMarketingCard() {
  const { user } = useAuth()
  const { optIn, dismiss, saving, error } = useMarketingConsent({ eager: false })
  const [outcome, setOutcome] = useState<null | "opted_in" | "dismissed">(null)

  const visible = useMemo(
    () =>
      shouldShow({
        status: user?.marketingConsentStatus,
        dismissedAt: user?.marketingDismissedAt,
        now: Date.now(),
      }),
    [user?.marketingConsentStatus, user?.marketingDismissedAt]
  )

  if (!user) return null
  if (!visible && !outcome) return null

  if (outcome === "opted_in") {
    return (
      <section
        role="status"
        aria-live="polite"
        className="rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.07] p-5"
      >
        <p className="text-sm font-semibold text-white/92">
          {BILLING_CARD_COPY.successTitle}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-white/62">
          {BILLING_CARD_COPY.successBody}
        </p>
      </section>
    )
  }

  const handle = async (action: "opt_in" | "dismiss") => {
    try {
      if (action === "opt_in") {
        await optIn("billing_card")
        setOutcome("opted_in")
      } else {
        await dismiss("billing_card")
        setOutcome("dismissed")
      }
    } catch {
      // Error exposed by hook
    }
  }

  return (
    <section
      aria-labelledby="billing-marketing-title"
      className="relative overflow-hidden rounded-2xl border border-purple-400/22 bg-gradient-to-br from-purple-500/[0.09] via-indigo-500/[0.05] to-transparent p-5"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-12 -bottom-16 h-40 w-40 rounded-full bg-indigo-500/12 blur-3xl"
      />
      <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-purple-200/85">
            {BILLING_CARD_COPY.eyebrow}
          </p>
          <h3
            id="billing-marketing-title"
            className="mt-2 text-[1.0625rem] font-semibold leading-tight text-white"
          >
            {BILLING_CARD_COPY.title}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-white/62">
            {BILLING_CARD_COPY.body}{" "}
            <Link
              href="/dashboard/settings/preferences#settings-marketing"
              className="text-purple-200/90 underline-offset-4 hover:underline"
            >
              Preference controls
            </Link>
            .
          </p>
          {error ? (
            <p role="alert" className="mt-3 text-xs text-rose-300/95">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handle("opt_in")}
            className="np-btn np-btn-primary inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_20px_-12px_rgba(139,92,246,0.7)] transition hover:brightness-[1.08] disabled:cursor-wait disabled:opacity-70"
          >
            {saving ? "Saving…" : BILLING_CARD_COPY.optInCta}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handle("dismiss")}
            className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/[0.03] px-3 py-2 text-sm font-medium text-white/70 transition hover:border-white/20 hover:text-white disabled:opacity-60"
          >
            {BILLING_CARD_COPY.dismissCta}
          </button>
        </div>
      </div>
    </section>
  )
}
