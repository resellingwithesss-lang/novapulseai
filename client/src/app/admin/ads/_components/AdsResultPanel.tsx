"use client"

import ToolResultLayout from "@/components/tools/results/ToolResultLayout"
import { downloadMediaBlob, filenameFromPublicPath } from "@/lib/mediaOrigin"

type AdsResultPanelProps = {
  videoUrl: string
}

export default function AdsResultPanel({
  videoUrl,
}: AdsResultPanelProps) {
  const downloadName = (() => {
    try {
      const path = new URL(videoUrl).pathname
      return filenameFromPublicPath(path)
    } catch {
      return "video.mp4"
    }
  })()

  return (
    <ToolResultLayout
      title="Generated Video"
      state="success"
      statusLabel="Completed"
      summary="Your ad render is ready. Download or open the video, then continue to script and clip workflows."
      actions={[
        {
          label: "Copy Link",
          onClick: () => {
            void navigator.clipboard.writeText(videoUrl)
          },
        },
        {
          label: "Download",
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
        { label: "Create Next Script", href: "/dashboard/tools/video" },
        { label: "Repurpose with Clipper", href: "/dashboard/tools/clipper" },
      ]}
    >
      <video
        src={videoUrl}
        controls
        playsInline
        preload="metadata"
        className="w-full rounded-xl border border-white/10"
      />
    </ToolResultLayout>
  )
}
