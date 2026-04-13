import type { ReactNode } from "react"
import GoogleOAuthGate from "@/components/auth/GoogleOAuthGate"

export default function RegisterLayout({ children }: { children: ReactNode }) {
  return <GoogleOAuthGate>{children}</GoogleOAuthGate>
}
