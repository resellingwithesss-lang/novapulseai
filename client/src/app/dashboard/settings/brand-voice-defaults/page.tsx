"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ApiError } from "@/lib/api"
import { fetchBrandVoices, type BrandVoiceDto } from "@/lib/workflowApi"
import { fetchSettings, patchPreferences } from "@/lib/settingsApi"
import {
  SettingsCard,
  SettingsPageHeader,
} from "@/components/settings/SettingsSection"

export default function BrandVoiceDefaultsPage() {
  const [voices, setVoices] = useState<BrandVoiceDto[]>([])
  const [defaultId, setDefaultId] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [initialDefaultId, setInitialDefaultId] = useState<string>("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [v, settings] = await Promise.all([fetchBrandVoices(), fetchSettings()])
      const list = v.brandVoices ?? []
      setVoices(list)
      const raw =
        typeof settings.preferences.defaultBrandVoiceId === "string"
          ? settings.preferences.defaultBrandVoiceId
          : ""
      const valid = list.some((b) => b.id === raw) ? raw : ""
      setDefaultId(valid)
      setInitialDefaultId(valid)
    } catch (e) {
      setError((e as ApiError)?.message ?? "Could not load brand voices.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(() => defaultId !== initialDefaultId, [defaultId, initialDefaultId])

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSavedFlash(false)
    try {
      await patchPreferences({
        defaultBrandVoiceId: defaultId || null,
      })
      setInitialDefaultId(defaultId)
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
        title="Brand voice defaults"
        description="Pick the voice new packs and tools should start from. You can still override per workspace or per pack."
      />

      {loading ? (
        <div className="animate-pulse space-y-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-8">
          <div className="h-4 w-1/2 rounded bg-white/10" />
          <div className="h-10 w-full max-w-lg rounded bg-white/10" />
        </div>
      ) : error && !voices.length ? (
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
      ) : (
        <form className="space-y-6" onSubmit={onSave}>
          <SettingsCard
            title="Default brand voice"
            description="Used when a flow does not specify a voice. Requires at least one saved voice."
            footer={
              <p className="text-xs leading-relaxed text-white/42">
                Manage full voice definitions on{" "}
                <Link
                  href="/dashboard/brand-voices"
                  className="font-medium text-purple-200/90 underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45"
                >
                  Brand voices
                </Link>
                .
              </p>
            }
          >
            {voices.length === 0 ? (
              <p className="text-sm text-white/55">
                You have no brand voices yet. Create one first, then return here to set a
                default.
              </p>
            ) : (
              <label className="block" htmlFor="defaultVoice">
                <span className="text-[13px] font-medium text-white/72">Voice</span>
                <select
                  id="defaultVoice"
                  name="defaultVoice"
                  value={defaultId}
                  onChange={(e) => setDefaultId(e.target.value)}
                  className="np-select mt-2 w-full max-w-lg"
                >
                  <option value="">No default (choose per project)</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
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

          {voices.length > 0 ? (
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
          ) : null}
        </form>
      )}
    </div>
  )
}
