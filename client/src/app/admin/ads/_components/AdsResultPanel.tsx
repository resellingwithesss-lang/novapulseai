"use client"

import PremiumVideoPreview from "@/components/media/PremiumVideoPreview"
import ToolResultLayout from "@/components/tools/results/ToolResultLayout"
import { downloadMediaBlob, filenameFromPublicPath } from "@/lib/mediaOrigin"

type AdsResultPanelProps = {
  videoUrl: string
}

export default function AdsResultPanel({ videoUrl }: AdsResultPanelProps) {
  const downloadName = (() => {
    try {
      const path = new URL(videoUrl).pathname
      return filenameFromPublicPath(path)
    } catch {
      return "NovaPulseAI-Ad.mp4"
    }
  })()

  return (
    <ToolResultLayout
      title="Ad render"
      state="success"
      statusLabel="Ready"
      summary="Playback uses the same master file as download — captions, hook/CTA cards, and mix match what you configured."
      actions={[
        {
          label: "Copy link",
          onClick: () => {
            void navigator.clipboard.writeText(videoUrl)
          },
        },
        {
          label: "Download MP4",
          onClick: () => void downloadMediaBlob(videoUrl, downloadName),
          tone: "secondary",
        },
        {
          label: "Open",
          href: videoUrl,
          external: true,
          tone: "ghost",
        },
      ]}
      nextSteps={[
        { label: "Video script", href: "/dashboard/tools/video" },
        { label: "Clipper", href: "/dashboard/tools/clipper" },
      ]}
    >
      <PremiumVideoPreview src={videoUrl} aspect="9:16" />
    </ToolResultLayout>
  )
}
