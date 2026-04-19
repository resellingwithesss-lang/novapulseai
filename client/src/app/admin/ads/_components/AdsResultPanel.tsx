"use client"

import PremiumVideoPreview, {
  coerceAdsPlatform,
  platformToPreviewAspect,
} from "@/components/media/PremiumVideoPreview"
import ToolResultLayout, {
  type ToolResultAction,
} from "@/components/tools/results/ToolResultLayout"
import { downloadMediaBlob, filenameFromPublicPath } from "@/lib/mediaOrigin"

type AdsResultPanelProps = {
  videoUrl: string
  /** When set, preview frame matches export aspect (TikTok / IG / YouTube). */
  platform?: string | null
  /** Override hero title (default: ad-focused). */
  title?: string
  summary?: string
  /** Appended after default Copy / Download / Open actions. */
  extraActions?: ToolResultAction[]
  nextSteps?: ToolResultAction[]
}

export default function AdsResultPanel({
  videoUrl,
  platform,
  title = "Your AI video ad is ready",
  summary = "Playback matches your downloadable MP4 — AI voiceover, captions, and visuals from your URL. No filming required.",
  extraActions = [],
  nextSteps,
}: AdsResultPanelProps) {
  const downloadName = (() => {
    try {
      const path = new URL(videoUrl).pathname
      return filenameFromPublicPath(path)
    } catch {
      return "NovaPulseAI-Ad.mp4"
    }
  })()

  const aspect = platformToPreviewAspect(coerceAdsPlatform(platform))

  const baseActions: ToolResultAction[] = [
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
  ]

  return (
    <ToolResultLayout
      title={title}
      state="success"
      statusLabel="Ready"
      summary={summary}
      actions={[...baseActions, ...extraActions]}
      nextSteps={
        nextSteps ?? [
          { label: "Generate another ad", href: "/dashboard/tools/story-video-maker" },
          { label: "Dashboard", href: "/dashboard" },
        ]
      }
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
