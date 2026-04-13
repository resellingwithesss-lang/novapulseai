"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ApiError } from "@/lib/api"
import { fetchSettings, patchProfile, type SettingsProfile } from "@/lib/settingsApi"
import { useAuth } from "@/context/AuthContext"
import {
  SettingsCard,
  SettingsPageHeader,
} from "@/components/settings/SettingsSection"

function formatJoined(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(iso))
  } catch {
    return "—"
  }
}

function providerLabel(p: SettingsProfile["provider"]) {
  switch (p) {
    case "GOOGLE":
      return "Google"
    case "GITHUB":
      return "GitHub"
    default:
      return "Email & password"
  }
}

export default function ProfileSettingsPage() {
  const { refreshUser } = useAuth()
  const [profile, setProfile] = useState<SettingsProfile | null>(null)
  const [displayName, setDisplayName] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchSettings()
      setProfile(data.profile)
      setDisplayName(data.profile.displayName?.trim() ?? "")
    } catch (e) {
      setError((e as ApiError)?.message ?? "Could not load settings.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const savedDisplay = profile?.displayName?.trim() ?? ""
  const dirty = useMemo(() => {
    return displayName.trim() !== savedDisplay
  }, [displayName, savedDisplay])

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile || saving) return
    setSaving(true)
    setError(null)
    setSavedFlash(false)
    try {
      const trimmed = displayName.trim()
      await patchProfile({
        displayName: trimmed.length ? trimmed.slice(0, 80) : null,
      })
      await load()
      await refreshUser({ silent: true })
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 2500)
    } catch (err) {
      setError((err as ApiError)?.message ?? "Save failed.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      <SettingsPageHeader
        title="Profile"
        description="How you appear in NovaPulseAI and the basics tied to your account."
      />

      {loading ? (
        <div className="animate-pulse space-y-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-8">
          <div className="h-4 w-1/3 rounded bg-white/10" />
          <div className="h-10 w-full max-w-md rounded bg-white/10" />
        </div>
      ) : error && !profile ? (
        <div className="space-y-4">
          <div
            role="alert"
            className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200/95"
          >
            {error}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-full border border-white/[0.12] bg-white/[0.06] px-4 py-2 text-sm font-medium text-white/88 outline-none transition hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816]"
          >
            Try again
          </button>
        </div>
      ) : profile ? (
        <form className="space-y-6" onSubmit={onSave}>
          <SettingsCard
            title="Public name"
            description="Shown in the product where a friendly label helps (emails and billing still use your login email)."
          >
            <label className="block" htmlFor="displayName">
              <span className="text-[13px] font-medium text-white/72">
                Display name
              </span>
              <input
                id="displayName"
                name="displayName"
                type="text"
                maxLength={80}
                autoComplete="nickname"
                value={displayName}
                onChange={(e) => {
                  setError(null)
                  setDisplayName(e.target.value)
                }}
                placeholder="e.g. Alex — Skincare Shorts"
                className="mt-2 w-full max-w-md rounded-xl border border-white/[0.1] bg-black/30 px-3.5 py-2.5 text-sm text-white outline-none ring-offset-2 ring-offset-[#050816] placeholder:text-white/30 focus:border-purple-400/40 focus:ring-2 focus:ring-purple-400/35"
              />
            </label>
            {error ? (
              <p className="mt-3 text-sm text-red-300/95" role="alert">
                {error}
              </p>
            ) : null}
            {savedFlash ? (
              <p className="mt-3 text-sm text-emerald-300/90" role="status">
                Saved.
              </p>
            ) : null}
          </SettingsCard>

          <SettingsCard
            title="Account"
            description="Read-only identifiers for support and billing alignment."
            footer={
              <p className="text-xs leading-relaxed text-white/42">
                Password changes and last sign-in details live under{" "}
                <Link
                  href="/dashboard/settings/security"
                  className="font-medium text-purple-200/90 underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45"
                >
                  Security
                </Link>
                .
              </p>
            }
          >
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-white/42">Email</dt>
                <dd className="mt-1 font-medium text-white/88">{profile.email}</dd>
              </div>
              <div>
                <dt className="text-white/42">Sign-in method</dt>
                <dd className="mt-1 font-medium text-white/88">
                  {providerLabel(profile.provider)}
                </dd>
              </div>
              <div>
                <dt className="text-white/42">Email status</dt>
                <dd className="mt-1 font-medium text-white/88">
                  {profile.emailVerified ? "Verified" : "Not verified"}
                </dd>
              </div>
              <div>
                <dt className="text-white/42">Member since</dt>
                <dd className="mt-1 font-medium text-white/88">
                  {formatJoined(profile.createdAt)}
                </dd>
              </div>
            </dl>
          </SettingsCard>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving || !dirty}
              className="inline-flex min-h-10 items-center justify-center rounded-full bg-gradient-to-r from-purple-600 to-pink-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-900/25 outline-none transition hover:opacity-[0.96] focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            {!dirty && !saving ? (
              <span className="text-xs text-white/38">No unsaved changes.</span>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  )
}
