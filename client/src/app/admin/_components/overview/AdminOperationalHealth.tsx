import { Activity, Server } from "lucide-react"
import type { AdminOverviewHealth } from "./adminOverviewTypes"

type Props = {
  health: AdminOverviewHealth
}

export function AdminOperationalHealth({ health }: Props) {
  const topTools = [...health.generationsByType].sort((a, b) => b.runs - a.runs).slice(0, 5)

  return (
    <section
      className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      aria-labelledby="admin-health-heading"
    >
      <div className="flex items-center gap-2">
        <Server className="h-4 w-4 text-purple-200/85" aria-hidden />
        <h2
          id="admin-health-heading"
          className="text-[15px] font-semibold tracking-[-0.02em] text-white/95"
        >
          Operational health
        </h2>
      </div>
      <p className="mt-1 text-sm text-white/45">
        Pipeline mix and job states from live data.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-white/40">
            Ad jobs by status
          </h3>
          <div className="mt-3 overflow-hidden rounded-xl border border-white/[0.06]">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-white/[0.06] bg-black/30 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">
                <tr>
                  <th scope="col" className="px-3 py-2.5">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right">
                    Count
                  </th>
                </tr>
              </thead>
              <tbody>
                {health.adJobsByStatus.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-3 py-6 text-center text-white/45">
                      No ad job rows yet.
                    </td>
                  </tr>
                ) : (
                  [...health.adJobsByStatus]
                    .sort((a, b) => b.count - a.count)
                    .map((row) => (
                      <tr
                        key={row.status}
                        className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]"
                      >
                        <td className="px-3 py-2.5 font-medium capitalize text-white/80">
                          {row.status.replace(/_/g, " ")}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-white/70">
                          {row.count.toLocaleString()}
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-white/40">
            <Activity className="h-3.5 w-3.5" aria-hidden />
            Generations by type
          </h3>
          <div className="mt-3 overflow-hidden rounded-xl border border-white/[0.06]">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-white/[0.06] bg-black/30 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">
                <tr>
                  <th scope="col" className="px-3 py-2.5">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right">
                    Runs
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right">
                    Avg ms
                  </th>
                </tr>
              </thead>
              <tbody>
                {topTools.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-white/45">
                      No generations recorded.
                    </td>
                  </tr>
                ) : (
                  topTools.map((row) => (
                    <tr
                      key={row.type}
                      className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]"
                    >
                      <td className="px-3 py-2.5 font-medium text-white/80">{row.type}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-white/70">
                        {row.runs.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-white/55">
                        {row.avgDurationMs.toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <dl className="mt-6 grid gap-3 border-t border-white/[0.06] pt-5 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-3 rounded-xl bg-black/20 px-3 py-2">
          <dt className="text-white/45">Stuck ad jobs (&gt;30m idle)</dt>
          <dd className="font-semibold tabular-nums text-amber-200/95">
            {health.staleAdJobsCount.toLocaleString()}
          </dd>
        </div>
        <div className="flex justify-between gap-3 rounded-xl bg-black/20 px-3 py-2">
          <dt className="text-white/45">Completed without output</dt>
          <dd className="font-semibold tabular-nums text-amber-200/95">
            {health.partialCompletionsCount.toLocaleString()}
          </dd>
        </div>
      </dl>
    </section>
  )
}
