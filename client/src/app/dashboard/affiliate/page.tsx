"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import DashboardShell from "@/components/dashboard/DashboardShell"
import { api, ApiError } from "@/lib/api"

type ReferralsMeResponse = {
  success?: boolean
  referralCode: string
  referralLink: string
  shareLinkConfigured?: boolean
  shareLinkWarning?: string | null
  signups: number
  commissions: {
    pendingMinor: number
    paidMinor: number
    rateBps: number
    firstPaymentOnly: boolean
    byStatus: Record<string, { count: number; totalMinor: number }>
  }
  supportEmail: string | null
}

function formatMinor(minor: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(minor / 100)
}

export default function AffiliatePage() {
  const [data, setData] = useState<ReferralsMeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copyHint, setCopyHint] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await api.get<ReferralsMeResponse>("/referrals/me")
      setData(res)
    } catch (e) {
      setData(null)
      setError(
        e instanceof ApiError
          ? e.message
          : "We couldn’t load your referral dashboard. Check your connection and try again."
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const copyLink = async () => {
    if (!data?.referralLink) return
    try {
      await navigator.clipboard.writeText(data.referralLink)
      setCopyHint("Link copied to clipboard.")
      window.setTimeout(() => setCopyHint(null), 2000)
    } catch {
      setCopyHint("Copy blocked — select the link manually.")
      window.setTimeout(() => setCopyHint(null), 4000)
    }
  }

  const pct = data ? (data.commissions.rateBps / 100).toFixed(1) : "5.0"

  return (
    <DashboardShell showCommandHero={false} contentWidth="readable">
      <div className="space-y-8">
        <header className="space-y-2">
          <p className="np-text-fine text-[11px] font-semibold uppercase tracking-[0.14em] text-purple-200/75">
            Referrals
          </p>
          <h1 className="np-title-section text-white">Affiliate program</h1>
          <p className="np-text-body max-w-2xl">
            Share your link. When someone you refer becomes a paying subscriber, you earn{" "}
            <span className="font-medium text-white/90">{pct}%</span> of the invoice amount Stripe
            records as paid on qualifying invoices, on{" "}
            {data?.commissions.firstPaymentOnly !== false
              ? "their first paid invoice only"
              : "each paid invoice while the program is configured that way"}
            . Amounts appear here as <span className="text-white/85">pending</span> until our team
            reviews them. Actual payouts are agreed separately (bank transfer, PayPal, etc.)—this
            dashboard does not send money.
          </p>
        </header>

        {loading && !data ? (
          <div className="np-card-soft p-6 text-sm text-white/60" role="status">
            Loading your referral profile…
          </div>
        ) : null}

        {error ? (
          <div
            className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-100/95"
            role="alert"
          >
            {error}
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 block text-xs font-medium text-red-200 underline"
            >
              Retry
            </button>
          </div>
        ) : null}

        {data ? (
          <div className="space-y-6">
            {data.shareLinkWarning ? (
              <div
                className="rounded-2xl border border-amber-500/35 bg-amber-500/10 px-5 py-4 text-sm text-amber-50/95"
                role="status"
              >
                <p className="font-medium text-amber-100/95">Fix your referral link before sharing</p>
                <p className="mt-1 text-amber-50/90">{data.shareLinkWarning}</p>
              </div>
            ) : data.shareLinkConfigured === false ? (
              <div
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-xs text-white/55"
                role="status"
              >
                Your link is built from the app&apos;s public URL. If it doesn&apos;t match where
                people should sign up, ask your team to set the correct site URL on the API (see
                deploy docs)—wrong links won&apos;t credit you.
              </div>
            ) : null}

            <section className="np-card p-6 md:p-7">
              <h2 className="text-sm font-semibold text-white/92">Your referral link</h2>
              <p className="mt-1 text-xs text-white/55">
                Your code{" "}
                <span className="font-mono text-sm text-white/85">{data.referralCode}</span> is
                embedded in the URL below. New accounts must use this link (or the same code at
                signup) for attribution.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  readOnly
                  value={data.referralLink}
                  className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/35 px-4 py-3 text-sm text-white/90"
                />
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="np-btn np-btn-secondary shrink-0 px-5 py-3 text-sm"
                >
                  Copy link
                </button>
              </div>
              {copyHint ? (
                <p className="mt-2 text-xs text-emerald-200/90">{copyHint}</p>
              ) : null}
            </section>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="np-card-soft p-5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
                  Referred signups
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-white">
                  {data.signups}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  People who created an account with your link or code. Subscription and commission
                  totals are tracked separately.
                </p>
              </div>
              <div className="np-card-soft p-5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
                  Pending + approved
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-white">
                  {formatMinor(data.commissions.pendingMinor)}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  In review or approved but not yet logged as paid out to you in our records.
                </p>
              </div>
              <div className="np-card-soft p-5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
                  Marked paid
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-white">
                  {formatMinor(data.commissions.paidMinor)}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  Amounts our team marked after completing payout outside this app (not a bank or
                  Stripe transfer from this button).
                </p>
              </div>
            </div>

            <section className="np-card-soft p-5">
              <h3 className="text-sm font-semibold text-white/88">Commissions by status</h3>
              <p className="mt-1 text-xs text-white/45">
                Rows are created when Stripe confirms a qualifying paid invoice for a referred
                customer. No row means no qualifying payment recorded yet—not a problem with your
                link.
              </p>
              <ul className="mt-3 space-y-2 text-sm text-white/65">
                {Object.entries(data.commissions.byStatus).map(([status, v]) => (
                  <li key={status} className="flex justify-between gap-4">
                    <span className="uppercase tracking-wide text-white/50">{status}</span>
                    <span>
                      {v.count} · {formatMinor(v.totalMinor)}
                    </span>
                  </li>
                ))}
                {Object.keys(data.commissions.byStatus).length === 0 ? (
                  <li className="text-white/45">
                    No commission history yet. When a referred user pays their first qualifying
                    invoice, amounts will show here by status.
                  </li>
                ) : null}
              </ul>
            </section>

            {data.supportEmail ? (
              <p className="text-xs text-white/50">
                Questions about this program:{" "}
                <a
                  className="text-purple-200 underline"
                  href={`mailto:${data.supportEmail}?subject=NovaPulseAI%20affiliate%20question`}
                >
                  {data.supportEmail}
                </a>
              </p>
            ) : (
              <p className="text-xs text-white/45">
                For affiliate questions, use the same support channel as your subscription or the
                contact form on the website—we’ll connect you with the right person.
              </p>
            )}

            <p className="text-xs text-white/40">
              You can’t refer yourself or attach a second referrer to an account. We create
              commission entries when Stripe notifies us of a paid invoice for a referred customer.
              Subscription renewals don’t earn commission unless your program is explicitly configured
              for that.
            </p>
          </div>
        ) : null}

        <footer>
          <Link href="/dashboard" className="text-sm text-purple-200 underline">
            ← Back to dashboard
          </Link>
        </footer>
      </div>
    </DashboardShell>
  )
}
