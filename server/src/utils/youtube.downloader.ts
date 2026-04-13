import path from "path"
import { mkdir } from "fs/promises"
import ytDlp from "yt-dlp-exec"

export const downloadYoutubeVideo = async (url: string) => {
  const tmpRoot = path.join(process.cwd(), "tmp")
  await mkdir(tmpRoot, { recursive: true })

  const outputPath = path.join(tmpRoot, `youtube_${Date.now()}.mp4`)

  try {
    await ytDlp(url, {
      format: "bv*+ba/b",
      mergeOutputFormat: "mp4",
      output: outputPath,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "youtube_download_failed"
    throw new Error(
      `Could not download this YouTube video. Check the link, privacy settings, and that yt-dlp can access YouTube. (${msg.slice(0, 160)})`
    )
  }

  return outputPath
}
