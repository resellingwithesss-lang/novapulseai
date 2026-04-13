"use client"

import { useGoogleLogin } from "@react-oauth/google"
import { useState } from "react"

type GoogleLoginButtonProps = {
  onSuccess: (accessToken: string) => void | Promise<void>
  onError: () => void
}

export default function GoogleLoginButton({
  onSuccess,
  onError,
}: GoogleLoginButtonProps) {
  const [loading, setLoading] = useState(false)
  const isGoogleAuthEnabled = Boolean(
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim()
  )

  const login = useGoogleLogin({
    flow: "implicit",
    onSuccess: async (tokenResponse) => {
      const accessToken = tokenResponse?.access_token
      if (!accessToken) {
        onError()
        return
      }

      if (process.env.NEXT_PUBLIC_DEBUG_GOOGLE_AUTH === "1") {
        // eslint-disable-next-line no-console
        console.info("[GoogleLoginButton] OAuth implicit success", {
          accessTokenLen: accessToken.length,
        })
      }

      try {
        setLoading(true)
        await onSuccess(accessToken)
      } finally {
        setLoading(false)
      }
    },
    onError: () => {
      setLoading(false)
      onError()
    },
  })

  if (!isGoogleAuthEnabled) {
    return null
  }

  return (
    <button
      type="button"
      onClick={() => login()}
      disabled={loading}
      className="w-full max-w-[300px] rounded-xl border border-white/20 bg-black/30 px-4 py-3 text-sm font-medium text-white transition hover:bg-black/40 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? "Connecting Google..." : "Continue with Google"}
    </button>
  )
}
