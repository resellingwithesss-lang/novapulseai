"use client"

import PremiumVideoPreview, {
  coerceAdsPlatform,
  platformToPreviewAspect,
} from "@/components/media/PremiumVideoPreview"
import ToolResultLayout, {
  type ToolResultAction,
} from "@/components/tools/results/ToolResultLayout"
import { downloadMediaBlob, filenameFromPublicPath } from "@/lib/mediaOrigin"

type Props = {
  videoUrl: string
  platform?: string | null
  extraActions?: ToolResultAction[]
}

/**
 * Creator-facing ad result — premium copy only (no operator / pipeline language).
 */
export default function UserAdVideoOutput({ videoUrl, platform, extraActions = [] }: Props) {
  const downloadName = (() => {
    try {
      const path = new URL(videoUrl).pathname
      return filenameFromPublicPath(path)
    } catch {
      return "NovaPulseAI-ad.mp4"
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
      label: "Download video",
      onClick: () => void downloadMediaBlob(videoUrl, downloadName),
      tone: "secondary",
    },
    {
      label: "Open in new tab",
      href: videoUrl,
      external: true,
      tone: "ghost",
    },
  ]

  return (
    <ToolResultLayout
      title="Your AI ad is ready"
      state="success"
      statusLabel="Ready to post"
      summary="Full video with AI voiceover, visuals, and captions — no camera or edit suite required. Download matches what you see here."
      actions={[...baseActions, ...extraActions]}
      nextSteps={[
        { label: "Create another ad", href: "/dashboard/tools/ai-ad-generator" },
        { label: "Dashboard", href: "/dashboard" },
      ]}
    >
      <PremiumVideoPreview
        src={videoUrl}
        aspect={aspect}
        label="Preview"
        footnote="Aspect matches the platform you chose (TikTok, Instagram, or YouTube)."
      />
    </ToolResultLayout>
  )
}
