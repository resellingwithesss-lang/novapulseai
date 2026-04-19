"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { useMarketingConsent } from "@/hooks/useMarketingConsent"
import { DASHBOARD_BANNER_COPY } from "./consentCopy"

const DISMISS_COOLDOWN_DAYS = 14

function shouldShow(params: {
  status: string | undefined
  dismissedAt: string | null | undefined
  now: number
}): boolean {
  const { status, dismissedAt, now } = params
  if (!status) return false
  if (status === "OPTED_IN" || status === "OPTED_OUT") return false

  if (status === "DISMISSED" && dismissedAt) {
    const elapsed = now - new Date(dismissedAt).getTime()
    const cooldown = DISMISS_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
    return elapsed >= cooldown
  }

  // UNKNOWN and LEGACY_OPT_IN both prompt. Legacy users get the "make your
  // preference explicit" nudge so we have a clean audit trail on them too.
  return true
}

/**
 * Dashboard-level consent banner. Only renders when the user hasn't yet
 * given an explicit answer (or the dismissal has aged out of the cooldown).
 * Triple-action layout: accept / temporarily dismiss / decline. Never blocks
 * the user; always dismissible.
 */
export default function ConsentBannerCard() {
  const { user } = useAuth()
  const { optIn, optOut, dismiss, saving, error } = useMarketingConsent({
    eager: false,
  })
  const [outcome, setOutcome] = useState<null | "opted_in" | "opted_out">(null)

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
      <SuccessState
        title={DASHBOARD_BANNER_COPY.successTitle}
        body={DASHBOARD_BANNER_COPY.successBody}
        tone="positive"
      />
    )
  }

  if (outcome === "opted_out") {
    return (
      <SuccessState
        title={DASHBOARD_BANNER_COPY.declineTitle}
        body={DASHBOARD_BANNER_COPY.declineBody}
        tone="neutral"
      />
    )
  }

  const handle = async (action: "opt_in" | "opt_out" | "dismiss") => {
    try {
      if (action === "opt_in") {
        await optIn("dashboard_banner")
        setOutcome("opted_in")
      } else if (action === "opt_out") {
        await optOut("dashboard_banner")
        setOutcome("opted_out")
      } else {
        await dismiss("dashboard_banner")
      }
    } catch {
      // Error is surfaced via the hook; banner stays visible so user can retry.
    }
  }

  return (
    <section
      aria-labelledby="consent-banner-title"
      className="relative overflow-hidden rounded-2xl border border-purple-400/20 bg-gradient-to-br from-purple-500/[0.08] via-fuchsia-500/[0.06] to-transparent p-6 md:p-7"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-purple-500/12 blur-3xl"
      />
      <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between md:gap-8">
        <div className="max-w-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-purple-200/80">
            {DASHBOARD_BANNER_COPY.eyebrow}
          </p>
          <h3
            id="consent-banner-title"
            className="mt-2 text-lg font-semibold leading-tight text-white md:text-xl"
          >
            {DASHBOARD_BANNER_COPY.title}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-white/62">
            {DASHBOARD_BANNER_COPY.body}{" "}
            <Link
              href="/dashboard/settings/preferences"
              className="text-purple-200/90 underline-offset-4 hover:underline"
            >
              Manage anytime
            </Link>
            .
          </p>
          {error ? (
            <p
              role="alert"
              className="mt-3 text-xs text-rose-300/95"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handle("opt_in")}
            className="np-btn np-btn-primary inline-flex items-center justify-center rounded-full px-5 py-2 text-sm font-semibold text-white shadow-[0_12px_24px_-12px_rgba(139,92,246,0.7)] transition hover:brightness-[1.08] disabled:cursor-wait disabled:opacity-70"
          >
            {saving ? "Saving…" : DASHBOARD_BANNER_COPY.optInCta}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handle("dismiss")}
            className="inline-flex items-center justify-center rounded-full border border-white/14 bg-white/[0.03] px-4 py-2 text-sm font-medium text-white/80 transition hover:border-white/22 hover:text-white disabled:opacity-60"
          >
            {DASHBOARD_BANNER_COPY.dismissCta}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handle("opt_out")}
            className="inline-flex items-center justify-center rounded-full px-3 py-2 text-xs font-medium text-white/48 underline-offset-4 transition hover:text-white/75 hover:underline disabled:opacity-60"
          >
            {DASHBOARD_BANNER_COPY.optOutCta}
          </button>
        </div>
      </div>
    </section>
  )
}

function SuccessState(props: {
  title: string
  body: string
  tone: "positive" | "neutral"
}) {
  const border =
    props.tone === "positive"
      ? "border-emerald-400/25 bg-emerald-500/[0.07]"
      : "border-white/10 bg-white/[0.03]"
  return (
    <section
      role="status"
      aria-live="polite"
      className={`rounded-2xl border ${border} p-5 md:p-6`}
    >
      <p className="text-sm font-semibold text-white/92">{props.title}</p>
      <p className="mt-1 text-sm leading-relaxed text-white/62">{props.body}</p>
    </section>
  )
}
