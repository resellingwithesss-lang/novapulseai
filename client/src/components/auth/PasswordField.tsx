"use client"

import { useId, useMemo, useState } from "react"

type PasswordStrength = "weak" | "fair" | "strong"

function scorePassword(value: string): PasswordStrength {
  if (value.length < 8) return "weak"
  let score = 0
  if (value.length >= 12) score += 1
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1
  if (/\d/.test(value)) score += 1
  if (/[^A-Za-z0-9]/.test(value)) score += 1
  if (score >= 3) return "strong"
  if (score >= 2) return "fair"
  return "weak"
}

const strengthMeta: Record<
  PasswordStrength,
  { label: string; bar: string; hint: string }
> = {
  weak: {
    label: "Weak",
    bar: "w-1/4 bg-red-400/80",
    hint: "Use at least 8 characters; add mixed case, a number, or a symbol.",
  },
  fair: {
    label: "Fair",
    bar: "w-1/2 bg-amber-400/80",
    hint: "Good start — longer phrases and symbols make it stronger.",
  },
  strong: {
    label: "Strong",
    bar: "w-full bg-emerald-400/80",
    hint: "Looks solid for this workspace.",
  },
}

type PasswordFieldProps = {
  id?: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  placeholder?: string
  disabled?: boolean
  error?: string | null
  showStrength?: boolean
  onEnter?: () => void
}

export default function PasswordField({
  id: externalId,
  label,
  value,
  onChange,
  autoComplete = "current-password",
  placeholder = "Password",
  disabled = false,
  error,
  showStrength = false,
  onEnter,
}: PasswordFieldProps) {
  const reactId = useId()
  const fieldId = externalId ?? `pw-${reactId}`
  const [visible, setVisible] = useState(false)

  const strength = useMemo(() => scorePassword(value), [value])
  const meta = strengthMeta[strength]

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={fieldId}
          className="text-xs font-medium uppercase tracking-wide text-white/50"
        >
          {label}
        </label>
      </div>
      <div className="relative">
        <input
          id={fieldId}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onEnter?.()
          }}
          autoComplete={autoComplete}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={
            showStrength && value ? `${fieldId}-strength` : undefined
          }
          className={`w-full rounded-xl border bg-black/40 px-4 py-3 pr-12 text-white placeholder:text-white/40 transition focus:outline-none focus:ring-2 focus:ring-purple-400/45 focus:ring-offset-2 focus:ring-offset-[#0b0f19] ${
            error
              ? "border-red-500/50 ring-red-500/20"
              : "border-white/[0.1]"
          }`}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-medium text-white/50 outline-none transition hover:bg-white/[0.06] hover:text-white/82 focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {showStrength && value.length > 0 && (
        <div id={`${fieldId}-strength`} className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/45">Password strength</span>
            <span
              className={
                strength === "strong"
                  ? "text-emerald-300"
                  : strength === "fair"
                    ? "text-amber-200"
                    : "text-red-300"
              }
            >
              {meta.label}
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all duration-300 ${meta.bar}`}
            />
          </div>
          <p className="text-xs text-white/45">{meta.hint}</p>
        </div>
      )}
      {error ? (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
