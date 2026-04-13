"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { AdsJobRecord } from "@/hooks/useAdsJobPolling"
import { useAdsJobPolling } from "@/hooks/useAdsJobPolling"
import { ApiError, api, LONG_REQUEST_TIMEOUT_MS } from "@/lib/api"
import { normalizeToolOperation } from "@/lib/tool-operation"
import { downloadMediaBlob, filenameFromPublicPath } from "@/lib/mediaOrigin"
import {
  formatBreakdownLines,
  parseStoredAdScript,
  resolveVariantMeta,
  variantRerenderable,
  type ParsedStoredAdScript,
  type StoredAdVariant,
} from "./adJobStoredScript"
import AdsDualVariantCompare, {
  readRenderedVariantRowsForCompare,
} from "./AdsDualVariantCompare"
import AdsJobLineagePanel from "./AdsJobLineagePanel"
import AdsJobOperatorReview from "./AdsJobOperatorReview"

/** Matches main ad job worker progress bands (see admin ads page). */
function stageFromProgressRerender(p: number) {
  if (p < 18) return "Analyzing website structure"
  if (p < 30) return "Preparing variant render"
  if (p < 41) return "Generating AI voiceover"
  if (p < 52) return "Capturing website (browser)"
  if (p < 57) return "Building cinematic timeline (encode)"
  if (p < 71) return "Color grading & audio mix"
  if (p < 100) return "Final video render"
  return "Finishing render"
}

type AdsJobReviewPanelProps = {
  jobId: string | null
  jobRecord: AdsJobRecord | null
  videoUrl: string | null
  normalizeOutputUrl: (url: string) => string
  loading?: boolean
  /** Open another job in this admin view (e.g. lineage navigation). */
  onOpenJob?: (jobId: string) => void | Promise<void>
  /** Reload current job after operator review PATCH (e.g. refresh `jobRecord`). */
  onOperatorReviewChange?: () => void | Promise<void>
}

function sceneSummaryFromPlan(scenePlan: unknown): string {
  if (!Array.isArray(scenePlan)) return ""
  const parts: string[] = []
  for (const item of scenePlan.slice(0, 16)) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const cap = typeof o.caption === "string" ? o.caption : ""
    const page = typeof o.page === "string" ? o.page : ""
    const t = typeof o.type === "string" ? o.type : ""
    const visual = typeof o.visual === "string" ? o.visual : ""
    const line = [t, cap, visual, page].filter(Boolean).join(" · ")
    if (line) parts.push(line)
  }
  return parts.join("\n")
}

function pickWinnerVariant(
  script: ParsedStoredAdScript | null
): { winner: StoredAdVariant | null; primaryAsFallback: boolean } {
  if (!script) return { winner: null, primaryAsFallback: false }
  const id = script.selectedVariantId ?? script.variantId
  if (script.adVariants?.length && id) {
    const found = script.adVariants.find(v => v.id === id)
    if (found) return { winner: found, primaryAsFallback: false }
  }
  if (script.adVariants?.length === 1) {
    return { winner: script.adVariants[0]!, primaryAsFallback: false }
  }
  /* Legacy: no adVariants — treat rendered script as single variant */
  if (!script.adVariants?.length && (script.hook || script.cta)) {
    return {
      winner: {
        id: script.variantId ?? "primary",
        label: script.variantLabel ?? "Rendered script",
        hook: script.hook,
        cta: script.cta,
        narration: script.narration,
        scoreBreakdown: undefined,
      },
      primaryAsFallback: true,
    }
  }
  return { winner: null, primaryAsFallback: false }
}

function readJobLineage(jobRecord: AdsJobRecord | null): {
  rerenderOfJobId?: string
  sourceVariantId?: string
  rerenderReason?: string
} | null {
  const m = jobRecord?.metadata
  if (!m || typeof m !== "object") return null
  const o = m as Record<string, unknown>
  return {
    rerenderOfJobId:
      typeof o.rerenderOfJobId === "string" ? o.rerenderOfJobId : undefined,
    sourceVariantId:
      typeof o.sourceVariantId === "string" ? o.sourceVariantId : undefined,
    rerenderReason:
      typeof o.rerenderReason === "string" ? o.rerenderReason : undefined,
  }
}

function readJobFastPreview(jobRecord: AdsJobRecord | null): boolean {
  const m = jobRecord?.metadata
  if (!m || typeof m !== "object") return false
  return (m as Record<string, unknown>).fastPreview === true
}

export default function AdsJobReviewPanel({
  jobId,
  jobRecord,
  videoUrl,
  normalizeOutputUrl,
  loading,
  onOpenJob,
  onOperatorReviewChange,
}: AdsJobReviewPanelProps) {
  const [reviewTick, setReviewTick] = useState(0)
  const [rerenderReason, setRerenderReason] = useState("")
  const [rerenderFastPreview, setRerenderFastPreview] = useState(false)
  const [rerenderPosting, setRerenderPosting] = useState(false)

  /** Scoped per job under review so rerender progress does not leak across lineage navigation. */
  const rerenderStorageKey = jobId
    ? `vf:admin-ads:rerender-from:${jobId}`
    : "vf:admin-ads:rerender-job"

  const rerender = useAdsJobPolling({
    storageKey: rerenderStorageKey,
    normalizeOutputUrl,
    stageFromProgress: stageFromProgressRerender,
    cancelPath: jid => `/ads/${jid}/cancel`,
  })

  useEffect(() => {
    void rerender.resume()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const script = useMemo(
    () => parseStoredAdScript(jobRecord?.script),
    [jobRecord?.script]
  )

  const scenePlan = jobRecord?.scenePlan
  const sceneSummary = useMemo(
    () => sceneSummaryFromPlan(scenePlan),
    [scenePlan]
  )

  const { winner, primaryAsFallback } = useMemo(
    () => pickWinnerVariant(script),
    [script]
  )

  const winnerId = script?.selectedVariantId ?? script?.variantId ?? winner?.id

  const [focusVariantId, setFocusVariantId] = useState<string | null>(null)

  useEffect(() => {
    setFocusVariantId(null)
  }, [jobId])

  useEffect(() => {
    setRerenderFastPreview(false)
  }, [jobId])

  const focusedVariant = useMemo(() => {
    if (!script?.adVariants?.length) return winner
    const id = focusVariantId ?? winnerId
    if (!id) return winner
    return script.adVariants.find(v => v.id === id) ?? winner
  }, [focusVariantId, winnerId, script, winner])

  const statusLabel = useMemo(() => {
    const s = jobRecord?.status
    if (typeof s !== "string") return loading ? "Processing" : "—"
    if (s === "completed") return "Completed"
    if (s === "failed") return "Failed"
    return "Processing"
  }, [jobRecord?.status, loading])

  const outputUrlRaw =
    typeof jobRecord?.outputUrl === "string" ? jobRecord.outputUrl : null
  const resolvedVideo =
    videoUrl ??
    (outputUrlRaw ? normalizeOutputUrl(outputUrlRaw) : null)

  const lineage = useMemo(() => readJobLineage(jobRecord), [jobRecord])
  const isFastPreviewJob = useMemo(
    () => readJobFastPreview(jobRecord),
    [jobRecord]
  )

  const renderedVariantRows = useMemo(
    () => readRenderedVariantRowsForCompare(jobRecord),
    [jobRecord]
  )

  const showDualVariantCompare = Boolean(
    jobId &&
      renderedVariantRows &&
      renderedVariantRows.length >= 2
  )

  const startRerenderFromVariant = useCallback(
    async (variantId: string) => {
      if (!jobId) return
      setRerenderPosting(true)
      rerender.setError(null)
      try {
        const res = await api.post<Record<string, unknown>>(
          `/ads/${jobId}/rerender-from-variant`,
          {
            variantId,
            rerenderReason: rerenderReason.trim() || undefined,
            ...(rerenderFastPreview ? { previewMode: "fast" as const } : {}),
          },
          { timeout: LONG_REQUEST_TIMEOUT_MS }
        )
        const operation = normalizeToolOperation<{ jobId?: string }>(res)
        if (!operation.success || !operation.jobId) {
          throw new Error(operation.message || "Rerender request failed")
        }
        rerender.begin(operation.jobId, operation.requestId)
      } catch (e: unknown) {
        let msg = "Rerender failed"
        if (e instanceof ApiError) {
          const d = e.data as { message?: string } | undefined
          msg = (typeof d?.message === "string" && d.message.trim()
            ? d.message
            : e.message) || msg
        } else if (e instanceof Error) {
          msg = e.message
        }
        rerender.setError(msg)
      } finally {
        setRerenderPosting(false)
      }
    },
    [jobId, rerender, rerenderReason, rerenderFastPreview]
  )

  const copyExport = useCallback(() => {
    const payload = {
      jobId,
      platform: jobRecord?.platform,
      tone: jobRecord?.tone,
      duration: jobRecord?.duration,
      selectedVariantId: script?.selectedVariantId,
      focusVariantId: focusVariantId ?? winnerId,
      script,
      scenePlan: jobRecord?.scenePlan,
    }
    void navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
  }, [jobId, jobRecord, script, focusVariantId, winnerId])

  const copyPlainScript = useCallback(() => {
    const v = focusedVariant ?? winner
    const lines = [
      v?.hook && `Hook: ${v.hook}`,
      v?.cta && `CTA: ${v.cta}`,
      v?.narration && `Narration:\n${v.narration}`,
      sceneSummary && `Scene summary:\n${sceneSummary}`,
    ].filter(Boolean)
    void navigator.clipboard.writeText(lines.join("\n\n"))
  }, [focusedVariant, winner, sceneSummary])

  const downloadName = (() => {
    if (!resolvedVideo) return "video.mp4"
    try {
      return filenameFromPublicPath(new URL(resolvedVideo).pathname)
    } catch {
      return "video.mp4"
    }
  })()

  const scoreSelection = script?.scoreSelection
  const thresholdGate =
    typeof scoreSelection?.usedThresholdGate === "boolean"
      ? scoreSelection.usedThresholdGate
      : null

  const awaitingJobPayload =
    Boolean(loading) && !jobRecord && !resolvedVideo && Boolean(jobId)

  if (!jobId) return null
  if (!jobRecord && !resolvedVideo && !awaitingJobPayload) return null

  if (awaitingJobPayload) {
    return (
      <div className="mt-10 space-y-6">
        <section className="rounded-2xl border border-white/[0.12] bg-white/[0.03] p-6">
          <h2 className="text-sm font-semibold text-white/90">Job in progress</h2>
          <p className="mt-2 text-sm text-white/55">
            Loading details for{" "}
            <code className="rounded bg-black/35 px-1.5 py-0.5 text-xs text-white/75">
              {jobId}
            </code>
            … Script, output, and lineage appear after the next status update.
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="mt-10 space-y-8">
      {onOpenJob && jobId && (
        <AdsJobLineagePanel
          jobId={jobId}
          currentJobId={jobId}
          onOpenJob={jid => void onOpenJob(jid)}
          refreshKey={reviewTick}
        />
      )}

      {lineage?.rerenderOfJobId && (
        <section className="rounded-2xl border border-cyan-500/25 bg-cyan-500/[0.06] p-5">
          <h2 className="text-sm font-semibold text-cyan-100/95">
            Rerender job
          </h2>
          <p className="mt-2 text-sm text-white/70">
            Derived from job{" "}
            <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs text-white/85">
              {lineage.rerenderOfJobId}
            </code>
            {lineage.sourceVariantId ? (
              <>
                {" "}
                · variant{" "}
                <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">
                  {lineage.sourceVariantId}
                </code>
              </>
            ) : null}
          </p>
          {lineage.rerenderReason ? (
            <p className="mt-2 text-xs text-white/50">
              Reason: {lineage.rerenderReason}
            </p>
          ) : null}
        </section>
      )}

      {/* Render / output */}
      <section className="rounded-2xl border border-white/[0.12] bg-white/[0.03] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight text-white">
                Render output
              </h2>
              {isFastPreviewJob ? (
                <span
                  className="rounded-full border border-amber-400/35 bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100/95"
                  title="This job used fast preview capture/encode settings"
                >
                  Fast preview
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-white/55">
              Status:{" "}
              <span className="text-white/85">{statusLabel}</span>
              {typeof jobRecord?.progress === "number" && (
                <span className="text-white/45">
                  {" "}
                  · {jobRecord.progress}%
                </span>
              )}
            </p>
          </div>
          {jobId && (
            <code className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white/55">
              {jobId}
            </code>
          )}
        </div>

        {jobId && renderedVariantRows && renderedVariantRows.length >= 2 ? (
          <AdsDualVariantCompare
            jobId={jobId}
            script={script}
            rows={renderedVariantRows}
            normalizeOutputUrl={normalizeOutputUrl}
            downloadBaseName={downloadName}
            onOperatorReviewChange={async () => {
              setReviewTick(t => t + 1)
              await onOperatorReviewChange?.()
            }}
            onRerenderVariant={id => void startRerenderFromVariant(id)}
            rerenderPosting={rerenderPosting}
          />
        ) : resolvedVideo ? (
          <div className="mt-5 space-y-4">
            <video
              src={resolvedVideo}
              controls
              playsInline
              preload="metadata"
              className="w-full max-w-2xl rounded-xl border border-white/10"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(resolvedVideo)}
                className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-medium text-white/85 hover:bg-white/[0.1]"
              >
                Copy video URL
              </button>
              <button
                type="button"
                onClick={() =>
                  void downloadMediaBlob(resolvedVideo, downloadName)
                }
                className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-medium text-white/85 hover:bg-white/[0.1]"
              >
                Download
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-white/50">
            {loading
              ? "Video will appear here when the render finishes."
              : "No output video URL on this job (failed early or legacy)."}
          </p>
        )}
      </section>

      {jobId && !showDualVariantCompare && (
        <AdsJobOperatorReview
          jobId={jobId}
          onAfterChange={async () => {
            setReviewTick(t => t + 1)
            await onOperatorReviewChange?.()
          }}
        />
      )}

      {(script?.adVariants?.length ?? 0) > 0 && (
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-white/45">
            Optional note for next rerender
          </label>
          <input
            type="text"
            value={rerenderReason}
            onChange={e => setRerenderReason(e.target.value)}
            placeholder="e.g. Client asked for proof-led cut"
            className="mt-2 w-full max-w-xl rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm text-white/90 placeholder:text-white/35"
          />
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-500/15 bg-amber-500/[0.05] px-3 py-2.5">
            <input
              type="checkbox"
              checked={rerenderFastPreview}
              onChange={e => setRerenderFastPreview(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="text-sm font-medium text-amber-100/90">
                Fast preview rerender
              </span>
              <span className="mt-0.5 block text-xs text-white/50">
                Sends{" "}
                <code className="rounded bg-black/35 px-1 text-[10px] text-white/70">
                  {`previewMode: "fast"`}
                </code>{" "}
                for quicker runs. Default off — use normal quality unless you are
                iterating.
              </span>
            </span>
          </label>
        </section>
      )}

      {/* Why this won */}
      {script &&
        (script.adVariants?.length ||
          script.scoreSelection ||
          primaryAsFallback) && (
        <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-6">
          <h2 className="text-lg font-semibold text-white">Why this variant won</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {thresholdGate !== null ? (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  thresholdGate
                    ? "bg-emerald-500/20 text-emerald-200"
                    : "bg-amber-500/15 text-amber-100"
                }`}
              >
                {thresholdGate
                  ? "Threshold gate: ON (eligible set)"
                  : "Threshold gate: OFF (no variant met all floors)"}
              </span>
            ) : (
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/55">
                Threshold gate: not stored
              </span>
            )}
          </div>
          {scoreSelection?.note && (
            <p className="mt-3 text-sm leading-relaxed text-white/75">
              {scoreSelection.note}
            </p>
          )}
          {!scoreSelection?.note && primaryAsFallback && (
            <p className="mt-3 text-sm text-white/55">
              Legacy or single-script job: no stored selection note. Rendered
              script is shown as the primary variant.
            </p>
          )}
          {!scoreSelection?.note &&
            !primaryAsFallback &&
            script.adVariants &&
            script.adVariants.length > 0 && (
              <p className="mt-3 text-sm text-white/55">
                Selection note missing on stored payload; scores and winner id
                still shown in the table.
              </p>
            )}
        </section>
      )}

      {/* Winner card */}
      {winner && (
        <section className="rounded-2xl border border-purple-500/25 bg-gradient-to-br from-purple-500/[0.08] to-transparent p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Winning variant</h2>
            <button
              type="button"
              onClick={() => setFocusVariantId(null)}
              className="text-xs font-medium text-purple-200/90 hover:text-white"
            >
              Preview winner
            </button>
          </div>
          <WinnerCardBody variant={winner} isLegacy={primaryAsFallback} />
        </section>
      )}

      {/* Comparison table */}
      {script?.adVariants && script.adVariants.length > 0 && (
        <section className="rounded-2xl border border-white/[0.12] bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">
                All variants
              </h2>
              <p className="mt-1 text-sm text-white/50">
                Compare scores without re-running the pipeline. Focus changes what
                you inspect below — it does not switch the rendered video until
                rerender exists.
              </p>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-white/45">
                  <th className="py-2 pr-3 font-medium">Variant</th>
                  <th className="py-2 pr-3 font-medium">Total</th>
                  <th className="py-2 pr-3 font-medium">Floors</th>
                  <th className="py-2 pr-3 font-medium">Mode / emphasis</th>
                  <th className="py-2 pr-3 font-medium">Hook</th>
                  <th className="py-2 font-medium">Inspect / rerender</th>
                </tr>
              </thead>
              <tbody>
                {script.adVariants.map((v, rowIdx) => {
                  const isWinner = v.id === winnerId
                  const canRerender = variantRerenderable(v) && Boolean(v.id)
                  const meta = resolveVariantMeta(v)
                  const total =
                    typeof v.totalScore === "number"
                      ? v.totalScore
                      : typeof v.score === "number"
                        ? v.score
                        : null
                  const pass =
                    typeof v.passesThresholds === "boolean"
                      ? v.passesThresholds
                      : null
                  const focused = (focusVariantId ?? winnerId) === v.id
                  return (
                    <tr
                      key={v.id ?? v.label ?? `row-${rowIdx}`}
                      className={`border-b border-white/[0.06] ${
                        isWinner ? "bg-purple-500/[0.07]" : ""
                      }`}
                    >
                      <td className="py-3 pr-3 align-top">
                        <span className="font-medium text-white/90">
                          {v.label ?? v.id ?? "—"}
                        </span>
                        {isWinner && (
                          <span className="ml-2 rounded bg-purple-500/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-purple-100">
                            Winner
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-3 align-top text-white/80">
                        {total !== null ? Math.round(total) : "—"}
                      </td>
                      <td className="py-3 pr-3 align-top">
                        {pass === null ? (
                          <span className="text-white/40">—</span>
                        ) : pass ? (
                          <span className="text-emerald-300/95">Pass</span>
                        ) : (
                          <span className="text-amber-200/90">Fail</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 align-top text-xs text-white/65">
                        <div>{meta.narrativeMode}</div>
                        <div className="text-white/45">{meta.emphasis}</div>
                      </td>
                      <td className="max-w-[200px] py-3 pr-3 align-top text-xs text-white/55">
                        {v.hook
                          ? v.hook.slice(0, 120) + (v.hook.length > 120 ? "…" : "")
                          : "—"}
                      </td>
                      <td className="py-3 align-top">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setFocusVariantId(v.id ?? null)}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
                              focused
                                ? "border-purple-400/50 bg-purple-500/20 text-white"
                                : "border-white/12 bg-white/[0.05] text-white/75 hover:bg-white/[0.09]"
                            }`}
                          >
                            Inspect
                          </button>
                          <button
                            type="button"
                            disabled={
                              !canRerender ||
                              rerenderPosting ||
                              rerender.state.loading ||
                              !jobId
                            }
                            title={
                              !canRerender
                                ? "Variant is missing hook, CTA, scenes, or voice text needed for rerender"
                                : undefined
                            }
                            onClick={() =>
                              v.id
                                ? void startRerenderFromVariant(v.id)
                                : undefined
                            }
                            className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-100/95 hover:bg-amber-500/18 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {rerenderPosting ? "…" : "Rerender"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Focused detail */}
      {(focusedVariant || script) && (
        <section className="rounded-2xl border border-white/[0.12] bg-black/20 p-6">
          <h2 className="text-lg font-semibold text-white">
            Variant detail
            {focusVariantId && (
              <span className="ml-2 text-sm font-normal text-amber-200/90">
                (inspecting alternate — not rendered)
              </span>
            )}
          </h2>
          {focusedVariant && (
            <VariantDetailExpandable variant={focusedVariant} />
          )}
        </section>
      )}

      {/* Scene summary */}
      {sceneSummary ? (
        <section className="rounded-2xl border border-white/[0.12] bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold text-white">Stored scene summary</h2>
          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/35 p-4 text-xs leading-relaxed text-white/70">
            {sceneSummary}
          </pre>
        </section>
      ) : (
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
          <h2 className="text-lg font-semibold text-white/80">Stored scene summary</h2>
          <p className="mt-2 text-sm text-white/45">
            No scene plan on this job (older run or failed before scenes).
          </p>
        </section>
      )}

      {/* Rerender job progress (separate from main job) */}
      {(rerender.state.loading ||
        rerender.state.videoUrl ||
        rerender.state.error) && (
        <section className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">
              Rerender run
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {rerender.state.jobId && (
                <code className="text-[11px] text-white/55">{rerender.state.jobId}</code>
              )}
              {!rerender.state.loading &&
                (rerender.state.videoUrl || rerender.state.error) && (
                  <button
                    type="button"
                    onClick={() => rerender.dismissTrackedRun()}
                    className="text-[11px] font-medium text-white/45 underline decoration-white/25 hover:text-white/75"
                  >
                    Hide
                  </button>
                )}
            </div>
          </div>
          {rerender.state.loading && (
            <div className="mt-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
                  style={{ width: `${rerender.state.progress}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-white/60">
                {rerender.state.stageText} · {rerender.state.progress}%
              </p>
              <button
                type="button"
                onClick={() => void rerender.cancel()}
                className="mt-3 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
              >
                Cancel rerender
              </button>
            </div>
          )}
          {rerender.state.error && (
            <p className="mt-3 text-sm text-red-300/95">{rerender.state.error}</p>
          )}
          {rerender.state.videoUrl && !rerender.state.loading && (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-emerald-200/90">Rerender completed.</p>
              <video
                src={rerender.state.videoUrl}
                controls
                playsInline
                preload="metadata"
                className="w-full max-w-xl rounded-xl border border-white/10"
              />
              <div className="flex flex-wrap gap-2">
                {onOpenJob && rerender.state.jobId ? (
                  <button
                    type="button"
                    onClick={() => void onOpenJob(rerender.state.jobId!)}
                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-100/95 hover:bg-emerald-500/22"
                  >
                    Open rerender job
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard.writeText(rerender.state.videoUrl!)
                  }
                  className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-xs text-white/85"
                >
                  Copy rerender video URL
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void downloadMediaBlob(
                      rerender.state.videoUrl!,
                      "ad-rerender.mp4"
                    )
                  }
                  className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-xs text-white/85"
                >
                  Download
                </button>
              </div>
              <p className="text-[11px] text-white/45">
                Use &ldquo;Open rerender job&rdquo; for full review, lineage, and
                operator flags on the new job.
              </p>
            </div>
          )}
        </section>
      )}

      {/* Operator actions */}
      <section className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void copyPlainScript()}
          className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-medium text-white/85 hover:bg-white/[0.1]"
        >
          Copy script + scene summary
        </button>
        <button
          type="button"
          onClick={() => void copyExport()}
          className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-medium text-white/85 hover:bg-white/[0.1]"
        >
          Copy full JSON export
        </button>
      </section>
    </div>
  )
}

function WinnerCardBody({
  variant,
  isLegacy,
}: {
  variant: StoredAdVariant
  isLegacy: boolean
}) {
  const meta = resolveVariantMeta(variant)
  const total =
    typeof variant.totalScore === "number"
      ? variant.totalScore
      : typeof variant.score === "number"
        ? variant.score
        : null
  const pass =
    typeof variant.passesThresholds === "boolean"
      ? variant.passesThresholds
      : null

  return (
    <div className="mt-4 space-y-4 text-sm">
      {isLegacy && (
        <p className="text-xs text-white/45">
          Metadata may be incomplete on legacy jobs.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-white/40">
            Narrative mode
          </div>
          <div className="mt-1 text-white/85">{meta.narrativeMode}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-white/40">
            Emphasis
          </div>
          <div className="mt-1 text-white/85">{meta.emphasis}</div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-white/40">
            Total score
          </div>
          <div className="mt-1 text-lg font-semibold text-white">
            {total !== null ? Math.round(total) : "—"}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-white/40">
            Floors
          </div>
          <div className="mt-1">
            {pass === null ? (
              <span className="text-white/45">—</span>
            ) : pass ? (
              <span className="text-emerald-300">Pass</span>
            ) : (
              <span className="text-amber-200">Fail</span>
            )}
          </div>
        </div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wide text-white/40">Hook</div>
        <p className="mt-1 leading-relaxed text-white/80">{variant.hook ?? "—"}</p>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wide text-white/40">CTA</div>
        <p className="mt-1 leading-relaxed text-white/80">{variant.cta ?? "—"}</p>
      </div>
    </div>
  )
}

function VariantDetailExpandable({ variant }: { variant: StoredAdVariant }) {
  const [open, setOpen] = useState(true)
  const lines = formatBreakdownLines(variant.scoreBreakdown)

  return (
    <div className="mt-4 space-y-4">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-xs font-medium text-white/55 hover:text-white/80"
      >
        {open ? "▼" : "▶"} Scoring & notes
      </button>
      {open && (
        <>
          {lines.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <div className="text-[11px] uppercase tracking-wide text-white/40">
                Score breakdown (weighted dimensions)
              </div>
              <ul className="mt-2 grid gap-1 text-xs text-white/75 sm:grid-cols-2">
                {lines.map(line => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {variant.explanation && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-white/40">
                Explanation
              </div>
              <p className="mt-1 text-sm leading-relaxed text-white/75">
                {variant.explanation}
              </p>
            </div>
          )}
          {variant.heuristicNotes && variant.heuristicNotes.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-white/40">
                Heuristic notes
              </div>
              <ul className="mt-2 list-inside list-disc text-xs text-white/65">
                {variant.heuristicNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          {variant.heuristicAdjustmentSummary && (
            <p className="text-xs text-white/50">
              {variant.heuristicAdjustmentSummary}
            </p>
          )}
          {variant.narration && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-white/40">
                Narration
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-white/70">
                {variant.narration}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
