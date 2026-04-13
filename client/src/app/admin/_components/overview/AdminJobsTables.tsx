import Link from "next/link"
import { Clapperboard } from "lucide-react"
import type { AdminOverviewHealth } from "./adminOverviewTypes"

type Props = {
  health: AdminOverviewHealth
}

function shortReason(text: string | null, max = 72) {
  if (!text) return "—"
  const t = text.replace(/\s+/g, " ").trim()
  return t.length <= max ? t : `${t.slice(0, max)}…`
}

export function AdminJobsTables({ health }: Props) {
  return (
    <section
      className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      aria-labelledby="admin-jobs-heading"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Clapperboard className="h-4 w-4 text-purple-200/85" aria-hidden />
          <h2
            id="admin-jobs-heading"
            className="text-[15px] font-semibold tracking-[-0.02em] text-white/95"
          >
            Ad jobs — failures & stuck
          </h2>
        </div>
        <Link
          href="/admin/ads"
          className="text-xs font-semibold uppercase tracking-wide text-purple-200/90 hover:text-purple-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45"
        >
          Open Ad Generator →
        </Link>
      </div>
      <p className="mt-1 text-sm text-white/45">
        Recent failures and jobs with no progress for 30+ minutes (queued / processing).
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-white/40">
            Recent failures
          </h3>
          <div className="mt-2 overflow-x-auto rounded-xl border border-white/[0.06]">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-white/[0.06] bg-black/30 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">
                <tr>
                  <th scope="col" className="px-3 py-2.5">
                    Job
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    When
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody>
                {health.recentFailedAds.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-white/45">
                      No failed jobs in sample.
                    </td>
                  </tr>
                ) : (
                  health.recentFailedAds.map((j) => (
                    <tr key={j.jobId} className="border-b border-white/[0.04] last:border-0">
                      <td className="max-w-[140px] truncate px-3 py-2 font-mono text-xs text-white/80">
                        {j.jobId}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-white/55">
                        {new Date(j.createdAt).toLocaleString()}
                      </td>
                      <td className="max-w-xs px-3 py-2 text-xs text-red-200/85">
                        {shortReason(j.failedReason)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-white/40">
            Stuck jobs (sample)
          </h3>
          <div className="mt-2 overflow-x-auto rounded-xl border border-white/[0.06]">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-white/[0.06] bg-black/30 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">
                <tr>
                  <th scope="col" className="px-3 py-2.5">
                    Job
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right">
                    %
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Last touch
                  </th>
                </tr>
              </thead>
              <tbody>
                {health.staleJobsSample.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-white/45">
                      No stuck jobs detected.
                    </td>
                  </tr>
                ) : (
                  health.staleJobsSample.map((j) => (
                    <tr key={j.jobId} className="border-b border-white/[0.04] last:border-0">
                      <td className="max-w-[140px] truncate px-3 py-2 font-mono text-xs text-white/80">
                        {j.jobId}
                      </td>
                      <td className="px-3 py-2 capitalize text-white/65">{j.status}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-white/55">{j.progress}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-white/55">
                        {new Date(j.updatedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  )
}
