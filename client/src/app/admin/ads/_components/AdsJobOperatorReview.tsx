"use client"

import { useCallback, useEffect, useState } from "react"
import { ApiError, api } from "@/lib/api"

export type AdsOperatorReviewState = {
  preferredJobId: string | null
  isPreferred: boolean
  approved: boolean
  favorite: boolean
  rootJobId: string
}

type AdsJobOperatorReviewProps = {
  jobId: string | null
  onAfterChange?: () => void | Promise<void>
  /** Buttons only — for embedding in compare panels. */
  compact?: boolean
}

function parseOperatorReview(data: unknown): AdsOperatorReviewState | null {
  if (!data || typeof data !== "object") return null
  const o = data as Record<string, unknown>
  const r = o.operatorReview
  if (!r || typeof r !== "object") return null
  const x = r as Record<string, unknown>
  return {
    preferredJobId:
      typeof x.preferredJobId === "string" ? x.preferredJobId : null,
    isPreferred: x.isPreferred === true,
    approved: x.approved === true,
    favorite: x.favorite === true,
    rootJobId: typeof x.rootJobId === "string" ? x.rootJobId : "",
  }
}

export default function AdsJobOperatorReview({
  jobId,
  onAfterChange,
  compact = false,
}: AdsJobOperatorReviewProps) {
  const [review, setReview] = useState<AdsOperatorReviewState | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!jobId) {
      setReview(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<Record<string, unknown>>(`/ads/${jobId}`, {
        silent: true,
      })
      const parsed = parseOperatorReview(res)
      setReview(parsed)
    } catch (e: unknown) {
      let msg = "Could not load operator review"
      if (e instanceof ApiError) {
        const d = e.data as { message?: string } | undefined
        msg =
          (typeof d?.message === "string" && d.message.trim()
            ? d.message
            : e.message) || msg
      }
      setError(msg)
      setReview(null)
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    void load()
  }, [load])

  const patch = useCallback(
    async (body: {
      preferred?: boolean
      approved?: boolean
      favorite?: boolean
    }) => {
      if (!jobId) return
      setSaving(true)
      setError(null)
      try {
        await api.patch(`/ads/${jobId}/operator-review`, body)
        await load()
        await onAfterChange?.()
      } catch (e: unknown) {
        let msg = "Update failed"
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
      } finally {
        setSaving(false)
      }
    },
    [jobId, load, onAfterChange]
  )

  if (!jobId) return null

  if (loading && !review) {
    return compact ? (
      <p className="text-xs text-white/45">Loading review…</p>
    ) : (
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
        <p className="text-sm text-white/45">Loading review state…</p>
      </section>
    )
  }

  if (error && !review) {
    return compact ? (
      <p className="text-xs text-amber-200/90">{error}</p>
    ) : (
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
        <h2 className="text-sm font-semibold text-white/90">Operator review</h2>
        <p className="mt-2 text-sm text-amber-200/90">{error}</p>
        <p className="mt-1 text-xs text-white/45">
          Admin-only. Sign in as an admin to set preferred / approved / favorite.
        </p>
      </section>
    )
  }

  if (!review) return null

  const buttonRow = (
    <div className={`flex flex-wrap gap-2 ${compact ? "" : "mt-5"}`}>
        {review.isPreferred ? (
          <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-100">
            Preferred creative
          </span>
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={() => void patch({ preferred: true })}
            className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-100/95 hover:bg-emerald-500/18 disabled:opacity-50"
          >
            {saving ? "…" : "Set as preferred"}
          </button>
        )}
        {review.isPreferred && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void patch({ preferred: false })}
            className="rounded-full border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 disabled:opacity-50"
          >
            Clear preferred
          </button>
        )}

        <button
          type="button"
          disabled={saving}
          onClick={() => void patch({ approved: !review.approved })}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
            review.approved
              ? "border-sky-400/40 bg-sky-500/15 text-sky-100"
              : "border-white/15 bg-white/[0.05] text-white/70 hover:bg-white/10"
          }`}
        >
          {review.approved ? "Approved ✓" : "Mark approved"}
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={() => void patch({ favorite: !review.favorite })}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
            review.favorite
              ? "border-amber-400/40 bg-amber-500/15 text-amber-100"
              : "border-white/15 bg-white/[0.05] text-white/70 hover:bg-white/10"
          }`}
        >
          {review.favorite ? "Favorite ★" : "Mark favorite"}
        </button>
    </div>
  )

  if (compact) {
    return (
      <div>
        {error && (
          <p className="mb-2 text-xs text-red-300/90">{error}</p>
        )}
        {buttonRow}
      </div>
    )
  }

  return (
    <section className="rounded-2xl border border-white/[0.12] bg-white/[0.03] p-6">
      <h2 className="text-lg font-semibold text-white">Operator review</h2>
      <p className="mt-1 text-sm text-white/50">
        Preferred is one winner per lineage (stored on root{" "}
        <code className="text-xs text-white/55">{review.rootJobId}</code>).
        Approved and favorite are per job.
      </p>

      {error && (
        <p className="mt-3 text-sm text-red-300/90">{error}</p>
      )}

      {buttonRow}
    </section>
  )
}
