"use client"

import { useClipPreviewSrc } from "@/hooks/useClipPreviewSrc"

type ClipPreviewVideoProps = {
  absoluteUrl: string
  className?: string
}

export default function ClipPreviewVideo({
  absoluteUrl,
  className = "w-full rounded-lg bg-black",
}: ClipPreviewVideoProps) {
  const { src, loading } = useClipPreviewSrc(absoluteUrl)

  if (loading) {
    return (
      <div
        className="flex aspect-[9/16] max-h-[min(520px,70vh)] w-full max-w-sm mx-auto items-center justify-center rounded-lg bg-white/5 text-xs text-white/45"
        aria-busy="true"
      >
        Loading preview…
      </div>
    )
  }

  const resolved = src ?? absoluteUrl
  const needsCors = /^https?:\/\//i.test(resolved)
  return (
    <video
      key={resolved}
      src={resolved}
      crossOrigin={needsCors ? "anonymous" : undefined}
      controls
      playsInline
      className={className}
      preload="metadata"
    />
  )
}
