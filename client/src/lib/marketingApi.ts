import { api } from "@/lib/api"
import type { MarketingConsentStatus } from "@/context/AuthContext"

/**
 * Surfaces that may capture a marketing consent answer. Must match the
 * server-side Zod enum in `server/src/modules/marketing/marketing.routes.ts`.
 */
export type ConsentSurface =
  | "onboarding"
  | "dashboard_banner"
  | "billing_card"
  | "settings"

export type ConsentAction = "opt_in" | "opt_out" | "dismiss"

export type MarketingConsent = {
  marketingEmails: boolean
  status: MarketingConsentStatus
  source: string | null
  capturedAt: string | null
  updatedAt: string | null
  dismissedAt: string | null
}

export type ConsentResponse = {
  consent: MarketingConsent
  shouldResurface: boolean
  cooldownDays: number
}

export async function fetchMarketingConsent(): Promise<ConsentResponse> {
  return await api.get<ConsentResponse>("/marketing/consent")
}

export async function updateMarketingConsent(params: {
  action: ConsentAction
  source: ConsentSurface
}): Promise<ConsentResponse> {
  return await api.patch<ConsentResponse>("/marketing/consent", params)
}
