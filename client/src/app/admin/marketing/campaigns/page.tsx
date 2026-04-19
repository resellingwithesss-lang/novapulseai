"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ApiError } from "@/lib/api"
import type { MarketingConsentStatus } from "@/context/AuthContext"
import {
  createMarketingCampaign,
  estimateMarketingAudience,
  fetchEditorialCampaignTemplates,
  fetchMarketingCampaigns,
  scheduleMarketingCampaign,
  sendMarketingCampaign,
  unscheduleMarketingCampaign,
  type AdminPlan,
  type AdminRole,
  type AdminSubscriptionStatus,
  type EditorialCampaignTemplateDto,
  type EmailCampaignRow,
  type MarketingAudienceFilter,
} from "@/lib/adminMarketingApi"

const MERGE_HELP = [
  "{{name}}",
  "{{first_name}}",
  "{{display_name}}",
  "{{plan}}",
  "{{credits}}",
  "{{subscription_status}}",
  "{{app_url}}",
  "{{email}}",
]

const PLAN_OPTIONS: Array<{ id: "ALL" | AdminPlan; label: string }> = [
  { id: "ALL", label: "Any plan" },
  { id: "FREE", label: "Free" },
  { id: "STARTER", label: "Starter" },
  { id: "PRO", label: "Pro" },
  { id: "ELITE", label: "Elite" },
]

const STATUS_OPTIONS: Array<{ id: "ALL" | AdminSubscriptionStatus; label: string }> = [
  { id: "ALL", label: "Any subscription" },
  { id: "ACTIVE", label: "Active" },
  { id: "TRIALING", label: "Trialing" },
  { id: "PAST_DUE", label: "Past due" },
  { id: "CANCELED", label: "Canceled" },
  { id: "EXPIRED", label: "Expired" },
  { id: "PAUSED", label: "Paused" },
]

const CONSENT_OPTIONS: Array<{ id: "ALL" | MarketingConsentStatus; label: string }> = [
  { id: "ALL", label: "Sendable defaults (opt-in + legacy)" },
  { id: "OPTED_IN", label: "Opted in only" },
  { id: "LEGACY_OPT_IN", label: "Legacy opt-in only" },
]

const ROLE_OPTIONS: Array<{ id: "ALL" | AdminRole; label: string }> = [
  { id: "ALL", label: "Any role" },
  { id: "USER", label: "User" },
  { id: "CREATOR", label: "Creator" },
  { id: "ADMIN", label: "Admin" },
  { id: "OWNER", label: "Owner" },
  { id: "SUPER_ADMIN", label: "Owner (legacy)" },
]

export default function AdminMarketingCampaignsPage() {
  const [templates, setTemplates] = useState<EditorialCampaignTemplateDto[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("")
  const [name, setName] = useState("")
  const [subject, setSubject] = useState("")
  const [htmlContent, setHtmlContent] = useState("")

  const [plan, setPlan] = useState<(typeof PLAN_OPTIONS)[number]["id"]>("ALL")
  const [subscriptionStatus, setSubscriptionStatus] =
    useState<(typeof STATUS_OPTIONS)[number]["id"]>("ALL")
  const [consentStatus, setConsentStatus] =
    useState<(typeof CONSENT_OPTIONS)[number]["id"]>("ALL")
  const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]["id"]>("ALL")
  const [inactiveDays, setInactiveDays] = useState("")

  const [estimate, setEstimate] = useState<number | null>(null)
  const [estimateBreakdown, setEstimateBreakdown] = useState<
    | {
        free: number
        paid: number
        active14d: number
        inactive14d: number
        activeWindowDays: number
      }
    | null
  >(null)
  const [estimateLoading, setEstimateLoading] = useState(false)

  const [campaigns, setCampaigns] = useState<EmailCampaignRow[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [scheduleById, setScheduleById] = useState<Record<string, string>>({})
  const [previewOrigin, setPreviewOrigin] = useState("https://novapulse.ai")

  const audienceFilter = useMemo<MarketingAudienceFilter>(() => {
    const f: MarketingAudienceFilter = { sendableOnly: true }
    if (plan !== "ALL") f.plan = [plan]
    if (subscriptionStatus !== "ALL") f.subscriptionStatus = [subscriptionStatus]
    if (consentStatus !== "ALL") f.consentStatus = [consentStatus]
    if (role !== "ALL") f.role = [role]
    const d = inactiveDays ? Number(inactiveDays) : NaN
    if (Number.isFinite(d) && d > 0) f.inactiveDays = Math.floor(d)
    return f
  }, [plan, subscriptionStatus, consentStatus, role, inactiveDays])

  const previewDoc = useMemo(() => {
    if (!htmlContent.trim()) return ""
    const mergedBody = applyDemoMergeTags(htmlContent, previewOrigin)
    const mergedSubject = applyDemoMergeTags(subject, previewOrigin)
    return buildEmailPreviewDocument(mergedBody, mergedSubject, previewOrigin)
  }, [htmlContent, subject, previewOrigin])

  const loadTemplates = useCallback(async () => {
    try {
      const t = await fetchEditorialCampaignTemplates()
      setTemplates(t)
    } catch {
      setTemplates([])
    }
  }, [])

  const loadCampaigns = useCallback(async () => {
    try {
      setListLoading(true)
      const res = await fetchMarketingCampaigns({ page: 1, limit: 40 })
      setCampaigns(res.campaigns)
    } catch {
      setCampaigns([])
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTemplates()
    void loadCampaigns()
  }, [loadTemplates, loadCampaigns])

  useEffect(() => {
    setPreviewOrigin(window.location.origin)
  }, [])

  const applyTemplate = (id: string) => {
    setSelectedTemplateId(id)
    const t = templates.find((x) => x.id === id)
    if (!t) return
    setName(t.name)
    setSubject(t.subject)
    setHtmlContent(t.html)
  }

  const runEstimate = async () => {
    try {
      setEstimateLoading(true)
      setError(null)
      const res = await estimateMarketingAudience(audienceFilter)
      setEstimate(res.count)
      setEstimateBreakdown(res.breakdown)
    } catch (err) {
      setEstimate(null)
      setEstimateBreakdown(null)
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Estimate failed"
      )
    } finally {
      setEstimateLoading(false)
    }
  }

  const saveDraft = async () => {
    try {
      setBusy(true)
      setError(null)
      setNotice(null)
      await createMarketingCampaign({
        name: name.trim() || "Untitled campaign",
        subject: subject.trim(),
        htmlContent,
        audienceFilter,
      })
      setNotice("Draft saved. Send when ready — recipients must be marketing-sendable (consent + opt-in).")
      setEstimate(null)
      setEstimateBreakdown(null)
      await loadCampaigns()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Save failed"
      )
    } finally {
      setBusy(false)
    }
  }

  const sendDraft = async (id: string) => {
    if (!window.confirm("Queue this campaign for delivery? Sends run through the existing email worker.")) {
      return
    }
    try {
      setBusy(true)
      setError(null)
      await sendMarketingCampaign(id)
      setNotice("Campaign queued for fan-out.")
      await loadCampaigns()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Send failed"
      )
    } finally {
      setBusy(false)
    }
  }

  const scheduleRow = async (id: string) => {
    const raw = scheduleById[id]?.trim()
    if (!raw) {
      setError("Pick a date and time to schedule.")
      return
    }
    const when = new Date(raw)
    if (!Number.isFinite(when.getTime())) {
      setError("Invalid schedule time.")
      return
    }
    try {
      setBusy(true)
      setError(null)
      await scheduleMarketingCampaign(id, when.toISOString())
      setNotice("Campaign scheduled. Fan-out starts automatically at the chosen time.")
      await loadCampaigns()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Schedule failed"
      )
    } finally {
      setBusy(false)
    }
  }

  const unscheduleRow = async (id: string) => {
    try {
      setBusy(true)
      setError(null)
      await unscheduleMarketingCampaign(id)
      setNotice("Schedule cleared — campaign is a draft again.")
      await loadCampaigns()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unschedule failed"
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
            NovaPulseAI · Growth · Campaigns
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Email campaigns</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Compose bulk sends for users who are <strong className="text-white/80">explicitly sendable</strong>{" "}
            (marketing opt-in + consent). Fan-out reuses the production queue; transactional email is never
            routed here.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/marketing"
            className="inline-flex items-center rounded-lg bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/80 ring-1 ring-white/10 transition hover:bg-white/[0.08]"
          >
            Overview
          </Link>
          <Link
            href="/admin/marketing/subscribers"
            className="inline-flex items-center rounded-lg bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/80 ring-1 ring-white/10 transition hover:bg-white/[0.08]"
          >
            Subscribers
          </Link>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-100">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100">
          {notice}
        </div>
      ) : null}

      <section className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-8">
        <div className="space-y-5 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/50">Start from a template</h2>
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  selectedTemplateId === t.id
                    ? "border-purple-400/50 bg-purple-500/20 text-white"
                    : "border-white/12 bg-black/20 text-white/65 hover:border-white/25"
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-white/45">
            Templates are editable. Personalize with: {MERGE_HELP.join(", ")}.
          </p>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-white/55">Internal name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-purple-400/50"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-white/55">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-purple-400/50"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-white/55">HTML body (inner content)</span>
            <textarea
              value={htmlContent}
              onChange={(e) => setHtmlContent(e.target.value)}
              rows={14}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white outline-none focus:border-purple-400/50"
            />
          </label>
        </div>

        <div className="space-y-5 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/50">Audience</h2>
          <p className="text-xs text-white/45">
            Sends always require <code className="text-white/70">sendableOnly</code> — only users with marketing
            email enabled and consent in <strong className="text-white/70">OPTED_IN</strong> or{" "}
            <strong className="text-white/70">LEGACY_OPT_IN</strong>.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Plan" value={plan} onChange={setPlan} options={PLAN_OPTIONS} />
            <SelectField
              label="Subscription"
              value={subscriptionStatus}
              onChange={setSubscriptionStatus}
              options={STATUS_OPTIONS}
            />
            <SelectField label="Consent slice" value={consentStatus} onChange={setConsentStatus} options={CONSENT_OPTIONS} />
            <SelectField label="Role" value={role} onChange={setRole} options={ROLE_OPTIONS} />
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-white/55">Inactive at least (days)</span>
            <input
              value={inactiveDays}
              onChange={(e) => setInactiveDays(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="e.g. 14"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-purple-400/50"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={() => void runEstimate()}
              disabled={estimateLoading}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/15 hover:bg-white/15 disabled:opacity-50"
            >
              {estimateLoading ? "Estimating…" : "Estimate audience"}
            </button>
            {estimate != null ? (
              <span className="text-sm text-emerald-200/90 tabular-nums">
                ~{estimate.toLocaleString()} sendable recipients
              </span>
            ) : null}
          </div>

          {estimateBreakdown && estimate != null ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">Plan mix</p>
                <p className="mt-2 text-sm text-white/85">
                  <span className="tabular-nums text-sky-200">{estimateBreakdown.free.toLocaleString()}</span>{" "}
                  free ·{" "}
                  <span className="tabular-nums text-amber-200">{estimateBreakdown.paid.toLocaleString()}</span>{" "}
                  paid
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
                  Activity (last {estimateBreakdown.activeWindowDays}d)
                </p>
                <p className="mt-2 text-sm text-white/85">
                  <span className="tabular-nums text-emerald-200">
                    {estimateBreakdown.active14d.toLocaleString()}
                  </span>{" "}
                  active ·{" "}
                  <span className="tabular-nums text-white/50">
                    {estimateBreakdown.inactive14d.toLocaleString()}
                  </span>{" "}
                  inactive
                </p>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={busy || !subject.trim() || !htmlContent.trim()}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-900/30 hover:bg-purple-500 disabled:opacity-50"
            >
              Save draft
            </button>
          </div>
        </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 xl:sticky xl:top-6 xl:self-start">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/50">Preview</h2>
          <p className="text-xs leading-relaxed text-white/45">
            Demo merge tags (Alex · PRO · 42 credits). Production sends use each recipient&apos;s real values.
          </p>
          {!previewDoc ? (
            <p className="text-sm text-white/40">Add HTML body to see preview.</p>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">Desktop</p>
                <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#0b0f19] shadow-lg shadow-black/40">
                  <iframe title="Email preview desktop" className="h-[420px] w-full bg-white" srcDoc={previewDoc} />
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">Mobile</p>
                <div className="mt-2 flex justify-center">
                  <div className="overflow-hidden rounded-[28px] border border-white/15 bg-[#0b0f19] shadow-xl shadow-black/50 ring-4 ring-black/40">
                    <iframe
                      title="Email preview mobile"
                      className="h-[520px] w-[280px] bg-white"
                      srcDoc={previewDoc}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/50">Drafts & history</h2>
        <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.12em] text-white/45">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 min-w-[200px]">Schedule</th>
                <th className="px-4 py-3 text-right">Queued</th>
                <th className="px-4 py-3 text-right">Sent</th>
                <th className="px-4 py-3 text-right">Failed</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {listLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-white/45">
                    Loading…
                  </td>
                </tr>
              ) : campaigns.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-white/50">
                    No campaigns yet.
                  </td>
                </tr>
              ) : (
                campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-white/[0.03]">
                    <td className="px-4 py-3 text-white/90">{c.name}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-white/65">{c.subject}</td>
                    <td className="px-4 py-3">
                      <StatusPill status={c.status} />
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-white/60">
                      {c.status === "SCHEDULED" && c.scheduledSendAt ? (
                        <div className="space-y-2">
                          <p className="text-white/75">{new Date(c.scheduledSendAt).toLocaleString()}</p>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void unscheduleRow(c.id)}
                            className="text-[11px] font-semibold text-amber-200/90 hover:text-white disabled:opacity-50"
                          >
                            Unschedule
                          </button>
                        </div>
                      ) : c.status === "DRAFT" ? (
                        <div className="flex flex-col gap-2">
                          <input
                            type="datetime-local"
                            value={scheduleById[c.id] ?? ""}
                            onChange={(e) =>
                              setScheduleById((s) => ({ ...s, [c.id]: e.target.value }))
                            }
                            className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none focus:border-purple-400/40"
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void scheduleRow(c.id)}
                            className="text-left text-[11px] font-semibold text-violet-200 hover:text-white disabled:opacity-50"
                          >
                            Schedule send
                          </button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-white/70">{c.queuedCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-300">{c.sentCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-rose-300">{c.failedCount}</td>
                    <td className="px-4 py-3 text-xs text-white/50">
                      {new Date(c.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.status === "DRAFT" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void sendDraft(c.id)}
                          className="text-xs font-semibold text-purple-200 hover:text-white disabled:opacity-50"
                        >
                          Send now
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: Array<{ id: T; label: string }>
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-white/55">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-purple-400/50"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function applyDemoMergeTags(template: string, appUrl: string): string {
  const pairs: Record<string, string> = {
    "{{name}}": "Alex",
    "{{first_name}}": "Alex",
    "{{display_name}}": "Alex Rivera",
    "{{plan}}": "PRO",
    "{{credits}}": "42",
    "{{subscription_status}}": "ACTIVE",
    "{{email}}": "alex@example.com",
    "{{app_url}}": appUrl,
  }
  let out = template
  for (const [token, value] of Object.entries(pairs)) {
    out = out.split(token).join(value)
  }
  return out
}

function buildEmailPreviewDocument(
  innerHtml: string,
  subjectLine: string,
  appUrl: string
): string {
  const unsub = `${appUrl}/api/email/unsubscribe?token=preview`
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head>
<body style="margin:0;background:#0b0f19;color:#e5e7eb;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:600px;background:#111827;border-radius:16px;border:1px solid rgba(255,255,255,0.08);">
        <tr><td style="padding:22px 24px 0;font-size:13px;color:#94a3b8;">
          <strong style="color:#e5e7eb;">Subject:</strong> ${escapePreviewText(subjectLine)}
        </td></tr>
        <tr><td style="padding:20px 24px 28px;font-size:15px;line-height:1.6;">
          ${innerHtml}
          <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:28px 0;" />
          <p style="margin:0;font-size:12px;color:#9ca3af;">
            You’re subscribed to product updates from NovaPulseAI.
            <a href="${unsub}" style="color:#c4b5fd;">Unsubscribe</a> from marketing emails.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function escapePreviewText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT: "bg-white/10 text-white/70",
    SCHEDULED: "bg-violet-500/15 text-violet-200",
    QUEUED: "bg-amber-500/15 text-amber-200",
    SENDING: "bg-blue-500/15 text-blue-200",
    COMPLETED: "bg-emerald-500/15 text-emerald-200",
    FAILED: "bg-rose-500/15 text-rose-200",
  }
  const cls = map[status] ?? "bg-white/10 text-white/70"
  return (
    <span
      className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${cls}`}
    >
      {status}
    </span>
  )
}
