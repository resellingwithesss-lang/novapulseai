import Link from "next/link"
import { AlertTriangle, Info, ShieldAlert } from "lucide-react"
import type { AdminOverviewAlert } from "./adminOverviewTypes"

type Props = {
  alerts: AdminOverviewAlert[]
}

function iconFor(severity: AdminOverviewAlert["severity"]) {
  if (severity === "critical") return ShieldAlert
  if (severity === "warning") return AlertTriangle
  return Info
}

function stylesFor(severity: AdminOverviewAlert["severity"]) {
  if (severity === "critical") {
    return "border-red-500/30 bg-red-500/[0.12] text-red-100/95"
  }
  if (severity === "warning") {
    return "border-amber-500/25 bg-amber-500/[0.1] text-amber-50/95"
  }
  return "border-sky-500/20 bg-sky-500/[0.08] text-sky-50/95"
}

export function AdminAlertsBanner({ alerts }: Props) {
  if (alerts.length === 0) {
    return (
      <div
        className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] px-4 py-3 text-sm text-emerald-100/85"
        role="status"
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" aria-hidden />
        <span>No critical alerts from the current snapshot.</span>
      </div>
    )
  }

  return (
    <section aria-label="Operational alerts" className="space-y-3">
      <h2 className="sr-only">Alerts</h2>
      <ul className="space-y-2">
        {alerts.map((a) => {
          const Icon = iconFor(a.severity)
          return (
            <li key={a.id}>
              <Link
                href={a.href}
                className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45 ${stylesFor(a.severity)}`}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-90" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{a.title}</span>
                  <span className="mt-0.5 block text-xs opacity-80">{a.detail}</span>
                  <span className="mt-1 inline-block text-xs font-semibold uppercase tracking-wide text-white/70">
                    Open →
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
