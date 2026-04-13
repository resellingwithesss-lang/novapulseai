"use client"

import type { ReactNode } from "react"

export type ToolResultState = "loading" | "error" | "empty" | "success"

export type ToolResultAction = {
  label: string
  href?: string
  onClick?: () => void
  external?: boolean
  download?: boolean
  tone?: "primary" | "secondary" | "ghost"
}

export type ToolResultKeyOutput = {
  label: string
  value: string
}

type ToolResultLayoutProps = {
  title: string
  state: ToolResultState
  statusLabel?: string
  summary?: string
  loadingMessage?: string
  emptyMessage?: string
  errorMessage?: string
  keyOutputs?: ToolResultKeyOutput[]
  actions?: ToolResultAction[]
  recoveryActions?: ToolResultAction[]
  nextSteps?: ToolResultAction[]
  children?: ReactNode
}

function ActionButton({ action }: { action: ToolResultAction }) {
  const toneClass =
    action.tone === "secondary"
      ? "border-white/[0.14] bg-white/[0.06] text-white/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:border-white/22 hover:bg-white/[0.1]"
      : action.tone === "ghost"
        ? "border-transparent bg-transparent text-white/65 hover:bg-white/[0.06] hover:text-white/88"
        : "border-transparent bg-gradient-to-r from-purple-500 to-pink-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:opacity-[0.96]"

  const className = `inline-flex items-center rounded-lg border px-3 py-2 text-xs font-semibold tracking-[-0.01em] outline-none transition-[opacity,background-color,border-color,color] duration-200 focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19] ${toneClass}`

  if (action.href) {
    return (
      <a
        href={action.href}
        className={className}
        target={action.external ? "_blank" : undefined}
        rel={action.external ? "noopener noreferrer" : undefined}
        download={action.download}
      >
        {action.label}
      </a>
    )
  }

  return (
    <button type="button" onClick={action.onClick} className={className}>
      {action.label}
    </button>
  )
}

export default function ToolResultLayout({
  title,
  state,
  statusLabel,
  summary,
  loadingMessage = "Processing your request...",
  emptyMessage = "No output available yet.",
  errorMessage = "Something went wrong. Please retry.",
  keyOutputs = [],
  actions = [],
  recoveryActions = [],
  nextSteps = [],
  children,
}: ToolResultLayoutProps) {
  const stateTone =
    state === "error"
      ? "border-red-500/30 bg-red-500/10 text-red-200"
      : state === "loading"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
        : state === "empty"
          ? "border-white/15 bg-white/5 text-white/65"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"

  const stateMessage =
    state === "error"
      ? errorMessage
      : state === "loading"
        ? loadingMessage
        : state === "empty"
          ? emptyMessage
          : null

  return (
    <section className="np-card mt-8 p-5 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-[-0.015em] text-white/[0.97] md:text-xl">{title}</h2>
        {statusLabel && (
          <span className={`rounded-full border px-3 py-1 text-xs ${stateTone}`}>
            {statusLabel}
          </span>
        )}
      </div>

      {summary && <p className="mb-4 text-sm leading-relaxed text-white/52">{summary}</p>}

      {stateMessage && (
        <div className="mb-4 rounded-xl border border-white/[0.078] bg-black/25 px-3 py-2.5 text-sm leading-relaxed text-white/72">
          {stateMessage}
        </div>
      )}

      {keyOutputs.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {keyOutputs.map((item) => (
            <div
              key={`${item.label}:${item.value}`}
              className="rounded-xl border border-white/[0.078] bg-black/25 px-3 py-2"
            >
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-white/42">{item.label}</div>
              <div className="mt-1 text-sm font-medium text-white/[0.97]">{item.value}</div>
            </div>
          ))}
        </div>
      )}

      {actions.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {actions.map((action) => (
            <ActionButton key={action.label} action={action} />
          ))}
        </div>
      )}

      {recoveryActions.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-amber-200/80">Recovery</p>
          <div className="flex flex-wrap gap-2">
            {recoveryActions.map((action) => (
              <ActionButton
                key={`recovery:${action.label}`}
                action={{ ...action, tone: action.tone ?? "ghost" }}
              />
            ))}
          </div>
        </div>
      )}

      {children}

      {nextSteps.length > 0 && (
        <div className="mt-5 border-t border-white/[0.08] pt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-white/42">What next</p>
          <div className="flex flex-wrap gap-2">
            {nextSteps.map((action) => (
              <ActionButton key={`next:${action.label}`} action={{ ...action, tone: action.tone ?? "secondary" }} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
