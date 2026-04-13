"use client"

import { useCallback, useEffect, useState } from "react"
import { fetchWorkflowSummary, type WorkflowLimitsDto } from "@/lib/workflowApi"

export type WorkflowSummaryState = {
  counts: {
    workspaces: number
    brandVoices: number
    contentPacks: number
  }
  limits: WorkflowLimitsDto
}

export function useWorkflowSummary(enabled: boolean) {
  const [data, setData] = useState<WorkflowSummaryState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const res = await fetchWorkflowSummary()
    if (!res?.success || !res.counts || !res.limits) {
      setError("Could not load workflow summary.")
      setData(null)
    } else {
      setData({
        counts: res.counts,
        limits: res.limits,
      })
    }
    setLoading(false)
  }, [enabled])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}
