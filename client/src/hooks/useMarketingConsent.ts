"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError } from "@/lib/api"
import {
  fetchMarketingConsent,
  updateMarketingConsent,
  type ConsentAction,
  type ConsentResponse,
  type ConsentSurface,
} from "@/lib/marketingApi"
import { useAuth } from "@/context/AuthContext"

type UseMarketingConsentOptions = {
  /** Load full consent record on mount. Pass false to only track what's in /auth/me. */
  eager?: boolean
}

/**
 * Premium consent controller shared by the dashboard banner, settings card,
 * and billing marketing card. Deliberately single-purpose so every surface
 * mutates consent through the same code path (one audit row, one refresh).
 */
export function useMarketingConsent(options: UseMarketingConsentOptions = {}) {
  const { user, refreshUser } = useAuth()
  const [consent, setConsent] = useState<ConsentResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchMarketingConsent()
      if (mounted.current) setConsent(data)
    } catch (e) {
      if (mounted.current) {
        setError((e as ApiError)?.message ?? "Could not load your preferences.")
      }
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    if (options.eager === false) return
    void load()
  }, [user, options.eager, load])

  const submit = useCallback(
    async (action: ConsentAction, source: ConsentSurface) => {
      setSaving(true)
      setError(null)
      try {
        const data = await updateMarketingConsent({ action, source })
        if (mounted.current) setConsent(data)
        // Refresh /auth/me so other surfaces (nav, settings) see the new status.
        await refreshUser({ silent: true })
        return data
      } catch (e) {
        const msg = (e as ApiError)?.message ?? "Could not save. Try again."
        if (mounted.current) setError(msg)
        throw e
      } finally {
        if (mounted.current) setSaving(false)
      }
    },
    [refreshUser]
  )

  return {
    consent,
    loading,
    saving,
    error,
    reload: load,
    optIn: (source: ConsentSurface) => submit("opt_in", source),
    optOut: (source: ConsentSurface) => submit("opt_out", source),
    dismiss: (source: ConsentSurface) => submit("dismiss", source),
  }
}
