"use client"

import { useMemo, useState } from "react"
import type { AdsJobRecord } from "@/hooks/useAdsJobPolling"

export type ParsedAdVariant = {
  id: string
  label: string
  score: number | null
  hook: string
  preview: string
}

export type VariantPanelAudience = "creator" | "operator"

function readScriptRoot(jobRecord: AdsJobRecord | null): Record<string, unknown> | null {
  if (!jobRecord || typeof jobRecord !== "object") return null
  const script = (jobRecord as Record<string, unknown>).script
  if (!script || typeof script !== "object") return null
  return script as Record<string, unknown>
}

export function parseAdVariantsFromJob(jobRecord: AdsJobRecord | null): {
  variants: ParsedAdVariant[]
  selectedId: string | null
} {
  const root = readScriptRoot(jobRecord)
  if (!root) return { variants: [], selectedId: null }

  const selectedRaw = root.selectedVariantId ?? root.variantId
  const selectedId = typeof selectedRaw === "string" ? selectedRaw : null

  const raw = root.adVariants
  if (!Array.isArray(raw) || raw.length === 0) {
    return { variants: [], selectedId }
  }

  const variants: ParsedAdVariant[] = raw.map((item, index) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {}
    const id =
      typeof row.id === "string"
        ? row.id
        : typeof row.variantId === "string"
          ? row.variantId
          : `variant-${index}`
    const label =
      typeof row.label === "string" && row.label.trim()
        ? row.label.trim()
        : typeof row.variantLabel === "string" && row.variantLabel.trim()
          ? row.variantLabel.trim()
          : `Angle ${String.fromCharCode(65 + index)}`
    const scoreNum =
      typeof row.totalScore === "number"
        ? row.totalScore
        : typeof row.score === "number"
          ? row.score
          : null
    const hook = typeof row.hook === "string" ? row.hook : ""
    const narr = typeof row.narration === "string" ? row.narration : ""
    const combined = [hook, narr].filter(Boolean).join(" · ")
    const preview = combined.length > 220 ? `${combined.slice(0, 217)}…` : combined || "—"

    return {
      id,
      label,
      score: scoreNum,
      hook,
      preview: preview || "—",
    }
  })

  return { variants, selectedId }
}

function scoreLabel(score: number | null, audience: VariantPanelAudience): string {
  if (score == null || !Number.isFinite(score)) {
    return audience === "creator" ? "Strong angle" : "Unscored"
  }
  if (audience === "operator") {
    return `Score ${score.toFixed(1)}`
  }
  if (score >= 8) return "Top pick"
  if (score >= 6.5) return "Great fit"
  if (score >= 5) return "Solid option"
  return "Alternate"
}

type Props = {
  jobRecord: AdsJobRecord | null
  eliteAccess: boolean
  onUseVariant?: (variantId: string) => void
  audience?: VariantPanelAudience
}

export default function AdVariantIntelligencePanel({
  jobRecord,
  eliteAccess,
  onUseVariant,
  audience = "creator",
}: Props) {
  const { variants, selectedId } = useMemo(() => parseAdVariantsFromJob(jobRecord), [jobRecord])
  const [activeId, setActiveId] = useState<string | null>(null)

  if (!variants.length) return null

  const bestId = selectedId ?? variants[0]?.id ?? null

  const eyebrow =
    audience === "creator" ? "Your creative angles" : "Variant intelligence"
  const title =
    audience === "creator" ? "Ideas behind your ad" : "Scored ad angles from this run"
  const blurb =
    audience === "creator"
      ? "The AI explored a few directions; the highlighted card matches the video above. Tap an angle to scroll back to your spot."
      : "Each row is a distinct creative angle the engine evaluated. The highlighted card matches the render you are watching."

  return (
    <section
      id="ad-variant-intelligence"
      className="mt-10 rounded-2xl border border-violet-500/20 bg-gradient-to-b from-violet-500/[0.07] to-black/20 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-200/80">
            {eyebrow}
          </p>
          <h3 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-white/[0.97]">{title}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/55">{blurb}</p>
        </div>
        {!eliteAccess ? (
          <p className="max-w-xs rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90">
            {audience === "creator"
              ? "Elite unlocks the full AI Ad Generator — higher output limits and the same pro pipeline our team uses."
              : "Elite unlocks the full Ad Studio pipeline: more variants, dual-render compares, and higher-performing ad outputs."}
          </p>
        ) : null}
      </div>

      <ul className="mt-5 grid gap-3 md:grid-cols-2">
        {variants.map((v, index) => {
          const letter = String.fromCharCode(65 + index)
          const isBest = v.id === bestId
          const isActive = activeId === v.id || (!activeId && isBest)
          return (
            <li
              key={`${v.id}-${index}`}
              className={`rounded-xl border px-4 py-3.5 transition-colors ${
                isBest
                  ? "border-emerald-400/35 bg-emerald-500/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                  : "border-white/[0.08] bg-white/[0.03]"
              } ${isActive ? "ring-1 ring-white/15" : ""}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white/88">
                  {letter} · {v.label}
                  {isBest ? (
                    <span className="ml-2 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-100/95">
                      {audience === "creator" ? "Featured" : "Selected"}
                    </span>
                  ) : null}
                </span>
                <span className="rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[11px] font-medium text-white/70">
                  {scoreLabel(v.score, audience)}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-white/65">{v.preview}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-white/14 bg-white/[0.06] px-3 py-1.5 text-[11px] font-semibold text-white/88 hover:bg-white/[0.1]"
                  onClick={() => {
                    setActiveId(v.id)
                    onUseVariant?.(v.id)
                  }}
                >
                  {audience === "creator" ? "View with video" : "Use this angle"}
                </button>
                {audience === "operator" ? (
                  <>
                    <button
                      type="button"
                      disabled
                      title="Coming soon: server-side regenerate"
                      className="rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-[11px] font-medium text-white/40"
                    >
                      More aggressive
                    </button>
                    <button
                      type="button"
                      disabled
                      title="Coming soon: server-side regenerate"
                      className="rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-[11px] font-medium text-white/40"
                    >
                      Shorten
                    </button>
                    <button
                      type="button"
                      disabled
                      title="Coming soon: server-side regenerate"
                      className="rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-[11px] font-medium text-white/40"
                    >
                      Regenerate similar
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
