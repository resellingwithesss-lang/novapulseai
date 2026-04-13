"use client"

import { useMemo } from "react"
import type { AdsJobRecord } from "@/hooks/useAdsJobPolling"
import { downloadMediaBlob } from "@/lib/mediaOrigin"
import {
  formatBreakdownLines,
  parseStoredAdScript,
  resolveVariantMeta,
  variantRerenderable,
  type ParsedStoredAdScript,
  type StoredAdVariant,
} from "./adJobStoredScript"
import AdsJobOperatorReview from "./AdsJobOperatorReview"

type RenderedRow = {
  variantId: string
  rank: 1 | 2
  outputUrl?: string
  score?: number
  status: "completed" | "failed"
  failedReason?: string
}

function variantById(
  script: ParsedStoredAdScript | null,
  id: string
): StoredAdVariant | null {
  if (!script?.adVariants?.length) return null
  return script.adVariants.find(v => v.id === id) ?? null
}

function winnerVsRunnerSummary(
  winner: StoredAdVariant | null,
  runner: StoredAdVariant | null
): string {
  if (!winner || !runner) {
    return "Compare total score and dimensions below. Selection uses the same tie-breakers as generation (hook → payoff → CTA → specificity)."
  }
  const a = winner.totalScore ?? winner.score ?? 0
  const b = runner.totalScore ?? runner.score ?? 0
  const diff = Math.round(a - b)
  const parts: string[] = []
  if (diff > 0) {
    parts.push(`Winner is +${diff} points on total score.`)
  } else if (diff === 0) {
    parts.push("Total scores are tied; generation used tie-break dimensions (hook, payoff, CTA, specificity, preset order).")
  }
  const bd = winner.scoreBreakdown
  const bd2 = runner.scoreBreakdown
  if (bd && bd2) {
    const keys: (keyof NonNullable<typeof bd>)[] = [
      "hook",
      "payoff",
      "cta",
      "pacing",
      "specificity",
    ]
    const deltas: string[] = []
    for (const k of keys) {
      const d = (bd[k] ?? 0) - (bd2[k] ?? 0)
      if (d >= 2) deltas.push(`${k} +${Math.round(d)}`)
    }
    if (deltas.length) {
      parts.push(`Stronger on: ${deltas.slice(0, 5).join(", ")}.`)
    }
  }
  if (winner.explanation && parts.length < 2) {
    const ex = winner.explanation.trim()
    if (ex.length) {
      parts.push(ex.length > 220 ? `${ex.slice(0, 217)}…` : ex)
    }
  }
  return parts.join(" ") || "Winner ranks higher on the weighted scorecard."
}

type AdsDualVariantCompareProps = {
  jobId: string
  script: ParsedStoredAdScript | null
  rows: RenderedRow[]
  normalizeOutputUrl: (url: string) => string
  /** Base name for downloads (from primary output URL). */
  downloadBaseName: string
  onOperatorReviewChange?: () => void | Promise<void>
  onRerenderVariant: (variantId: string) => void | Promise<void>
  rerenderPosting: boolean
}

export default function AdsDualVariantCompare({
  jobId,
  script,
  rows,
  normalizeOutputUrl,
  downloadBaseName,
  onOperatorReviewChange,
  onRerenderVariant,
  rerenderPosting,
}: AdsDualVariantCompareProps) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.rank - b.rank),
    [rows]
  )

  const w1 = variantById(script, sorted[0]?.variantId ?? "")
  const w2 = variantById(script, sorted[1]?.variantId ?? "")
  const summary = useMemo(() => winnerVsRunnerSummary(w1, w2), [w1, w2])

  return (
    <div className="mt-5 space-y-5">
      <div className="rounded-xl border border-white/[0.1] bg-gradient-to-br from-emerald-500/[0.07] to-violet-500/[0.05] p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-white/55">
          Why #1 beat #2
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-white/80">{summary}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        {sorted.map(row => {
          const v = variantById(script, row.variantId)
          const meta = v ? resolveVariantMeta(v) : { narrativeMode: "—", emphasis: "—" }
          const label = row.rank === 1 ? "Winner" : "Runner-up"
          const sub =
            row.rank === 1 ? "Rank 1 · primary output" : "Rank 2 · runner-up render"
          const borderClass =
            row.rank === 1
              ? "border-emerald-500/35 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]"
              : "border-violet-500/30 shadow-[0_0_0_1px_rgba(139,92,246,0.1)]"
          const headBg =
            row.rank === 1 ? "bg-emerald-950/40" : "bg-violet-950/35"

          const url =
            row.outputUrl && row.status === "completed"
              ? normalizeOutputUrl(row.outputUrl)
              : null

          const canRerender = v ? variantRerenderable(v) : false
          const breakdown = formatBreakdownLines(v?.scoreBreakdown ?? v?.llmBreakdown)

          return (
            <div
              key={`${row.rank}-${row.variantId}`}
              className={`flex flex-col overflow-hidden rounded-xl border ${borderClass} bg-black/25`}
            >
              <div
                className={`sticky top-0 z-20 border-b border-white/[0.08] px-4 py-3 ${headBg} backdrop-blur-md`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-white">
                      {label}
                    </h3>
                    <p className="text-[11px] text-white/50">{sub}</p>
                  </div>
                  {typeof row.score === "number" ? (
                    <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-sm font-semibold text-white/90">
                      {row.score}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 font-mono text-[11px] text-cyan-200/85">
                  {row.variantId}
                </p>
              </div>

              <div className="space-y-3 p-4">
                {url ? (
                  <video
                    src={url}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full rounded-lg border border-white/10"
                  />
                ) : (
                  <p className="text-sm text-red-300/90">
                    {row.failedReason || "Render failed"}
                  </p>
                )}

                {url ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(url)}
                      className="rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-medium text-white/85 hover:bg-white/[0.1]"
                    >
                      Copy URL
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void downloadMediaBlob(
                          url,
                          `${downloadBaseName.replace(/\.mp4$/i, "")}-rank${row.rank}.mp4`
                        )
                      }
                      className="rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-medium text-white/85 hover:bg-white/[0.1]"
                    >
                      Download
                    </button>
                    {canRerender ? (
                      <button
                        type="button"
                        disabled={rerenderPosting}
                        onClick={() => void onRerenderVariant(row.variantId)}
                        className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-100/95 hover:bg-amber-500/16 disabled:opacity-50"
                      >
                        Rerender from variant
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <div className="rounded-lg border border-white/[0.06] bg-black/30 p-3 text-[11px] text-white/75">
                  <p className="font-medium text-white/55">Hook</p>
                  <p className="mt-1 leading-snug text-white/85">
                    {v?.hook ?? "—"}
                  </p>
                  <p className="mt-3 font-medium text-white/55">CTA</p>
                  <p className="mt-1 leading-snug text-white/85">
                    {v?.cta ?? "—"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-white/50">
                    <span>
                      Mode:{" "}
                      <span className="text-white/75">{meta.narrativeMode}</span>
                    </span>
                    <span>
                      Emphasis:{" "}
                      <span className="text-white/75">{meta.emphasis}</span>
                    </span>
                    {v?.hookPattern ? (
                      <span>
                        Hook pattern:{" "}
                        <span className="text-white/75">{v.hookPattern}</span>
                      </span>
                    ) : null}
                  </div>
                </div>

                {breakdown.length > 0 ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">
                      Score breakdown
                    </p>
                    <ul className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10px] text-white/70">
                      {breakdown.map(line => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {v?.explanation ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">
                      Why it scored well
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-white/65">
                      {v.explanation}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-white/[0.1] bg-white/[0.03] p-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-white/45">
          Job-level review
        </p>
        <p className="mt-1 text-[11px] text-white/50">
          Preferred / approved / favorite apply to this job (and preferred to the
          lineage root). Use after you pick a creative direction.
        </p>
        <div className="mt-3">
          <AdsJobOperatorReview
            jobId={jobId}
            compact
            onAfterChange={onOperatorReviewChange}
          />
        </div>
      </div>
    </div>
  )
}

export function readRenderedVariantRowsForCompare(
  jobRecord: AdsJobRecord | null
): RenderedRow[] | null {
  const m = jobRecord?.metadata
  if (!m || typeof m !== "object") return null
  const rv = (m as Record<string, unknown>).renderedVariants
  if (!Array.isArray(rv) || rv.length < 2) return null
  const rows: RenderedRow[] = []
  for (const item of rv) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const variantId = typeof o.variantId === "string" ? o.variantId : ""
    if (!variantId) continue
    const rank = o.rank === 2 ? 2 : 1
    const status = o.status === "failed" ? "failed" : "completed"
    rows.push({
      variantId,
      rank,
      outputUrl: typeof o.outputUrl === "string" ? o.outputUrl : undefined,
      score: typeof o.score === "number" ? o.score : undefined,
      status,
      failedReason:
        typeof o.failedReason === "string" ? o.failedReason : undefined,
    })
  }
  return rows.length >= 2 ? rows.sort((a, b) => a.rank - b.rank) : null
}
