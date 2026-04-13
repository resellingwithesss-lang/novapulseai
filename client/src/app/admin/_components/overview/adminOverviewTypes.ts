export type AdminOverviewAlert = {
  id: string
  severity: "critical" | "warning" | "info"
  title: string
  detail: string
  href: string
}

export type AdminOverviewKpis = {
  totalUsers: number
  activeSubscriptions: number
  trialingSubscriptions: number
  estimatedMrrGbp: number
  creditsRemaining: number
  creditsUsedLifetime: number
  generationRunsLifetime: number
  adJobsActive: number
  adJobsFailed24h: number
  adJobsFailedTotal: number
}

export type AdminOverviewBilling = {
  pastDue: number
  paused: number
}

export type AdminOverviewHealth = {
  staleAdJobsCount: number
  partialCompletionsCount: number
  adJobsByStatus: { status: string; count: number }[]
  generationsByType: { type: string; runs: number; avgDurationMs: number }[]
  staleJobsSample: Array<{
    jobId: string
    userId: string
    status: string
    progress: number
    updatedAt: string
  }>
  recentFailedAds: Array<{
    jobId: string
    userId: string
    failedReason: string | null
    createdAt: string
  }>
}

export type AdminOverviewGrowth = {
  signups7d: number
  signups30d: number
  payingByPlan: { plan: string; count: number }[]
}

export type AdminOverviewActivityItem = {
  id: string
  kind: "user" | "ad_job"
  at: string
  title: string
  subtitle: string
  href: string
}

export type AdminOverviewPayload = {
  refreshedAt: string
  kpis: AdminOverviewKpis
  billing: AdminOverviewBilling
  health: AdminOverviewHealth
  growth: AdminOverviewGrowth
  alerts: AdminOverviewAlert[]
  activity: AdminOverviewActivityItem[]
}
