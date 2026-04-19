"use client"

import type { AdsJobRecord } from "@/hooks/useAdsJobPolling"

function readScriptRoot(jobRecord: AdsJobRecord | null): Record<string, unknown> | null {
  if (!jobRecord || typeof jobRecord !== "object") return null
  const script = (jobRecord as Record<string, unknown>).script
  if (!script || typeof script !== "object") return null
  return script as Record<string, unknown>
}

type Props = {
  jobRecord: AdsJobRecord | null
}

/**
 * Suggested call-to-actions from the generated script (user-safe labels only).
 */
export default function UserAdCtaSuggestions({ jobRecord }: Props) {
  const root = readScriptRoot(jobRecord)
  if (!root) return null

  const primary = typeof root.cta === "string" ? root.cta.trim() : ""
  const textsRaw = root.ctaTexts
  const extras: string[] = []
  if (Array.isArray(textsRaw)) {
    for (const item of textsRaw) {
      if (typeof item === "string" && item.trim()) extras.push(item.trim())
    }
  }

  const lines = [primary, ...extras].filter(Boolean)
  const unique = [...new Set(lines)]
  if (!unique.length) return null

  return (
    <section className="mt-10 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
        Suggested CTAs
      </p>
      <h3 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-white/[0.97]">
        Lines you can paste into captions or overlays
      </h3>
      <ul className="mt-4 space-y-2">
        {unique.slice(0, 6).map((line) => (
          <li
            key={line}
            className="flex gap-3 rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3 text-sm leading-relaxed text-white/75"
          >
            <span className="select-all font-medium text-white/90">{line}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
