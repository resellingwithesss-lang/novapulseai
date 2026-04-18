"use client"

export type VideoPreviewAspect = "9:16" | "1:1" | "16:9"

export function platformToPreviewAspect(platform?: string | null): VideoPreviewAspect {
  if (platform === "youtube") return "16:9"
  if (platform === "instagram") return "1:1"
  return "9:16"
}

/** Narrow API/DB `unknown` platform fields for preview aspect. */
export function coerceAdsPlatform(raw: unknown): string | undefined {
  if (raw === "tiktok" || raw === "instagram" || raw === "youtube") return raw
  return undefined
}

type PremiumVideoPreviewProps = {
  src: string
  /** Defaults from platform when used with `platformToPreviewAspect`. */
  aspect?: VideoPreviewAspect
  className?: string
  /** Optional eyebrow — omit to hide and keep chrome minimal. */
  label?: string
  /** Honest context under the label (e.g. aspect / download parity). */
  footnote?: string
}

/**
 * Device-adjacent frame: gradient bezel + correct aspect so previews read like real feed output.
 */
export default function PremiumVideoPreview({
  src,
  aspect = "9:16",
  className = "",
  label,
  footnote,
}: PremiumVideoPreviewProps) {
  const ratio = aspect === "9:16" ? "9 / 16" : aspect === "1:1" ? "1 / 1" : "16 / 9"

  const shellClass =
    aspect === "16:9"
      ? "max-w-full md:max-w-4xl"
      : aspect === "1:1"
        ? "max-w-[min(100%,400px)]"
        : "max-w-[min(100%,380px)]"

  return (
    <div className={`mx-auto w-full ${shellClass} ${className}`.trim()}>
      {label || footnote ? (
        <div className="mb-2.5 px-0.5">
          {label ? (
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/42">{label}</p>
          ) : null}
          {footnote ? (
            <p className="mt-1 text-[11px] leading-relaxed text-white/38">{footnote}</p>
          ) : null}
        </div>
      ) : null}
      <div className="rounded-[22px] border border-white/[0.13] bg-gradient-to-b from-white/[0.14] via-white/[0.05] to-black/55 p-[3px] shadow-[0_28px_100px_-36px_rgba(0,0,0,0.92)]">
        <div
          className="relative overflow-hidden rounded-[18px] bg-[#050508] ring-1 ring-black/85"
          style={{ aspectRatio: ratio }}
        >
          <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-black/20 via-transparent to-black/10" />
          <video
            src={src}
            className="absolute inset-0 h-full w-full object-contain"
            controls
            playsInline
            preload="metadata"
          />
        </div>
      </div>
    </div>
  )
}
