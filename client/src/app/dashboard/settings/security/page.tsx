"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { ApiError } from "@/lib/api"
import { useAuth } from "@/context/AuthContext"
import { fetchSettings, changePassword, type SettingsProfile } from "@/lib/settingsApi"
import {
  SettingsCard,
  SettingsPageHeader,
} from "@/components/settings/SettingsSection"

export default function SecuritySettingsPage() {
  const router = useRouter()
  const { logout } = useAuth()
  const [profile, setProfile] = useState<SettingsProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwBusy, setPwBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await fetchSettings()
      setProfile(data.profile)
    } catch {
      setProfile(null)
      setLoadError("Could not load security settings. Try again.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const canChangePassword = profile?.provider === "LOCAL"

  const onChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwError(null)
    if (!currentPassword.trim()) {
      setPwError("Enter your current password.")
      return
    }
    if (newPassword.length < 8) {
      setPwError("New password must be at least 8 characters.")
      return
    }
    if (newPassword !== confirmPassword) {
      setPwError("New password and confirmation do not match.")
      return
    }
    setPwBusy(true)
    try {
      await changePassword({ currentPassword, newPassword })
      await logout()
      router.replace("/login?reason=password-reset")
    } catch (err) {
      setPwError((err as ApiError)?.message ?? "Could not update password.")
    } finally {
      setPwBusy(false)
    }
  }

  return (
    <div className="space-y-8">
      <SettingsPageHeader
        title="Security"
        description="Sign-in methods and password hygiene. Sensitive actions may require you to sign in again."
      />

      {loading ? (
        <div className="animate-pulse space-y-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-8">
          <div className="h-4 w-1/2 rounded bg-white/10" />
        </div>
      ) : loadError ? (
        <div className="space-y-4">
          <div
            role="alert"
            className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200/95"
          >
            {loadError}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-full border border-white/[0.12] bg-white/[0.06] px-4 py-2 text-sm font-medium text-white/88 outline-none transition hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816]"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <SettingsCard
            title="Sign-in"
            description="How you authenticate to NovaPulseAI."
          >
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-white/42">Method</dt>
                <dd className="mt-1 font-medium text-white/88">
                  {profile?.provider === "GOOGLE"
                    ? "Google"
                    : profile?.provider === "GITHUB"
                      ? "GitHub"
                      : "Email & password"}
                </dd>
              </div>
              <div>
                <dt className="text-white/42">Last sign-in</dt>
                <dd className="mt-1 font-medium text-white/88">
                  {profile?.lastLoginAt
                    ? new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(profile.lastLoginAt))
                    : "—"}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-white/42">
              Payment methods and invoices live in{" "}
              <Link
                href="/dashboard/billing"
                className="font-medium text-purple-200/90 underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45"
              >
                Billing
              </Link>{" "}
              (Stripe Customer Portal).
            </p>
          </SettingsCard>

          {canChangePassword ? (
            <SettingsCard
              title="Change password"
              description="Updates your password and signs out other sessions. You will sign in again on this device."
            >
              <form className="space-y-4" onSubmit={onChangePassword}>
                <label className="block" htmlFor="currentPassword">
                  <span className="text-[13px] font-medium text-white/72">
                    Current password
                  </span>
                  <input
                    id="currentPassword"
                    name="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="mt-2 w-full max-w-md rounded-xl border border-white/[0.1] bg-black/30 px-3.5 py-2.5 text-sm text-white outline-none focus:border-purple-400/40 focus:ring-2 focus:ring-purple-400/35"
                  />
                </label>
                <label className="block" htmlFor="newPassword">
                  <span className="text-[13px] font-medium text-white/72">New password</span>
                  <input
                    id="newPassword"
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="mt-2 w-full max-w-md rounded-xl border border-white/[0.1] bg-black/30 px-3.5 py-2.5 text-sm text-white outline-none focus:border-purple-400/40 focus:ring-2 focus:ring-purple-400/35"
                  />
                </label>
                <label className="block" htmlFor="confirmPassword">
                  <span className="text-[13px] font-medium text-white/72">
                    Confirm new password
                  </span>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="mt-2 w-full max-w-md rounded-xl border border-white/[0.1] bg-black/30 px-3.5 py-2.5 text-sm text-white outline-none focus:border-purple-400/40 focus:ring-2 focus:ring-purple-400/35"
                  />
                </label>
                {pwError ? (
                  <p className="text-sm text-red-300/95" role="alert">
                    {pwError}
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={
                    pwBusy ||
                    !currentPassword.trim() ||
                    newPassword.length < 8 ||
                    newPassword !== confirmPassword
                  }
                  className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.06] px-5 py-2.5 text-sm font-semibold text-white outline-none transition hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pwBusy ? "Updating…" : "Update password"}
                </button>
              </form>
            </SettingsCard>
          ) : (
            <SettingsCard
              title="Password"
              description="OAuth accounts do not use a NovaPulseAI password. Continue signing in with your provider, or contact support if you need to add password access."
            >
              <p className="text-sm text-white/55">
                Your account uses{" "}
                <span className="font-medium text-white/80">
                  {profile?.provider === "GOOGLE"
                    ? "Google"
                    : profile?.provider === "GITHUB"
                      ? "GitHub"
                      : "a linked provider"}
                </span>
                . Password changes are not available for this sign-in method.
              </p>
            </SettingsCard>
          )}
        </div>
      )}
    </div>
  )
}
