"use client"

import { useCallback, useEffect, useState } from "react"
import { api, ApiError } from "@/lib/api"

export type AdminAdJobListRow = {
  jobId: string
  status: string
  createdAt: string
  updatedAt: string
  hasOutput: boolean
  kind: "original" | "rerender"
  rerenderOfJobId: string | null
  rootJobId: string
  preferredJobId: string | null
  isPreferred: boolean
  operatorApproved: boolean
  operatorFavorite: boolean
  /** From job metadata; true when this run used fast preview capture/encode. */
  fastPreview?: boolean
}

function shortId(id: string) {
  if (id.length <= 14) return id
  return `${id.slice(0, 8)}…`
}

type AdsAdminJobsListProps = {
  refreshKey?: number
  currentJobId?: string | null
  onOpenJob: (jobId: string) => void | Promise<void>
}

export default function AdsAdminJobsList({
  refreshKey = 0,
  currentJobId,
  onOpenJob,
}: AdsAdminJobsListProps) {
  const [rows, setRows] = useState<AdminAdJobListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await api.get<{
        success?: boolean
        jobs?: AdminAdJobListRow[]
      }>("/admin/ad-jobs?limit=50")
      setRows(Array.isArray(res.jobs) ? res.jobs : [])
    } catch (e: unknown) {
      setRows([])
      setError(e instanceof ApiError ? e.message : "Failed to load jobs")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  return (
    <section className="mt-12 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white/90">Recent ad jobs</h2>
          <p className="mt-1 text-xs text-white/45">
            Scan status, output, lineage, and operator review flags. Click a job id to open it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 hover:bg-white/10"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-300/90" role="alert">
          {error}
        </p>
      )}

      {loading && !rows.length ? (
        <p className="mt-6 text-sm text-white/45">Loading…</p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] text-[10px] font-semibold uppercase tracking-wide text-white/40">
                <th className="pb-2 pr-3">Job</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2 pr-3">Output</th>
                <th className="pb-2 pr-3">Lineage</th>
                <th className="pb-2 pr-3">Root</th>
                <th className="pb-2">Review</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const isCurrent = currentJobId && row.jobId === currentJobId
                return (
                  <tr
                    key={row.jobId}
                    className={`border-b border-white/[0.06] ${
                      isCurrent ? "bg-purple-500/[0.07]" : ""
                    }`}
                  >
                    <td className="py-2.5 pr-3 align-top">
                      <button
                        type="button"
                        onClick={() => void onOpenJob(row.jobId)}
                        className={`break-all text-left font-mono hover:underline ${
                          isCurrent ? "text-purple-200" : "text-cyan-200/95"
                        }`}
                      >
                        {row.jobId}
                      </button>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-white/35">
                        <span>{new Date(row.updatedAt).toLocaleString()}</span>
                        {row.fastPreview ? (
                          <span
                            className="shrink-0 rounded-full border border-amber-400/35 bg-amber-500/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-100/95"
                            title="Fast preview render (metadata.fastPreview)"
                          >
                            Fast preview
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 align-top">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          row.status === "completed"
                            ? "bg-emerald-500/15 text-emerald-200/95"
                            : row.status === "failed"
                              ? "bg-red-500/15 text-red-200/90"
                              : "bg-white/10 text-white/70"
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 align-top">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          row.hasOutput
                            ? "bg-emerald-500/20 text-emerald-100"
                            : "bg-white/10 text-white/55"
                        }`}
                      >
                        {row.hasOutput ? "Ready" : "None"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 align-top text-white/70">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          row.kind === "original"
                            ? "bg-white/10 text-white/75"
                            : "bg-violet-500/15 text-violet-100"
                        }`}
                      >
                        {row.kind === "original" ? "Original" : "Rerender"}
                      </span>
                      {row.rerenderOfJobId ? (
                        <div className="mt-1 text-[10px] text-white/45">
                          of{" "}
                          <button
                            type="button"
                            className="font-mono text-cyan-200/80 hover:underline"
                            onClick={() => void onOpenJob(row.rerenderOfJobId!)}
                          >
                            {shortId(row.rerenderOfJobId)}
                          </button>
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3 align-top">
                      <button
                        type="button"
                        className="font-mono text-[10px] text-white/60 hover:text-cyan-200/90 hover:underline"
                        onClick={() => void onOpenJob(row.rootJobId)}
                      >
                        {shortId(row.rootJobId)}
                      </button>
                      {row.rootJobId === row.jobId ? (
                        <div className="text-[10px] text-white/35">lineage root</div>
                      ) : null}
                    </td>
                    <td className="py-2.5 align-top">
                      <div className="flex flex-wrap gap-1">
                        {row.isPreferred && (
                          <span className="rounded bg-emerald-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-100">
                            Preferred
                          </span>
                        )}
                        {row.operatorApproved && (
                          <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-100">
                            Approved
                          </span>
                        )}
                        {row.operatorFavorite && (
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-100">
                            Favorite
                          </span>
                        )}
                        {!row.isPreferred &&
                          !row.operatorApproved &&
                          !row.operatorFavorite &&
                          !(row.preferredJobId && !row.isPreferred) && (
                            <span className="text-[10px] text-white/30">—</span>
                          )}
                      </div>
                      {row.preferredJobId && !row.isPreferred ? (
                        <div className="mt-1 text-[10px] text-white/40">
                          Lineage winner:{" "}
                          <button
                            type="button"
                            className="font-mono text-emerald-200/80 hover:underline"
                            onClick={() => void onOpenJob(row.preferredJobId!)}
                          >
                            {shortId(row.preferredJobId)}
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!loading && rows.length === 0 && !error ? (
            <p className="mt-4 text-sm text-white/45">No ad jobs yet.</p>
          ) : null}
        </div>
      )}
    </section>
  )
}
