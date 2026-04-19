"use client"

import { ReactNode } from "react"
import { Loader2, RefreshCw } from "lucide-react"

/** Labeled input / controls region — consistent spacing and hierarchy. */
export function ToolInputSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="np-card p-5 md:p-6">
      <h2 className="text-sm font-semibold tracking-[-0.01em] text-white/92">{title}</h2>
      {description ? (
        <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-white/52">{description}</p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  )
}

/** Primary output region — visually distinct from inputs. */
export function ToolOutputSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="np-card border-purple-500/20 bg-gradient-to-b from-purple-500/[0.06] to-transparent p-5 md:p-6">
      <h2 className="text-sm font-semibold tracking-[-0.01em] text-white/92">{title}</h2>
      {description ? (
        <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-white/52">{description}</p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  )
}

type ToolPrimaryCtaProps = {
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  children: ReactNode
  loadingLabel?: string
  helperText?: string
}

export function ToolPrimaryCta({
  onClick,
  disabled,
  loading,
  children,
  loadingLabel = "Working…",
  helperText,
}: ToolPrimaryCtaProps) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || loading}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 py-4 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:opacity-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : null}
        {loading ? loadingLabel : children}
      </button>
      {helperText ? <p className="text-center text-xs text-white/45">{helperText}</p> : null}
    </div>
  )
}

type ToolLoadingPanelProps = {
  title?: string
  steps: string[]
  activeStepIndex: number
}

export function ToolLoadingPanel({
  title = "Generating your result",
  steps,
  activeStepIndex,
}: ToolLoadingPanelProps) {
  return (
    <div
      className="np-card border-white/10 bg-white/[0.03] p-6"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-white/88">
        <Loader2 className="h-4 w-4 animate-spin text-purple-300" aria-hidden />
        {title}
      </div>
      <ol className="mt-4 space-y-2">
        {steps.map((label, i) => {
          const done = i < activeStepIndex
          const active = i === activeStepIndex
          return (
            <li
              key={label}
              className={`flex items-start gap-2 text-xs leading-relaxed ${
                done
                  ? "text-emerald-200/85"
                  : active
                    ? "text-white/88"
                    : "text-white/38"
              }`}
            >
              <span className="mt-0.5 font-mono tabular-nums text-[10px] text-white/35">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{label}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

type ToolErrorPanelProps = {
  message: string
  onRetry?: () => void
  retryLabel?: string
  /** Shown only when true — keep request IDs out of default creator UX. */
  diagnostic?: string | null
}

export function ToolErrorPanel({
  message,
  onRetry,
  retryLabel = "Try again",
  diagnostic,
}: ToolErrorPanelProps) {
  return (
    <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100/95">
      <p className="leading-relaxed">{message}</p>
      {diagnostic ? (
        <p className="mt-2 font-mono text-[11px] text-rose-200/55">Reference: {diagnostic}</p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/90 transition hover:bg-white/10"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          {retryLabel}
        </button>
      ) : null}
    </div>
  )
}

/** Subtle upgrade strip — use below outputs or near CTAs. */
export function ToolUpgradeHint({
  message,
  href = "/pricing",
  cta = "Compare plans",
}: {
  message: string
  href?: string
  cta?: string
}) {
  return (
    <div className="rounded-xl border border-purple-500/28 bg-purple-500/[0.08] px-4 py-3 text-xs leading-relaxed text-purple-100/90">
      {message}{" "}
      <a href={href} className="font-semibold text-purple-200 underline decoration-white/20 underline-offset-2">
        {cta}
      </a>
    </div>
  )
}
