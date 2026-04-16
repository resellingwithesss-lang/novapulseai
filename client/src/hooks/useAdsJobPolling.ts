"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { api } from "@/lib/api"
import { normalizeToolOperation } from "@/lib/tool-operation"

type AdJobStatus = "queued" | "processing" | "rendering" | "completed" | "failed"

type AdJobSnapshot = {
  status: AdJobStatus
  progress?: number
  outputUrl?: string | null
  failedReason?: string | null
}

/** Full Prisma-shaped job from GET /ads/:jobId (script JSON, scenePlan, status, etc.). */
export type AdsJobRecord = Record<string, unknown>

type AdJobStatusResponse = {
  success: boolean
  requestId?: string
  jobId?: string
  status?: string
  progress?: number
  result?: {
    job?: AdJobSnapshot
  }
  job?: AdJobSnapshot
}

type PersistedJobState = {
  jobId: string
  requestId?: string
  startedAt: number
  progress?: number
  lastKnownStatus?: string
}

type UseAdsJobPollingOptions = {
  storageKey: string
  pollIntervalMs?: number
  maxWaitMs?: number
  normalizeOutputUrl: (url: string) => string
  stageFromProgress: (progress: number) => string
  cancelPath?: (jobId: string) => string
}

export type AdsJobUiState = {
  loading: boolean
  progress: number
  stageText: string
  error: string | null
  jobId: string | null
  requestId: string | null
  videoUrl: string | null
  /** Latest job payload from the API (for operator review: script, adVariants, scores). */
  jobRecord: AdsJobRecord | null
}

const DEFAULT_STAGE = "Ready to generate"

function extractJobRecordFromEnvelope(response: unknown): AdsJobRecord | null {
  if (!response || typeof response !== "object") return null
  const r = response as Record<string, unknown>
  const nested =
    r.result && typeof r.result === "object"
      ? (r.result as Record<string, unknown>).job
      : undefined
  const job = (nested ?? r.job) as unknown
  if (job && typeof job === "object") return job as AdsJobRecord
  return null
}

function readPersistedState(storageKey: string): PersistedJobState | null {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedJobState
    if (!parsed.jobId || !parsed.startedAt) return null
    return parsed
  } catch {
    return null
  }
}

function writePersistedState(storageKey: string, state: PersistedJobState | null) {
  try {
    if (!state) {
      window.localStorage.removeItem(storageKey)
      return
    }
    window.localStorage.setItem(storageKey, JSON.stringify(state))
  } catch {
    // ignore localStorage failures
  }
}

export function useAdsJobPolling({
  storageKey,
  pollIntervalMs = 2500,
  maxWaitMs = 1000 * 60 * 20,
  normalizeOutputUrl,
  stageFromProgress,
  cancelPath,
}: UseAdsJobPollingOptions) {
  const [state, setState] = useState<AdsJobUiState>({
    loading: false,
    progress: 0,
    stageText: DEFAULT_STAGE,
    error: null,
    jobId: null,
    requestId: null,
    videoUrl: null,
    jobRecord: null,
  })

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = useRef(false)
  const startedAtRef = useRef<number>(0)
  const consecutivePollErrorCount = useRef(0)

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const clearPersisted = useCallback(() => {
    writePersistedState(storageKey, null)
  }, [storageKey])

  const resetForNewRun = useCallback(() => {
    cancelledRef.current = false
    consecutivePollErrorCount.current = 0
    setState({
      loading: true,
      progress: 5,
      stageText: "Queueing generation job...",
      error: null,
      jobId: null,
      requestId: null,
      videoUrl: null,
      jobRecord: null,
    })
  }, [])

  const poll = useCallback(
    async (jobId: string) => {
      if (cancelledRef.current) return

      try {
        const response = await api.get<AdJobStatusResponse>(`/ads/${jobId}`, { silent: true })
        const operation = normalizeToolOperation<{ job?: AdJobSnapshot }>(response)
        const job = operation.result?.job ?? response.job

        if (!operation.success || !job) {
          const errorCode = operation.error?.code
          const failRequestId = operation.requestId ?? state.requestId ?? null
          consecutivePollErrorCount.current += 1
          if (errorCode === "EXPIRED" || errorCode === "NOT_FOUND") {
            stop()
            clearPersisted()
            setState({
              loading: false,
              progress: 0,
              stageText: DEFAULT_STAGE,
              error: `Job is no longer recoverable (${errorCode}). Job ID: ${jobId}`,
              jobId,
              requestId: failRequestId,
              videoUrl: null,
              jobRecord: null,
            })
            return
          }
          if (consecutivePollErrorCount.current >= 4) {
            setState({
              loading: false,
              progress: 0,
              stageText: DEFAULT_STAGE,
              error: `Unable to retrieve job state. Job ID: ${jobId}`,
              jobId,
              requestId: failRequestId,
              videoUrl: null,
              jobRecord: null,
            })
            stop()
          } else {
            timerRef.current = setTimeout(() => void poll(jobId), pollIntervalMs)
          }
          return
        }

        consecutivePollErrorCount.current = 0
        const progress = Math.max(0, Math.min(100, Number(job.progress ?? operation.progress ?? 0)))
        const jobRecord = extractJobRecordFromEnvelope(response)

        setState((prev) => ({
          ...prev,
          loading: true,
          progress,
          stageText: stageFromProgress(progress),
          requestId: operation.requestId ?? prev.requestId,
          jobId,
          jobRecord: jobRecord ?? prev.jobRecord,
        }))
        writePersistedState(storageKey, {
          jobId,
          requestId: operation.requestId ?? state.requestId ?? undefined,
          startedAt: startedAtRef.current,
          progress,
          lastKnownStatus: job.status,
        })

        if (job.status === "completed") {
          stop()
          if (!job.outputUrl) {
            const rec = extractJobRecordFromEnvelope(response)
            setState({
              loading: false,
              progress: 100,
              stageText: "Completed",
              error: `Job completed but no output URL was returned. Job ID: ${jobId}`,
              jobId,
              requestId: operation.requestId ?? null,
              videoUrl: null,
              jobRecord: rec ?? null,
            })
            clearPersisted()
            return
          }
          setState((prev) => ({
            ...prev,
            loading: false,
            progress: 100,
            stageText: "Completed",
            videoUrl: normalizeOutputUrl(job.outputUrl || ""),
            error: null,
            jobRecord: extractJobRecordFromEnvelope(response) ?? prev.jobRecord,
          }))
          clearPersisted()
          return
        }

        if (job.status === "failed") {
          stop()
          const rec = extractJobRecordFromEnvelope(response)
          setState({
            loading: false,
            progress,
            stageText: DEFAULT_STAGE,
            error: `${job.failedReason || "Video generation failed."} Job ID: ${jobId}`,
            jobId,
            requestId: operation.requestId ?? null,
            videoUrl: null,
            jobRecord: rec ?? null,
          })
          clearPersisted()
          return
        }

        if (Date.now() - startedAtRef.current > maxWaitMs) {
          stop()
          setState({
            loading: false,
            progress: 0,
            stageText: DEFAULT_STAGE,
            error: `Generation timed out while waiting for completion. Job ID: ${jobId}`,
            jobId,
            requestId: operation.requestId ?? null,
            videoUrl: null,
            jobRecord: null,
          })
          clearPersisted()
          return
        }

        timerRef.current = setTimeout(() => void poll(jobId), pollIntervalMs)
      } catch {
        consecutivePollErrorCount.current += 1
        if (consecutivePollErrorCount.current >= 4) {
          stop()
          setState({
            loading: false,
            progress: 0,
            stageText: DEFAULT_STAGE,
            error: `Polling failed repeatedly. Job ID: ${jobId}`,
            jobId,
            requestId: null,
            videoUrl: null,
            jobRecord: null,
          })
          return
        }
        const backoffMs = Math.min(pollIntervalMs * Math.pow(2, consecutivePollErrorCount.current), 12000)
        timerRef.current = setTimeout(() => void poll(jobId), backoffMs)
      }
    },
    [clearPersisted, maxWaitMs, normalizeOutputUrl, pollIntervalMs, stageFromProgress, state.requestId, stop, storageKey]
  )

  const begin = useCallback(
    (jobId: string, requestId?: string) => {
      cancelledRef.current = false
      startedAtRef.current = Date.now()
      writePersistedState(storageKey, {
        jobId,
        requestId,
        startedAt: startedAtRef.current,
        progress: 5,
        lastKnownStatus: "queued",
      })
      setState((prev) => ({
        ...prev,
        loading: true,
        stageText: "Starting job...",
        jobId,
        requestId: requestId ?? prev.requestId,
      }))
      stop()
      void poll(jobId)
    },
    [poll, storageKey, stop]
  )

  /**
   * Load a job by id for review (e.g. lineage navigation). Uses GET /ads/:jobId.
   * Continues polling if still processing.
   */
  const loadJobForReview = useCallback(
    async (jobId: string) => {
      cancelledRef.current = false
      consecutivePollErrorCount.current = 0
      stop()
      clearPersisted()
      try {
        const response = await api.get<AdJobStatusResponse>(`/ads/${jobId}`, {
          silent: true,
        })
        const operation = normalizeToolOperation<{ job?: AdJobSnapshot }>(
          response
        )
        const job = operation.result?.job ?? response.job
        if (!operation.success || !job) {
          setState({
            loading: false,
            progress: 0,
            stageText: DEFAULT_STAGE,
            error: `Could not load job ${jobId}`,
            jobId,
            requestId: null,
            videoUrl: null,
            jobRecord: null,
          })
          return false
        }
        const status = job.status
        const jobRecord = extractJobRecordFromEnvelope(response)
        const progress = Math.max(
          0,
          Math.min(100, Number(job.progress ?? operation.progress ?? 0))
        )

        if (status === "completed") {
          if (!job.outputUrl) {
            setState({
              loading: false,
              progress: 100,
              stageText: "Completed",
              error: `Job completed but no output URL. Job ID: ${jobId}`,
              jobId,
              requestId: operation.requestId ?? null,
              videoUrl: null,
              jobRecord: jobRecord ?? null,
            })
            return false
          }
          setState({
            loading: false,
            progress: 100,
            stageText: "Completed",
            error: null,
            jobId,
            requestId: operation.requestId ?? null,
            videoUrl: normalizeOutputUrl(job.outputUrl || ""),
            jobRecord: jobRecord ?? null,
          })
          return true
        }

        if (status === "failed") {
          setState({
            loading: false,
            progress,
            stageText: DEFAULT_STAGE,
            error: `${job.failedReason || "Job failed"} (Job ID: ${jobId})`,
            jobId,
            requestId: operation.requestId ?? null,
            videoUrl: null,
            jobRecord: jobRecord ?? null,
          })
          return true
        }

        begin(jobId, operation.requestId)
        return true
      } catch {
        setState({
          loading: false,
          progress: 0,
          stageText: DEFAULT_STAGE,
          error: `Failed to load job ${jobId}`,
          jobId,
          requestId: null,
          videoUrl: null,
          jobRecord: null,
        })
        return false
      }
    },
    [begin, clearPersisted, normalizeOutputUrl, stop]
  )

  const resume = useCallback(() => {
    if (typeof window === "undefined") return false
    const persisted = readPersistedState(storageKey)
    if (!persisted) return false
    if (Date.now() - persisted.startedAt > maxWaitMs) {
      clearPersisted()
      return false
    }
    setState((prev) => ({
      ...prev,
      loading: true,
      stageText: stageFromProgress(persisted.progress ?? 5),
      progress: persisted.progress ?? 5,
      jobId: persisted.jobId,
      requestId: persisted.requestId ?? prev.requestId,
      error: null,
    }))
    startedAtRef.current = persisted.startedAt
    begin(persisted.jobId, persisted.requestId)
    return true
  }, [begin, clearPersisted, maxWaitMs, stageFromProgress, storageKey])

  const cancel = useCallback(async () => {
    const currentJobId = state.jobId
    let cancelConfirmed = false
    if (currentJobId && cancelPath) {
      try {
        await api.post(cancelPath(currentJobId), {}, { silent: true, timeout: 8000, retry: 0 })
        cancelConfirmed = true
      } catch {
        cancelConfirmed = false
      }
    }
    cancelledRef.current = true
    stop()
    setState((prev) => ({
      ...prev,
      loading: false,
      stageText: DEFAULT_STAGE,
      error: prev.jobId
        ? `${
            cancelPath
              ? cancelConfirmed
                ? "Generation cancellation confirmed"
                : "Tracking stopped locally; server cancellation not confirmed"
              : "Tracking paused"
          } for Job ID: ${prev.jobId}`
        : cancelPath
          ? cancelConfirmed
            ? "Generation cancellation confirmed."
            : "Tracking stopped locally; server cancellation not confirmed."
          : "Tracking paused.",
    }))
    clearPersisted()
  }, [cancelPath, clearPersisted, state.jobId, stop])

  const clearOutput = useCallback(() => {
    setState((prev) => ({
      ...prev,
      videoUrl: null,
    }))
  }, [])

  /** Stop polling, clear persisted in-progress state, and reset UI (e.g. hide completed rerender banner). */
  const dismissTrackedRun = useCallback(() => {
    cancelledRef.current = true
    stop()
    clearPersisted()
    setState({
      loading: false,
      progress: 0,
      stageText: DEFAULT_STAGE,
      error: null,
      jobId: null,
      requestId: null,
      videoUrl: null,
      jobRecord: null,
    })
  }, [clearPersisted, stop])

  useEffect(() => {
    return () => stop()
  }, [stop])

  const apiResult = useMemo(
    () => ({
      state,
      resetForNewRun,
      begin,
      resume,
      loadJobForReview,
      cancel,
      clearOutput,
      clearPersisted,
      dismissTrackedRun,
      setError: (value: string | null) => {
        setState((prev) => ({ ...prev, error: value }))
      },
    }),
    [
      begin,
      cancel,
      clearOutput,
      clearPersisted,
      dismissTrackedRun,
      loadJobForReview,
      resetForNewRun,
      resume,
      state,
    ]
  )

  return apiResult
}
