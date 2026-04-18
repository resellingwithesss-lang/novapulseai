"use client"

import type { VideoPackagingPreset } from "@/lib/ad-studio-presets"

type PackagingPresetPickerProps = {
  value: string
  onChange: (id: string) => void
  disabled?: boolean
  presets: VideoPackagingPreset[]
}

/**
 * CSS-only mood board for caption packaging — not a frame-accurate render preview.
 */
function Swatch({ preset }: { preset: VideoPackagingPreset }) {
  const s = preset.swatch
  return (
    <div
      className="relative h-[72px] overflow-hidden rounded-lg border border-white/10"
      style={{ background: s.frameGradient }}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
      <div
        className="absolute bottom-2 left-2 right-2 rounded-md px-2 py-1 shadow-sm"
        style={{
          background: s.captionBg,
          border: s.captionBorder ?? "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div
          className="h-1.5 rounded-sm opacity-90"
          style={{ width: "72%", background: s.captionLine }}
        />
        <div
          className="mt-1 h-1 rounded-sm opacity-70"
          style={{ width: "48%", background: s.captionLineMuted ?? s.captionLine }}
        />
      </div>
      {s.highlightBar ? (
        <div
          className="absolute right-2 top-2 h-6 w-1 rounded-full"
          style={{ background: s.highlightBar }}
        />
      ) : null}
    </div>
  )
}

export default function PackagingPresetPicker({
  value,
  onChange,
  disabled,
  presets,
}: PackagingPresetPickerProps) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-relaxed text-white/42">
        Stylized thumbnails suggest caption weight and contrast — final typography is rendered server-side to match
        your export.
      </p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange("")}
          className={`rounded-xl border p-3 text-left transition disabled:opacity-50 ${
            value === ""
              ? "border-purple-400/45 bg-purple-500/12 ring-1 ring-purple-400/25"
              : "border-white/[0.1] bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
          }`}
        >
          <p className="text-xs font-semibold text-white/90">Preset default</p>
          <p className="mt-1 text-[11px] leading-relaxed text-white/45">
            Follows your creative mode&apos;s recommended packaging when set; otherwise balanced cinematic captions.
          </p>
        </button>
        {presets.map((preset) => {
          const selected = value === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(preset.id)}
              className={`rounded-xl border p-3 text-left transition disabled:opacity-50 ${
                selected
                  ? "border-purple-400/45 bg-purple-500/12 ring-1 ring-purple-400/25"
                  : "border-white/[0.1] bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
              }`}
            >
              <Swatch preset={preset} />
              <p className="mt-2 text-xs font-semibold text-white/90">{preset.label}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-white/48">{preset.hint}</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
