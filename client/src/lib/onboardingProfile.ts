"use client"

export type CreatorOnboardingProfile = {
  completed: boolean
  creatorType?: string
  primaryPlatform?: string
  goal?: string
  completedAt?: number
}

const KEY = "vf:creator_onboarding_v1"

export function readOnboardingProfile(): CreatorOnboardingProfile | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CreatorOnboardingProfile
    if (typeof parsed.completed !== "boolean") return null
    return parsed
  } catch {
    return null
  }
}

export function writeOnboardingProfile(profile: CreatorOnboardingProfile) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(profile))
  } catch {
    // ignore
  }
}
