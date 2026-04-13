"use client"

import { useCallback, useEffect, useState } from "react"
import { ApiError, api } from "@/lib/api"
import { normalizeToolOperation } from "@/lib/tool-operation"

export type AdsLineageEntry = {
  jobId: string
  status: string
  createdAt: string
  outputUrl: string | null
  failedReason: string | null
  sourceVariantId?: string
  rerenderReason?: string
  rerenderOfJobId?: string
  relation: "parent" | "sibling" | "self" | "child"
  isPreferred?: boolean
  operatorApproved?: boolean
  operatorFavorite?: boolean
}

type LineageResult = {
  jobId: string
  role: "original" | "rerender"
  rootJobId: string
  preferredJobId: string | null
  parent: AdsLineageEntry | null
  siblings: AdsLineageEntry[]
  children: AdsLineageEntry[]
  timeline: AdsLineageEntry[]
}

type AdsJobLineagePanelProps = {
  jobId: string | null
  currentJobId: string | null
  onOpenJob: (jobId: string) => void
  /** Increment to refetch lineage (e.g. after operator review changes). */
  refreshKey?: number
}

function relationLabel(r: AdsLineageEntry["relation"]): string {
  switch (r) {
    case "parent":
      return "Source"
    case "sibling":
      return "Sibling rerender"
    case "child":
      return "Rerender"
    case "self":
      return "This job"
    default:
      return r
  }
}

export default function AdsJobLineagePanel({
  jobId,
  currentJobId,
  onOpenJob,
  refreshKey = 0,
}: AdsJobLineagePanelProps) {
  const [data, setData] = useState<LineageResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchLineage = useCallback(async () => {
    if (!jobId) {
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<Record<string, unknown>>(
        `/ads/${jobId}/lineage`,
        { silent: true }
      )
      const operation = normalizeToolOperation<LineageResult>(res)
      if (!operation.success || !operation.result) {
        throw new Error(operation.message || "Lineage unavailable")
      }
      setData(operation.result)
    } catch (e: unknown) {
      let msg = "Could not load lineage"
      if (e instanceof ApiError) {
        const d = e.data as { message?: string } | undefined
        msg =
          (typeof d?.message === "string" && d.message.trim()
            ? d.message
            : e.message) || msg
      } else if (e instanceof Error) {
        msg = e.message
      }
      setError(msg)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    void fetchLineage()
  }, [fetchLineage, refreshKey])

  if (!jobId) return null

  if (loading && !data) {
    return (
      <section className="rounded-2xl border border-white/[0.1] bg-white/[0.02] p-5">
        <p className="text-sm text-white/50">Loading creative history…</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-white/[0.1] bg-white/[0.02] p-5">
        <h2 className="text-sm font-semibold text-white/90">Creative history</h2>
        <p className="mt-2 text-sm text-amber-200/90">{error}</p>
        <p className="mt-1 text-xs text-white/45">
          Admin-only. Sign in as an admin to view lineage, or the job may lack
          linkage metadata.
        </p>
        <button
          type="button"
          onClick={() => void fetchLineage()}
          className="mt-3 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10"
        >
          Try again
        </button>
      </section>
    )
  }

  if (!data) return null

  return (
    <section className="rounded-2xl border border-white/[0.12] bg-white/[0.03] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Creative history</h2>
          <p className="mt-1 text-sm text-white/50">
            {data.role === "rerender" ? (
              <>
                This job is a{" "}
                <span className="text-amber-200/95">rerender</span>. Root
                concept:{" "}
                <button
                  type="button"
                  onClick={() => onOpenJob(data.rootJobId)}
                  className="font-mono text-cyan-200/95 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-100"
                >
                  {data.rootJobId}
                </button>
              </>
            ) : (
              <>
                This job is an{" "}
                <span className="text-emerald-200/95">original</span> generation
                {data.children.length > 0
                  ? ` · ${data.children.length} rerender(s) branched from it`
                  : ""}
                .
              </>
            )}
          </p>
          {data.preferredJobId ? (
            <p className="mt-2 text-xs text-white/55">
              Preferred output in this lineage:{" "}
              <button
                type="button"
                onClick={() => onOpenJob(data.preferredJobId!)}
                className="font-mono text-emerald-200/90 hover:text-emerald-100"
              >
                {data.preferredJobId}
              </button>
            </p>
          ) : (
            <p className="mt-2 text-xs text-white/40">
              No preferred creative selected for this lineage yet.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void fetchLineage()}
          className="text-xs font-medium text-white/45 hover:text-white/75"
        >
          Refresh
        </button>
      </div>

      {data.parent && (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="text-[11px] font-medium uppercase tracking-wide text-white/40">
            Source job
          </div>
          <LineageRow
            row={data.parent}
            currentJobId={currentJobId}
            onOpenJob={onOpenJob}
          />
        </div>
      )}

      {data.timeline.length > 0 && (
        <div className="mt-5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-white/40">
            Timeline (oldest → newest)
          </div>
          <ul className="mt-3 space-y-2">
            {data.timeline.map(row => (
              <li
                key={`${row.jobId}-${row.relation}-${row.createdAt}`}
                className={`rounded-lg border px-3 py-2.5 ${
                  row.jobId === currentJobId
                    ? "border-purple-400/35 bg-purple-500/10"
                    : "border-white/[0.08] bg-black/15"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-white/45">
                    {relationLabel(row.relation)}
                  </span>
                  <span className="text-[10px] text-white/35">
                    {new Date(row.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenJob(row.jobId)}
                    className="font-mono text-xs text-cyan-200/95 hover:text-cyan-100"
                  >
                    {row.jobId}
                  </button>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      row.status === "completed"
                        ? "bg-emerald-500/15 text-emerald-200/95"
                        : row.status === "failed"
                          ? "bg-red-500/15 text-red-200/90"
                          : "bg-white/10 text-white/70"
                    }`}
                  >
                    {row.status}
                  </span>
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
                </div>
                {row.relation !== "self" && row.sourceVariantId ? (
                  <p className="mt-1 text-[11px] text-white/50">
                    Variant:{" "}
                    <code className="text-white/70">{row.sourceVariantId}</code>
                  </p>
                ) : null}
                {row.rerenderReason ? (
                  <p className="mt-1 text-[11px] text-white/45">
                    Note: {row.rerenderReason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

    </section>
  )
}

function LineageRow({
  row,
  currentJobId,
  onOpenJob,
}: {
  row: AdsLineageEntry
  currentJobId: string | null
  onOpenJob: (jobId: string) => void
}) {
  const isCurrent = row.jobId === currentJobId
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => onOpenJob(row.jobId)}
        className={`font-mono text-sm ${
          isCurrent ? "text-purple-200" : "text-cyan-200/95 hover:text-cyan-100"
        }`}
      >
        {row.jobId}
      </button>
      <span className="ml-2 text-xs text-white/45">{row.status}</span>
      {row.sourceVariantId ? (
        <p className="mt-1 text-xs text-white/50">
          Variant:{" "}
          <code className="text-white/70">{row.sourceVariantId}</code>
        </p>
      ) : null}
      {row.rerenderReason ? (
        <p className="mt-1 text-xs text-white/45">Note: {row.rerenderReason}</p>
      ) : null}
    </div>
  )
}
