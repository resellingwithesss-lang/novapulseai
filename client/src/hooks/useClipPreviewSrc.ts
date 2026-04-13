"use client"

import { useEffect, useState } from "react"

const MAX_BLOB_BYTES = 120 * 1024 * 1024

function isApiMediaPath(pathname: string): boolean {
  return (
    pathname.startsWith("/clips/") ||
    pathname.startsWith("/generated/") ||
    pathname === "/clips" ||
    pathname === "/generated"
  )
}

/**
 * Cross-origin `<video src="http://api.../clip.mp4">` often fails in-page (Range/CSP/codec)
 * while the same URL works when downloaded. Loading into a blob URL makes playback reliable.
 *
 * Same-origin `/clips` / `/generated` URLs must still use fetch → blob (not `<video src>`
 * through Next) so playback does not depend on proxied Range behavior.
 */
export function useClipPreviewSrc(absoluteUrl: string): {
  src: string | null
  loading: boolean
} {
  const [src, setSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const blobRef = { current: null as string | null }
    let cancelled = false

    const revokeCreated = () => {
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current)
        blobRef.current = null
      }
    }

    const run = async () => {
      setLoading(true)
      setSrc(null)
      let mediaUrl = absoluteUrl
      try {
        let u: URL
        try {
          u = new URL(absoluteUrl)
        } catch {
          if (!cancelled) {
            setSrc(absoluteUrl)
            setLoading(false)
          }
          return
        }

        if (
          typeof window !== "undefined" &&
          u.origin === window.location.origin &&
          !isApiMediaPath(u.pathname)
        ) {
          if (!cancelled) {
            setSrc(mediaUrl)
            setLoading(false)
          }
          return
        }

        const res = await fetch(mediaUrl, { credentials: "omit", mode: "cors" })
        if (!res.ok) throw new Error(String(res.status))
        const len = Number(res.headers.get("content-length") || 0)
        if (len > MAX_BLOB_BYTES) {
          if (!cancelled) {
            setSrc(mediaUrl)
            setLoading(false)
          }
          return
        }
        const buf = await res.arrayBuffer()
        if (cancelled) return
        if (buf.byteLength > MAX_BLOB_BYTES) {
          setSrc(mediaUrl)
          setLoading(false)
          return
        }
        revokeCreated()
        const created = URL.createObjectURL(new Blob([buf], { type: "video/mp4" }))
        blobRef.current = created
        if (cancelled) {
          URL.revokeObjectURL(created)
          blobRef.current = null
          return
        }
        setSrc(created)
      } catch {
        if (!cancelled) setSrc(mediaUrl)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
      revokeCreated()
    }
  }, [absoluteUrl])

  return { src, loading }
}
