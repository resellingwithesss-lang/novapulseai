import type { ReactNode } from "react"

export function SettingsPageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <header className="border-b border-white/[0.07] pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-white md:text-[1.65rem] md:leading-tight">
            {title}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-white/48 md:text-[0.9375rem]">
            {description}
          </p>
        </div>
        {actions ? <div className="shrink-0 sm:pt-1">{actions}</div> : null}
      </div>
    </header>
  )
}

export function SettingsCard({
  id,
  title,
  description,
  children,
  footer,
}: {
  id?: string
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <section
      id={id}
      className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      role="region"
      aria-label={title}
    >
      <div className="border-b border-white/[0.06] px-5 py-4 sm:px-6">
        <h2 className="text-[15px] font-medium tracking-[-0.015em] text-white/95">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm leading-relaxed text-white/45">{description}</p>
        ) : null}
      </div>
      <div className="px-5 py-5 sm:px-6 sm:py-6">{children}</div>
      {footer ? (
        <div className="border-t border-white/[0.06] bg-black/15 px-5 py-4 sm:px-6">
          {footer}
        </div>
      ) : null}
    </section>
  )
}
