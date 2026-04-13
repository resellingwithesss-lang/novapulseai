"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ApiError } from "@/lib/api"
import { fetchSettings, patchPreferences } from "@/lib/settingsApi"
import { fetchWorkspaces, type WorkspaceDto } from "@/lib/workflowApi"
import {
  SettingsCard,
  SettingsPageHeader,
} from "@/components/settings/SettingsSection"

export default function WorkspaceDefaultsPage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([])
  const [defaultId, setDefaultId] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [initialDefaultId, setInitialDefaultId] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [w, settings] = await Promise.all([fetchWorkspaces(), fetchSettings()])
      const list = w.workspaces ?? []
      setWorkspaces(list)
      const raw =
        typeof settings.preferences.defaultWorkspaceId === "string"
          ? settings.preferences.defaultWorkspaceId
          : ""
      const valid = list.some((x) => x.id === raw) ? raw : ""
      setDefaultId(valid)
      setInitialDefaultId(valid)
    } catch (e) {
      setError((e as ApiError)?.message ?? "Could not load workspaces.")
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
        defaultWorkspaceId: defaultId || null,
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
        title="Workspace defaults"
        description="Choose where new packs and tools land first. You can still switch workspace inside each flow."
      />

      {loading ? (
        <div className="animate-pulse space-y-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-8">
          <div className="h-4 w-1/2 rounded bg-white/10" />
          <div className="h-10 w-full max-w-lg rounded bg-white/10" />
        </div>
      ) : error && !workspaces.length ? (
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
            title="Default workspace"
            description="Used when a tool opens without a workspace context. Create workspaces from the studio hub."
            footer={
              <p className="text-xs leading-relaxed text-white/42">
                Manage workspaces on{" "}
                <Link
                  href="/dashboard/workspaces"
                  className="font-medium text-purple-200/90 underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45"
                >
                  Workspaces
                </Link>
                .
              </p>
            }
          >
            {workspaces.length === 0 ? (
              <p className="text-sm text-white/55">
                You have no workspaces yet. Create one, then return here to set a default
                starting point for new work.
              </p>
            ) : (
              <label className="block" htmlFor="defaultWorkspace">
                <span className="text-[13px] font-medium text-white/72">Workspace</span>
                <select
                  id="defaultWorkspace"
                  name="defaultWorkspace"
                  value={defaultId}
                  onChange={(e) => setDefaultId(e.target.value)}
                  className="mt-2 w-full max-w-lg rounded-xl border border-white/[0.1] bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-400/40 focus:ring-2 focus:ring-purple-400/35"
                >
                  <option value="">No default (pick per session)</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
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

          {workspaces.length > 0 ? (
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
