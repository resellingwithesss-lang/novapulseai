import { api } from "@/lib/api"

export type SettingsProfile = {
  email: string
  displayName: string | null
  provider: "LOCAL" | "GOOGLE" | "GITHUB"
  emailVerified: boolean
  createdAt: string
  lastLoginAt: string | null
}

export type SettingsPreferences = {
  defaultBrandVoiceId?: string | null
  defaultWorkspaceId?: string | null
  uiDensity?: "comfortable" | "compact"
  emailProductUpdates?: boolean
  emailUsageAlerts?: boolean
}

export type SettingsUsageSummary = {
  credits: number
  monthlyCredits: number
  monthlyResetAt: string | null
  bonusCredits: number
  lifetimeCreditsUsed: number
  totalGenerations: number
  plan: string
  subscriptionStatus: string
}

export type SettingsPayload = {
  profile: SettingsProfile
  preferences: SettingsPreferences
  usageSummary: SettingsUsageSummary
}

export type CreditLedgerRow = {
  id: string
  amount: number
  type: string
  reason: string
  balanceAfter: number | null
  createdAt: string
}

type ApiOk<T> = { success?: boolean } & T

export async function fetchSettings() {
  const data = await api.get<ApiOk<SettingsPayload>>("/settings")
  return {
    profile: data.profile,
    preferences: data.preferences,
    usageSummary: data.usageSummary,
  }
}

export async function patchProfile(body: { displayName: string | null }) {
  const data = await api.patch<ApiOk<{ displayName: string | null }>>(
    "/settings/profile",
    body
  )
  return { displayName: data.displayName }
}

export async function patchPreferences(body: Partial<SettingsPreferences>) {
  const data = await api.patch<ApiOk<{ preferences: SettingsPreferences }>>(
    "/settings/preferences",
    body
  )
  return { preferences: data.preferences }
}

export async function fetchCreditLedger(limit = 40) {
  const data = await api.get<ApiOk<{ transactions: CreditLedgerRow[] }>>(
    `/settings/credits-ledger?limit=${limit}`
  )
  return { transactions: data.transactions }
}

export async function changePassword(body: {
  currentPassword: string
  newPassword: string
}) {
  return api.post<ApiOk<{ message?: string }>>("/auth/change-password", body)
}
