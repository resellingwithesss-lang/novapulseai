"use client"

import { useAuth } from "@/context/AuthContext"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { api, ApiError } from "@/lib/api"
import Link from "next/link"
import GoogleLoginButton from "@/components/auth/GoogleLoginButton"
import PasswordField from "@/components/auth/PasswordField"
import { formatAuthError } from "@/lib/authErrors"
import {
  parsePlanIntentFromSearchParams,
  writeCheckoutPlanIntent,
  readCheckoutPlanIntent,
  setResumeCheckoutFlag,
} from "@/lib/planIntent"

function getSafeRedirectPath(candidate: string | null) {
  if (!candidate) return "/dashboard"
  if (!candidate.startsWith("/")) return "/dashboard"
  if (candidate.startsWith("//")) return "/dashboard"
  return candidate
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function postAuthPath(
  params: Pick<URLSearchParams, "get">
): string {
  if (readCheckoutPlanIntent()) {
    setResumeCheckoutFlag()
    return "/pricing"
  }
  return getSafeRedirectPath(params.get("redirect"))
}

export default function LoginPage() {
  const { login, refreshUser, status, hasResolvedSession } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const isGoogleAuthEnabled = Boolean(
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim()
  )
  const previewAccountEmail = process.env.NEXT_PUBLIC_PREVIEW_ACCOUNT_EMAIL?.trim() || ""

  const registerHref = useMemo(() => {
    const next = new URLSearchParams()
    const redirect = searchParams.get("redirect")
    if (redirect) next.set("redirect", redirect)
    const plan = searchParams.get("plan")
    const billing = searchParams.get("billing")
    if (plan) next.set("plan", plan)
    if (billing) next.set("billing", billing)
    const q = next.toString()
    return q ? `/register?${q}` : "/register"
  }, [searchParams])

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailTouched, setEmailTouched] = useState(false)

  useEffect(() => {
    const intent = parsePlanIntentFromSearchParams(searchParams)
    if (intent) writeCheckoutPlanIntent(intent)
  }, [searchParams])

  useEffect(() => {
    if (status !== "authenticated") return
    // Read from window so `redirect=` is not missed if this runs before useSearchParams hydrates.
    const params = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : ""
    )
    router.replace(postAuthPath(params))
  }, [status, router])

  const emailError =
    emailTouched && email.trim() && !isValidEmail(email)
      ? "Enter a valid email address."
      : null

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError("Email and password are required.")
      return
    }
    if (!isValidEmail(email)) {
      setError("Enter a valid email address.")
      return
    }

    try {
      setLoading(true)
      setError(null)
      await login(email.trim(), password)
      router.replace(
        postAuthPath(new URLSearchParams(window.location.search))
      )
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 401 &&
        err.code !== "SESSION_NOT_ESTABLISHED"
      ) {
        setError("Invalid email or password.")
      } else {
        setError(formatAuthError(err, "Sign-in failed. Please try again."))
      }
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSuccess = async (accessToken: string) => {
    try {
      setLoading(true)
      setError(null)
      if (process.env.NEXT_PUBLIC_DEBUG_GOOGLE_AUTH === "1") {
        // eslint-disable-next-line no-console
        console.info("[login] POST /api/auth/google", {
          accessTokenLen: accessToken.length,
        })
      }
      await api.post("/auth/google", { accessToken })
      const next = await refreshUser({ silent: true })
      if (!next) {
        throw new ApiError(
          "Google sign-in succeeded but your session was not saved (cookie missing). Use the same host for the site and API (e.g. only localhost or only 127.0.0.1), disable blocking extensions, or confirm the API is running on port 5000.",
          401,
          "SESSION_NOT_ESTABLISHED"
        )
      }
      router.replace(
        postAuthPath(new URLSearchParams(window.location.search))
      )
    } catch (err) {
      setError(formatAuthError(err, "Google sign-in failed. Please try again."))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6">
      {!hasResolvedSession && (
        <p
          className="mb-6 max-w-md text-center text-xs text-white/40"
          aria-live="polite"
        >
          Checking saved session…
        </p>
      )}
      <div className="relative w-full max-w-md">
        <div className="np-card p-10">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-semibold tracking-[-0.022em] text-white">
              Welcome back
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-white/50">
              Sign in to NovaPulseAI — your tools, credits, and history stay in
              sync.
            </p>
          </div>

          {searchParams.get("reason") === "password-reset" && (
            <div
              className="mb-6 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200/95"
              role="status"
            >
              Password updated. Sign in with your new password.
            </div>
          )}

          {error && (
            <div
              className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
              role="alert"
            >
              {error}
            </div>
          )}

          <div className="space-y-5">
            <div className="space-y-2">
              <label
                htmlFor="login-email"
                className="text-xs font-medium uppercase tracking-wide text-white/50"
              >
                Email
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
                disabled={loading}
                aria-invalid={Boolean(emailError)}
                className={`w-full rounded-xl border bg-black/40 px-4 py-3 text-white placeholder:text-white/40 transition focus:outline-none focus:ring-2 focus:ring-purple-400/45 focus:ring-offset-2 focus:ring-offset-[#0b0f19] ${
                  emailError
                    ? "border-red-500/50"
                    : "border-white/[0.1]"
                }`}
              />
              {emailError ? (
                <p className="text-xs text-red-400" role="alert">
                  {emailError}
                </p>
              ) : null}
            </div>

            <PasswordField
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              disabled={loading}
              onEnter={handleLogin}
            />

            <button
              type="button"
              onClick={handleLogin}
              disabled={loading}
              className="w-full rounded-full bg-gradient-to-r from-purple-500 to-pink-600 py-3.5 text-sm font-semibold tracking-[-0.01em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition-[opacity] hover:opacity-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19] active:opacity-[0.93] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </div>

          {isGoogleAuthEnabled && (
            <>
              <div className="my-8 flex items-center gap-3">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-xs text-white/40">or</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <div className="flex justify-center">
                <GoogleLoginButton
                  onSuccess={handleGoogleSuccess}
                  onError={() =>
                    setError("Google sign-in failed. Please try again.")
                  }
                />
              </div>
            </>
          )}

          <p className="mt-8 text-center text-sm text-white/50">
            New here?{" "}
            <Link
              href={registerHref}
              className="font-medium text-purple-200/88 underline-offset-2 outline-none transition-colors hover:text-purple-100/95 focus-visible:rounded focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
            >
              Create an account
            </Link>
          </p>
          <p className="mt-4 text-center text-xs text-white/35">
            Secure session cookies. Manage billing and plans from your
            dashboard.
          </p>
          {previewAccountEmail && (
            <p className="mt-2 text-center text-xs text-white/45">
              Preview account email:{" "}
              <span className="font-medium text-white/75">{previewAccountEmail}</span>
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
