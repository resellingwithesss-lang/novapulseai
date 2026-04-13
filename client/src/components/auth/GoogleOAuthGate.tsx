"use client"

import type { ReactNode } from "react"
import { GoogleOAuthProvider } from "@react-oauth/google"

/**
 * Google OAuth context is only needed on auth screens.
 * Keeping it out of the root tree avoids invisible overlay/iframes
 * blocking clicks on the marketing site.
 */
export default function GoogleOAuthGate({ children }: { children: ReactNode }) {
  const googleClientId =
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || ""

  if (!googleClientId) {
    return <>{children}</>
  }

  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      {children}
    </GoogleOAuthProvider>
  )
}
