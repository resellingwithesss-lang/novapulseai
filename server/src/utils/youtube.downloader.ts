import { randomBytes } from "crypto"
import { existsSync, statSync } from "fs"
import { mkdir, readdir } from "fs/promises"
import path from "path"
import { log, serializeErr } from "../lib/logger"

type YtDlpExec = {
  create: (binaryPath: string) => {
    (url: string, flags?: Record<string, unknown>, opts?: Record<string, unknown>): Promise<unknown>
    exec: (
      url: string,
      flags?: Record<string, unknown>,
      opts?: Record<string, unknown>
    ) => Promise<unknown>
  }
  args: (url: string, flags?: Record<string, unknown>) => string[]
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create: createYtDlp, args: ytDlpArgs } = require("yt-dlp-exec") as YtDlpExec

/** Prefer system/binary installs; avoid relying on yt-dlp-exec postinstall (fragile in CI/Docker). */
function resolveYtDlpBinary(): string {
  const env = process.env.YT_DLP_PATH?.trim()
  if (env && existsSync(env)) return env

  const candidates = [
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  return "yt-dlp"
}

function resolveFfmpegDir(): string | undefined {
  const env = process.env.FFMPEG_PATH?.trim()
  if (env && existsSync(env)) {
    try {
      const st = statSync(env)
      return st.isDirectory() ? env : path.dirname(env)
    } catch {
      /* ignore */
    }
  }
  if (existsSync("/usr/bin/ffmpeg")) return "/usr/bin"
  return undefined
}

function classifyYoutubeDlError(stderr: string, stdout: string): string {
  const text = `${stderr}\n${stdout}`.toLowerCase()

  if (/private video|members only|privacy/i.test(text)) {
    return "This YouTube video is private or members-only. Use a public link or upload the file instead."
  }
  if (/video unavailable|removed for violating|no longer available|deleted video/i.test(text)) {
    return "This YouTube video is unavailable or was removed."
  }
  if (/copyright|blocked it in your country|not made this video available|uploader has not made/i.test(text)) {
    return "This video is blocked or restricted (copyright, region, or uploader settings)."
  }
  if (/sign in to confirm your age|age.restricted|inappropriate for some users/i.test(text)) {
    return "This video is age-restricted or requires sign-in; it cannot be downloaded by the server."
  }
  if (
    /requested format is not available|no video formats found|no formats found|nothing to download/i.test(
      text
    )
  ) {
    return "No compatible video format was found for this link. It may be a live stream, premium-only, or temporarily unavailable."
  }
  if (/live event will begin|premieres in|is live/i.test(text)) {
    return "Live or upcoming premieres cannot be downloaded as a file. Try again after the VOD is published."
  }
  if (/ffmpeg|ffprobe|merging/i.test(text) && /not found|no such file|error/i.test(text)) {
    return "Video processing failed (ffmpeg). Please try again or contact support if this persists."
  }
  if (/http error 403|403: forbidden|blocked/i.test(text)) {
    return "YouTube blocked this download request. Try again later or upload the video file instead."
  }

  return "Could not download this YouTube video. Check the link and try again, or upload the file directly."
}

async function pickOutputFile(tmpRoot: string, id: string): Promise<string> {
  const names = await readdir(tmpRoot)
  const candidates = names.filter(
    (n) =>
      n.startsWith(`${id}.`) &&
      !n.endsWith(".part") &&
      !n.endsWith(".ytdl") &&
      !n.endsWith(".temp")
  )
  if (candidates.length === 0) {
    throw new Error("YouTube download finished but no output file was found.")
  }
  const prefer = ["mp4", "mkv", "webm", "mov"]
  for (const ext of prefer) {
    const hit = candidates.find((n) => n.endsWith(`.${ext}`))
    if (hit) return path.join(tmpRoot, hit)
  }
  return path.join(tmpRoot, candidates[0])
}

function buildFlags(
  outputTemplate: string,
  format: string,
  ffmpegLocation?: string
): Record<string, unknown> {
  const flags: Record<string, unknown> = {
    format,
    mergeOutputFormat: "mp4",
    output: outputTemplate,
    noPlaylist: true,
    retries: 3,
    fragmentRetries: 3,
    noColor: true,
    noProgress: true,
    newline: false,
  }
  if (ffmpegLocation) {
    flags.ffmpegLocation = ffmpegLocation
  }
  return flags
}

function getExecaProps(err: unknown): {
  stderr?: string
  stdout?: string
  command?: string
  exitCode?: number
} {
  if (typeof err !== "object" || err === null) return {}
  const o = err as Record<string, unknown>
  return {
    stderr: typeof o.stderr === "string" ? o.stderr : undefined,
    stdout: typeof o.stdout === "string" ? o.stdout : undefined,
    command: typeof o.command === "string" ? o.command : undefined,
    exitCode: typeof o.exitCode === "number" ? o.exitCode : undefined,
  }
}

export const downloadYoutubeVideo = async (url: string): Promise<string> => {
  const tmpRoot = path.join(process.cwd(), "tmp")
  await mkdir(tmpRoot, { recursive: true })

  const id = `youtube_${Date.now()}_${randomBytes(4).toString("hex")}`
  const outputTemplate = path.join(tmpRoot, `${id}.%(ext)s`)

  const bin = resolveYtDlpBinary()
  const ffmpegDir = resolveFfmpegDir()
  const ytDlp = createYtDlp(bin)

  const primaryFlags = buildFlags(
    outputTemplate,
    "bestvideo*+bestaudio/bestvideo+bestaudio/best",
    ffmpegDir
  )
  const fallbackFlags = buildFlags(outputTemplate, "best", ffmpegDir)

  const cmdPrimary = [bin, ...ytDlpArgs(url, primaryFlags)]
  log.info("youtube_dl_command", {
    binary: bin,
    argv: cmdPrimary,
    urlHost: (() => {
      try {
        return new URL(url).hostname
      } catch {
        return "invalid_url"
      }
    })(),
  })

  const run = async (flags: Record<string, unknown>, label: "primary" | "fallback") => {
    const cmd = [bin, ...ytDlpArgs(url, flags)]
    log.info("youtube_dl_attempt", { label, argv: cmd })
    try {
      await ytDlp.exec(url, flags, {
        maxBuffer: 32 * 1024 * 1024,
        all: true,
      })
    } catch (err: unknown) {
      const { stderr, stdout, command, exitCode } = getExecaProps(err)
      log.error("youtube_dl_process_failed", {
        label,
        exitCode,
        command: command ?? cmd.join(" "),
        stderr: stderr?.slice(0, 12_000) ?? null,
        stdout: stdout?.slice(0, 4000) ?? null,
        ...serializeErr(err),
      })
      throw err
    }
  }

  try {
    try {
      await run(primaryFlags, "primary")
    } catch (first: unknown) {
      const { stderr = "", stdout = "" } = getExecaProps(first)
      const combined = `${stderr}\n${stdout}`
      const retry =
        /requested format is not available|no video formats found|unable to download video|format not available/i.test(
          combined
        )
      if (!retry) throw first
      log.warn("youtube_dl_format_fallback", {
        hint: "primary format selection failed; retrying with -f best",
      })
      await run(fallbackFlags, "fallback")
    }

    return await pickOutputFile(tmpRoot, id)
  } catch (err: unknown) {
    const { stderr = "", stdout = "" } = getExecaProps(err)
    const friendly = classifyYoutubeDlError(stderr, stdout)
    log.error("youtube_dl_failed", {
      userMessage: friendly,
      ...serializeErr(err),
    })
    throw new Error(friendly)
  }
}
