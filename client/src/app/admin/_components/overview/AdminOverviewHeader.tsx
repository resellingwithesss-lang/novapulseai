type Props = {
  refreshedAt: string | null
  loading: boolean
  onRefresh: () => void
}

function formatRefreshed(iso: string | null) {
  if (!iso) return "—"
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso))
  } catch {
    return "—"
  }
}

export function AdminOverviewHeader({ refreshedAt, loading, onRefresh }: Props) {
  return (
    <header className="flex flex-col gap-4 border-b border-white/[0.08] pb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-purple-300/85">
          Operations
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white md:text-[2rem] md:leading-tight">
          Overview
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/50">
          Live snapshot of users, billing risk, pipelines, and jobs. Metrics aggregate from the
          database — refresh after incidents or deploys.
        </p>
      </div>
      <div className="flex flex-col items-stretch gap-2 sm:items-end">
        <p className="text-xs text-white/40" aria-live="polite">
          Last refreshed:{" "}
          <span className="font-medium text-white/65">{formatRefreshed(refreshedAt)}</span>
        </p>
        <button
          type="button"
          onClick={() => onRefresh()}
          disabled={loading}
          className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.06] px-5 text-sm font-medium text-white outline-none transition hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0F19] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </header>
  )
}
