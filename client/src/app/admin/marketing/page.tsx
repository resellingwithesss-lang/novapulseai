"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ApiError } from "@/lib/api"
import {
  fetchLifecycleStatus,
  fetchMarketingOverview,
  type LifecycleStatus,
  type MarketingOverview,
} from "@/lib/adminMarketingApi"

const statusMeta: Record<
  "OPTED_IN" | "LEGACY_OPT_IN" | "UNKNOWN" | "DISMISSED" | "OPTED_OUT",
  { label: string; tone: string; description: string }
> = {
  OPTED_IN: {
    label: "Opted in",
    tone: "text-emerald-300",
    description: "Active members who explicitly accepted the NovaPulseAI club.",
  },
  LEGACY_OPT_IN: {
    label: "Legacy opt-in",
    tone: "text-emerald-200/80",
    description:
      "Pre-policy users — still sendable until they answer the new prompt.",
  },
  UNKNOWN: {
    label: "Not yet asked",
    tone: "text-amber-200",
    description: "Haven't seen a consent surface yet. Primary opt-in target.",
  },
  DISMISSED: {
    label: "Dismissed",
    tone: "text-white/60",
    description: "Snoozed the prompt; resurfaces after the cooldown.",
  },
  OPTED_OUT: {
    label: "Opted out",
    tone: "text-rose-300",
    description: "Explicitly declined marketing. Never re-prompted.",
  },
}

export default function AdminMarketingOverviewPage() {
  const [data, setData] = useState<MarketingOverview | null>(null)
  const [lifecycle, setLifecycle] = useState<LifecycleStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        const [overviewRes, lifecycleRes] = await Promise.all([
          fetchMarketingOverview(),
          fetchLifecycleStatus().catch(() => null),
        ])
        if (cancelled) return
        setData(overviewRes)
        setLifecycle(lifecycleRes)
      } catch (err) {
        if (cancelled) return
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load marketing overview."
        setError(message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
            NovaPulseAI · Growth
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Lifecycle marketing
          </h1>
          <p className="mt-2 max-w-xl text-sm text-white/60">
            Creator-growth club health, consent posture, and recent campaign
            performance. Every send here is gated behind explicit consent —
            transactional email is never routed through this console.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/marketing/subscribers"
            className="inline-flex items-center gap-2 rounded-lg bg-white/[0.06] px-4 py-2 text-sm font-medium text-white/90 ring-1 ring-white/10 transition hover:bg-white/[0.1]"
          >
            Manage subscribers
          </Link>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/50">
          Headline
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            loading={loading}
            label="Total users"
            value={data?.totals.users}
          />
          <KpiCard
            loading={loading}
            label="Sendable audience"
            value={data?.totals.sendable}
            accent="emerald"
            helper="Opted in or legacy, with marketing emails enabled."
          />
          <KpiCard
            loading={loading}
            label="Opt-ins · last 7d"
            value={data?.deltas7d.optedIn}
            accent="emerald"
          />
          <KpiCard
            loading={loading}
            label="Opt-outs · last 7d"
            value={data?.deltas7d.optedOut}
            accent="rose"
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/50">
          Consent breakdown
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(
            Object.keys(statusMeta) as Array<keyof typeof statusMeta>
          ).map((key) => (
            <div
              key={key}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-5"
            >
              <p className="text-xs uppercase tracking-[0.12em] text-white/45">
                {statusMeta[key].label}
              </p>
              <p className={`mt-2 text-3xl font-semibold ${statusMeta[key].tone}`}>
                {loading ? "…" : (data?.totals[key] ?? 0).toLocaleString()}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-white/50">
                {statusMeta[key].description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/50">
            Lifecycle engine
          </h2>
          <span
            className={`text-xs font-semibold uppercase tracking-[0.1em] ${
              lifecycle?.engine.enabled ? "text-emerald-300" : "text-rose-300"
            }`}
          >
            {lifecycle?.engine.enabled ? "Engine running" : "Engine disabled"}
          </span>
        </div>
        <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.12em] text-white/45">
              <tr>
                <th className="px-4 py-3">Stream</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Cooldown</th>
                <th className="px-4 py-3 text-right">Last 24h</th>
                <th className="px-4 py-3 text-right">Last 7d</th>
                <th className="px-4 py-3 text-right">All time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {lifecycle?.triggers.map((t) => (
                <tr key={t.trigger} className="hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <div className="text-white/90">{t.displayName}</div>
                    <div className="text-[11px] text-white/40">
                      {t.templateId}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {t.enabled ? (
                      <span className="inline-flex items-center rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-200">
                        Enabled
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60">
                        Paused
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-white/60">
                    {t.cooldownDays}d
                    {!t.respectsFrequencyCap ? (
                      <span className="ml-1 text-amber-200/80" title="ignores 48h cap">
                        ·
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/85">
                    {t.counts.last24h.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/70">
                    {t.counts.last7d.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/50">
                    {t.counts.total.toLocaleString()}
                  </td>
                </tr>
              )) ?? null}
              {!lifecycle && !loading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-center text-xs text-white/40"
                  >
                    Lifecycle engine status unavailable.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {lifecycle && lifecycle.recentSends.length > 0 ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-white/45">
              Recent lifecycle sends
            </p>
            <ul className="space-y-1.5">
              {lifecycle.recentSends.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="truncate text-white/70">
                    <span className="text-white/50">{s.trigger}</span>{" "}
                    → <span className="text-white/90">{s.email ?? s.userId}</span>
                    {s.plan ? (
                      <span className="ml-2 rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-white/55">
                        {s.plan}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-white/40">
                    {new Date(s.sentAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section>
        <div className="flex items-end justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/50">
            Recent campaigns
          </h2>
          <span className="text-xs text-white/40">
            Manual campaign builder lands in Phase 5.
          </span>
        </div>
        <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.12em] text-white/45">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Queued</th>
                <th className="px-4 py-3 text-right">Sent</th>
                <th className="px-4 py-3 text-right">Failed</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-white/40">
                    Loading…
                  </td>
                </tr>
              ) : data && data.recentCampaigns.length > 0 ? (
                data.recentCampaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-white/[0.03]">
                    <td className="px-4 py-3 text-white/90">{c.name}</td>
                    <td className="px-4 py-3 text-white/70">{c.subject}</td>
                    <td className="px-4 py-3">
                      <StatusPill status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-right text-white/70">
                      {c.queuedCount}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-300">
                      {c.sentCount}
                    </td>
                    <td className="px-4 py-3 text-right text-rose-300">
                      {c.failedCount}
                    </td>
                    <td className="px-4 py-3 text-white/50">
                      {new Date(c.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-white/50"
                  >
                    No campaigns yet. Subscriber capture is already live across
                    dashboard, billing, and settings.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function KpiCard({
  loading,
  label,
  value,
  accent,
  helper,
}: {
  loading: boolean
  label: string
  value: number | undefined
  accent?: "emerald" | "rose"
  helper?: string
}) {
  const toneClass =
    accent === "emerald"
      ? "text-emerald-300"
      : accent === "rose"
        ? "text-rose-300"
        : "text-white"
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-xs uppercase tracking-[0.12em] text-white/45">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${toneClass}`}>
        {loading ? "…" : (value ?? 0).toLocaleString()}
      </p>
      {helper ? (
        <p className="mt-2 text-xs leading-relaxed text-white/50">{helper}</p>
      ) : null}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT: "bg-white/10 text-white/70",
    QUEUED: "bg-amber-500/15 text-amber-200",
    SENDING: "bg-blue-500/15 text-blue-200",
    COMPLETED: "bg-emerald-500/15 text-emerald-200",
    FAILED: "bg-rose-500/15 text-rose-200",
  }
  const cls = map[status] ?? "bg-white/10 text-white/70"
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${cls}`}
    >
      {status}
    </span>
  )
}
