"use client"

import PremiumVideoPreview, {
  coerceAdsPlatform,
  platformToPreviewAspect,
} from "@/components/media/PremiumVideoPreview"
import ToolResultLayout from "@/components/tools/results/ToolResultLayout"
import { downloadMediaBlob, filenameFromPublicPath } from "@/lib/mediaOrigin"

type AdsResultPanelProps = {
  videoUrl: string
  /** When set, preview frame matches export aspect (TikTok / IG / YouTube). */
  platform?: string | null
}

export default function AdsResultPanel({ videoUrl, platform }: AdsResultPanelProps) {
  const downloadName = (() => {
    try {
      const path = new URL(videoUrl).pathname
      return filenameFromPublicPath(path)
    } catch {
      return "NovaPulseAI-Ad.mp4"
    }
  })()

  const aspect = platformToPreviewAspect(coerceAdsPlatform(platform))

  return (
    <ToolResultLayout
      title="Ad render"
      state="success"
      statusLabel="Ready"
      summary="Playback is the same encoded master as your MP4 download — captions, cards, and mix match the job settings. In-browser letterboxing only reflects player layout, not a separate render."
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
      <PremiumVideoPreview
        src={videoUrl}
        aspect={aspect}
        label="Master render"
        footnote="Aspect follows your platform target (9:16, 1:1, or 16:9). Use download for the exact file you will ship."
      />
    </ToolResultLayout>
  )
}
