"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  fetchBrandVoices,
  fetchWorkspaces,
  type BrandVoiceDto,
  type WorkspaceDto,
} from "@/lib/workflowApi"

type Props = {
  /** When true, only workspace dropdown is shown (e.g. story video maker). */
  workspaceOnly?: boolean
  workspaceId: string
  brandVoiceId: string
  onWorkspaceChange: (id: string) => void
  onBrandVoiceChange: (id: string) => void
  disabled?: boolean
}

export default function CreatorWorkflowSelectors({
  workspaceOnly = false,
  workspaceId,
  brandVoiceId,
  onWorkspaceChange,
  onBrandVoiceChange,
  disabled = false,
}: Props) {
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([])
  const [voices, setVoices] = useState<BrandVoiceDto[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const [ws, bv] = await Promise.all([fetchWorkspaces(), fetchBrandVoices()])
      setWorkspaces(ws.workspaces ?? [])
      setVoices(bv.brandVoices ?? [])
    } catch {
      setErr("Could not load workspaces or brand voices.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filteredVoices = useMemo(() => {
    if (!workspaceId) return voices
    return voices.filter(
      (v) => !v.workspaceId || v.workspaceId === workspaceId
    )
  }, [voices, workspaceId])

  const selectCls = "np-select w-full"

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/45">
          Workflow context
        </p>
        <Link
          href="/dashboard/workspaces"
          className="text-xs text-purple-300 underline"
          tabIndex={-1}
        >
          Manage
        </Link>
      </div>
      {err && <p className="text-xs text-amber-200/90">{err}</p>}
      {loading && (
        <p className="text-xs text-white/45" aria-live="polite">
          Loading workspaces…
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-white/55">Workspace (optional)</label>
          <select
            className={selectCls}
            value={workspaceId}
            onChange={(e) => {
              onWorkspaceChange(e.target.value)
              onBrandVoiceChange("")
            }}
            disabled={disabled || loading}
          >
            <option value="">None</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        {!workspaceOnly && (
          <div>
            <label className="mb-1 block text-xs text-white/55">Brand voice (optional)</label>
            <select
              className={selectCls}
              value={brandVoiceId}
              onChange={(e) => onBrandVoiceChange(e.target.value)}
              disabled={disabled || loading}
            >
              <option value="">None</option>
              {filteredVoices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  )
}
