"use client"

import { useMemo, useState } from "react"
import { useMarketingConsent } from "@/hooks/useMarketingConsent"
import { SettingsCard } from "@/components/settings/SettingsSection"
import { SETTINGS_CARD_COPY } from "./consentCopy"

function formatRelative(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / (1000 * 60 * 60 * 24))
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months === 1) return "1 month ago"
  return `${months} months ago`
}

function formatSource(source: string | null | undefined): string | null {
  if (!source) return null
  const map: Record<string, string> = {
    onboarding: "Onboarding",
    dashboard_banner: "Dashboard",
    billing_card: "Billing",
    settings: "Settings",
    signup: "Signup",
    unsubscribe: "Unsubscribe link",
    email_link: "Unsubscribe link",
    admin: "Admin",
  }
  return map[source] ?? null
}

/**
 * Permanent control surface for marketing consent. Reads /api/marketing/consent
 * on mount so the displayed state is authoritative (not cached from /auth/me).
 */
export default function ConsentSettingsCard() {
  const { consent, loading, saving, error, optIn, optOut } =
    useMarketingConsent({ eager: true })
  const [flash, setFlash] = useState<"saved" | null>(null)

  const on = consent?.consent.status === "OPTED_IN" ||
    (consent?.consent.status === "LEGACY_OPT_IN" &&
      consent?.consent.marketingEmails === true)

  const statusLine = useMemo(() => {
    if (!consent) return null
    const rel = formatRelative(consent.consent.updatedAt)
    const src = formatSource(consent.consent.source)
    const parts: string[] = []
    if (consent.consent.status === "OPTED_IN") parts.push("Opted in")
    else if (consent.consent.status === "OPTED_OUT") parts.push("Opted out")
    else if (consent.consent.status === "LEGACY_OPT_IN") parts.push("On (imported)")
    else if (consent.consent.status === "DISMISSED") parts.push("Not answered")
    else parts.push("Not answered")
    if (rel) parts.push(`updated ${rel}`)
    if (src) parts.push(`via ${src}`)
    return parts.join(" · ")
  }, [consent])

  const toggle = async () => {
    try {
      if (on) {
        await optOut("settings")
      } else {
        await optIn("settings")
      }
      setFlash("saved")
      window.setTimeout(() => setFlash(null), 2000)
    } catch {
      // hook surfaces the error
    }
  }

  return (
    <SettingsCard
      id="settings-marketing"
      title={SETTINGS_CARD_COPY.title}
      description={SETTINGS_CARD_COPY.body}
    >
      {loading ? (
        <div className="animate-pulse">
          <div className="h-5 w-40 rounded bg-white/8" />
          <div className="mt-3 h-3 w-56 rounded bg-white/6" />
        </div>
      ) : (
        <>
          {error ? (
            <p role="alert" className="mb-3 text-xs text-rose-300/95">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-purple-200/85">
                {SETTINGS_CARD_COPY.eyebrow}
              </p>
              <p className="mt-1 text-sm text-white/78">
                {on ? SETTINGS_CARD_COPY.successBody : SETTINGS_CARD_COPY.declineBody}
              </p>
              {statusLine ? (
                <p className="mt-2 text-xs text-white/42">{statusLine}</p>
              ) : null}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              disabled={saving}
              onClick={() => void toggle()}
              className={
                "relative h-7 w-12 shrink-0 rounded-full border transition outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] disabled:cursor-wait disabled:opacity-70 " +
                (on
                  ? "border-purple-400/40 bg-purple-600/50"
                  : "border-white/15 bg-white/[0.06]")
              }
            >
              <span
                className={
                  "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition " +
                  (on ? "left-5" : "left-0.5")
                }
              />
              <span className="sr-only">
                {on ? SETTINGS_CARD_COPY.optOutCta : SETTINGS_CARD_COPY.optInCta}
              </span>
            </button>
          </div>

          <p
            className="mt-3 text-[11px] text-white/38"
            aria-live="polite"
          >
            {saving
              ? "Saving…"
              : flash === "saved"
                ? "Saved."
                : "Autosaves when toggled."}
          </p>
        </>
      )}
    </SettingsCard>
  )
}
