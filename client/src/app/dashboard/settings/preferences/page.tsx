"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError } from "@/lib/api"
import {
  fetchSettings,
  patchPreferences,
  type SettingsPreferences,
} from "@/lib/settingsApi"
import {
  SettingsCard,
  SettingsPageHeader,
} from "@/components/settings/SettingsSection"
import ConsentSettingsCard from "@/components/marketing/ConsentSettingsCard"

export default function PreferencesSettingsPage() {
  const [prefs, setPrefs] = useState<SettingsPreferences>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchSettings()
      setPrefs(data.preferences ?? {})
    } catch (e) {
      setError((e as ApiError)?.message ?? "Could not load preferences.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const pushSave = useCallback(
    (next: SettingsPreferences, key: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(async () => {
        setSavingKey(key)
        setError(null)
        try {
          const { preferences } = await patchPreferences(next)
          setPrefs(preferences)
          setSavedAt(Date.now())
        } catch (e) {
          setError((e as ApiError)?.message ?? "Could not save.")
        } finally {
          setSavingKey(null)
        }
      }, 320)
    },
    []
  )

  const setUiDensity = (uiDensity: "comfortable" | "compact") => {
    setPrefs((p) => ({ ...p, uiDensity }))
    pushSave({ uiDensity }, "uiDensity")
  }

  const toggleEmailField = (field: "emailProductUpdates" | "emailUsageAlerts") => {
    const on = prefs[field] !== false
    const next = !on
    setPrefs((p) => ({ ...p, [field]: next }))
    pushSave({ [field]: next }, field)
  }

  return (
    <div className="space-y-8">
      <SettingsPageHeader
        title="Preferences"
        description="Control how NovaPulseAI feels day to day. Changes apply to this account only."
      />

      {loading ? (
        <div className="animate-pulse space-y-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-8">
          <div className="h-4 w-2/3 rounded bg-white/10" />
          <div className="h-24 w-full rounded bg-white/10" />
        </div>
      ) : (
        <>
          {error ? (
            <div
              role="alert"
              className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200/95"
            >
              {error}
            </div>
          ) : null}

          <p className="text-xs text-white/38" aria-live="polite">
            {savingKey ? "Saving…" : savedAt ? "All changes saved." : ""}
          </p>

          <SettingsCard
            title="Interface density"
            description="Autosaves. Affects spacing in dashboard views (more screens soon)."
          >
            <div
              role="radiogroup"
              aria-label="Interface density"
              className="flex flex-col gap-2 sm:flex-row sm:gap-3"
            >
              {(
                [
                  { id: "comfortable" as const, label: "Comfortable", hint: "More breathing room" },
                  { id: "compact" as const, label: "Compact", hint: "Tighter lists and panels" },
                ] as const
              ).map(({ id, label, hint }) => {
                const selected = (prefs.uiDensity ?? "comfortable") === id
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setUiDensity(id)}
                    className={
                      "flex flex-1 flex-col rounded-xl border px-4 py-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] " +
                      (selected
                        ? "border-purple-400/35 bg-purple-500/10 ring-1 ring-purple-400/20"
                        : "border-white/[0.08] bg-black/20 hover:border-white/14")
                    }
                  >
                    <span className="text-sm font-medium text-white/90">{label}</span>
                    <span className="mt-0.5 text-xs text-white/45">{hint}</span>
                  </button>
                )
              })}
            </div>
          </SettingsCard>

          <SettingsCard
            id="settings-notifications"
            title="Email notifications"
            description="Product and usage signals only—no marketing spam. Autosaves per toggle."
          >
            <ul className="space-y-4">
              <li className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-white/88">Product updates</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-white/42">
                    New tools, workflow changes, and billing-relevant announcements.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs.emailProductUpdates !== false}
                  onClick={() => toggleEmailField("emailProductUpdates")}
                  className={
                    "relative h-7 w-12 shrink-0 rounded-full border transition outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] " +
                    (prefs.emailProductUpdates !== false
                      ? "border-purple-400/40 bg-purple-600/50"
                      : "border-white/15 bg-white/[0.06]")
                  }
                >
                  <span
                    className={
                      "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition " +
                      (prefs.emailProductUpdates !== false ? "left-5" : "left-0.5")
                    }
                  />
                  <span className="sr-only">Product updates email</span>
                </button>
              </li>
              <li className="flex items-start justify-between gap-4 border-t border-white/[0.06] pt-4">
                <div>
                  <p className="text-sm font-medium text-white/88">Usage alerts</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-white/42">
                    Credits running low, trial ending, or failed jobs that need attention.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs.emailUsageAlerts !== false}
                  onClick={() => toggleEmailField("emailUsageAlerts")}
                  className={
                    "relative h-7 w-12 shrink-0 rounded-full border transition outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] " +
                    (prefs.emailUsageAlerts !== false
                      ? "border-purple-400/40 bg-purple-600/50"
                      : "border-white/15 bg-white/[0.06]")
                  }
                >
                  <span
                    className={
                      "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition " +
                      (prefs.emailUsageAlerts !== false ? "left-5" : "left-0.5")
                    }
                  />
                  <span className="sr-only">Usage alerts email</span>
                </button>
              </li>
            </ul>
          </SettingsCard>

          <ConsentSettingsCard />
        </>
      )}
    </div>
  )
}
