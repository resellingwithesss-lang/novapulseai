"use client"

type UpgradeModalProps = {
  open: boolean
  title?: string
  message: string
  currentPlan?: string
  requiredPlan?: string
  benefits?: string[]
  onClose: () => void
}

export default function UpgradeModal({
  open,
  title = "You've reached your limit",
  message,
  currentPlan,
  requiredPlan,
  benefits = [],
  onClose,
}: UpgradeModalProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#0f1320] p-6 text-white">
        <h3 className="text-xl font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-white/70">{message}</p>
        {(currentPlan || requiredPlan) && (
          <p className="mt-2 text-xs text-white/55">
            Current: {currentPlan ?? "STARTER"} {requiredPlan ? `• Required: ${requiredPlan}` : ""}
          </p>
        )}
        {benefits.length > 0 && (
          <ul className="mt-4 space-y-2 text-sm text-white/75">
            {benefits.map((item) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        )}
        <div className="mt-6 flex items-center gap-3">
          <a
            href="/pricing"
            className="rounded-full bg-gradient-to-r from-purple-600 to-pink-600 px-5 py-2 text-sm font-semibold text-white"
          >
            Upgrade plan
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm text-white/75"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
