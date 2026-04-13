"use client"

import { useCallback, useEffect, useState } from "react"
import {
  fetchActivityRecent,
  type ActivityAdJobRow,
  type ActivityContentPackRow,
  type ActivityGenerationRow,
  type ActivityRecentQuery,
} from "@/lib/activityApi"

export function useActivityRecent(enabled: boolean, query: ActivityRecentQuery = {}) {
  const [generations, setGenerations] = useState<ActivityGenerationRow[]>([])
  const [adJobs, setAdJobs] = useState<ActivityAdJobRow[]>([])
  const [contentPacks, setContentPacks] = useState<ActivityContentPackRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const {
    workspaceId,
    sections,
    generationType,
    generationsLimit,
    jobsLimit,
    contentPacksLimit,
  } = query

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const data = await fetchActivityRecent({
      workspaceId,
      sections,
      generationType,
      generationsLimit,
      jobsLimit,
      contentPacksLimit,
    })
    if (!data) {
      setError("Could not load server activity.")
      setGenerations([])
      setAdJobs([])
      setContentPacks([])
    } else {
      setGenerations(data.generations ?? [])
      setAdJobs(data.adJobs ?? [])
      setContentPacks(data.contentPacks ?? [])
    }
    setLoading(false)
  }, [
    enabled,
    workspaceId,
    sections,
    generationType,
    generationsLimit,
    jobsLimit,
    contentPacksLimit,
  ])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { generations, adJobs, contentPacks, loading, error, refresh }
}
