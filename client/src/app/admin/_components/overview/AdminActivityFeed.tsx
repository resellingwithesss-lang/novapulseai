import Link from "next/link"
import { Clapperboard, UserRound } from "lucide-react"
import type { AdminOverviewActivityItem } from "./adminOverviewTypes"

type Props = {
  items: AdminOverviewActivityItem[]
}

export function AdminActivityFeed({ items }: Props) {
  return (
    <section
      className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      aria-labelledby="admin-activity-heading"
    >
      <h2
        id="admin-activity-heading"
        className="text-[15px] font-semibold tracking-[-0.02em] text-white/95"
      >
        Recent activity
      </h2>
      <p className="mt-1 text-sm text-white/45">
        Newest users and latest ad job touches (merged timeline).
      </p>

      {items.length === 0 ? (
        <p className="mt-6 text-sm text-white/45">No recent rows to show.</p>
      ) : (
        <ul className="mt-5 divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-black/20">
          {items.map((item) => {
            const Icon = item.kind === "user" ? UserRound : Clapperboard
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="flex items-start gap-3 px-4 py-3 transition hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-400/35"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04]">
                    <Icon className="h-4 w-4 text-purple-200/80" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-white/90">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-white/45">{item.subtitle}</span>
                    <time
                      className="mt-1 block text-[11px] tabular-nums text-white/35"
                      dateTime={item.at}
                    >
                      {new Date(item.at).toLocaleString()}
                    </time>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
