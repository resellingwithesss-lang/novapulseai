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

const CHROME_LIKE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

const isProduction = process.env.NODE_ENV === "production"

/** Prefer system/binary installs; avoid relying on yt-dlp-exec postinstall (fragile in CI/Docker). */
function resolveYtDlpBinary(): string {
  const env = process.env.YT_DLP_PATH?.trim()
  if (env && existsSync(env)) return env

  const candidates = ["/usr/local/bin/yt-dlp", "/usr/bin/yt-dlp"]
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

function resolveCookiesPath(): string | undefined {
  const raw = process.env.YT_DLP_COOKIES?.trim()
  if (!raw) return undefined
  if (!existsSync(raw)) {
    log.warn("youtube_dl_cookies_missing", { path: raw })
    return undefined
  }
  return raw
}

/** User-facing categories for the clip UI / API. */
function classifyYoutubeDlError(stderr: string, stdout: string): string {
  const text = `${stderr}\n${stdout}`.toLowerCase()

  if (/private video|members only|is private|privacy status/i.test(text)) {
    return "Private video: this link is not publicly accessible. Upload the file instead or use a public URL."
  }
  if (
    /not available in your country|blocked in your country|from your location|blackout|geo.?restricted|only available in\b/i.test(
      text
    )
  ) {
    return "Region blocked: YouTube is not serving this video to our server's region. Try uploading the file, or set YT_DLP_COOKIES if you have a valid export."
  }
  if (
    /sign in to confirm your age|age.restricted|inappropriate for some users|confirm your age/i.test(text)
  ) {
    return "Age restricted: this video requires a signed-in viewer. Server downloads cannot satisfy age verification; try YT_DLP_COOKIES or upload the file."
  }
  if (
    /video unavailable|removed for violating|no longer available|deleted video|this video does not exist|unavailable/i.test(
      text
    )
  ) {
    return "Unavailable: this video was removed, is offline, or the ID is invalid."
  }

  return "Download failed: YouTube did not return a file we could save. Try again later, another link, or upload the source video."
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

type AttemptSpec = {
  name: string
  format: string
  mergeMp4: boolean
  forceIpv4: boolean
}

function buildFlags(
  outputTemplate: string,
  spec: AttemptSpec,
  ffmpegDir: string | undefined,
  cookiesPath: string | undefined
): Record<string, unknown> {
  const flags: Record<string, unknown> = {
    format: spec.format,
    output: outputTemplate,
    noPlaylist: true,
    noCheckCertificate: true,
    geoBypass: true,
    geoBypassCountry: "US",
    userAgent: CHROME_LIKE_UA,
    retries: 3,
    fragmentRetries: 3,
    noColor: true,
    noProgress: true,
    newline: false,
  }

  if (cookiesPath) {
    flags.cookies = cookiesPath
  }

  if (spec.forceIpv4) {
    flags.forceIpv4 = true
  }

  if (spec.mergeMp4) {
    flags.mergeOutputFormat = "mp4"
    if (ffmpegDir) {
      flags.ffmpegLocation = ffmpegDir
    }
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

const ATTEMPTS: AttemptSpec[] = [
  { name: "bv_ba_merge", format: "bv*+ba/b", mergeMp4: true, forceIpv4: false },
  { name: "best_merge", format: "best", mergeMp4: true, forceIpv4: false },
  { name: "best_no_merge", format: "best", mergeMp4: false, forceIpv4: false },
  { name: "best_no_merge_ipv4", format: "best", mergeMp4: false, forceIpv4: true },
]

export const downloadYoutubeVideo = async (url: string): Promise<string> => {
  const tmpRoot = path.join(process.cwd(), "tmp")
  await mkdir(tmpRoot, { recursive: true })

  const id = `youtube_${Date.now()}_${randomBytes(4).toString("hex")}`
  const outputTemplate = path.join(tmpRoot, `${id}.%(ext)s`)

  const bin = resolveYtDlpBinary()
  const ffmpegDir = resolveFfmpegDir()
  const cookiesPath = resolveCookiesPath()
  const ytDlp = createYtDlp(bin)

  let lastStderr = ""
  let lastStdout = ""
  let lastCommand = ""
  let lastExitCode: number | undefined

  for (let i = 0; i < ATTEMPTS.length; i++) {
    const spec = ATTEMPTS[i]
    const attemptNum = i + 1
    const flags = buildFlags(outputTemplate, spec, ffmpegDir, cookiesPath)
    const argv = [bin, ...ytDlpArgs(url, flags)]

    log.info("youtube_dl_attempt_start", {
      attempt: attemptNum,
      total: ATTEMPTS.length,
      strategy: spec.name,
      argv,
      urlHost: (() => {
        try {
          return new URL(url).hostname
        } catch {
          return "invalid_url"
        }
      })(),
      cookies: Boolean(cookiesPath),
    })

    try {
      await ytDlp.exec(url, flags, {
        maxBuffer: 64 * 1024 * 1024,
        all: true,
      })
      log.info("youtube_dl_attempt_ok", {
        attempt: attemptNum,
        strategy: spec.name,
      })
      return await pickOutputFile(tmpRoot, id)
    } catch (err: unknown) {
      const { stderr, stdout, command, exitCode } = getExecaProps(err)
      lastStderr = stderr ?? ""
      lastStdout = stdout ?? ""
      lastCommand = command ?? argv.join(" ")
      lastExitCode = exitCode

      log.error("youtube_dl_attempt_failed", {
        attempt: attemptNum,
        total: ATTEMPTS.length,
        strategy: spec.name,
        exitCode,
        command: lastCommand,
        stderr: lastStderr,
        stdout: lastStdout,
        ...serializeErr(err),
      })
    }
  }

  const friendly = classifyYoutubeDlError(lastStderr, lastStdout)
  const devDetail =
    !isProduction && (lastStderr || lastStdout)
      ? `\n\n--- yt-dlp raw (dev) ---\nexit=${lastExitCode ?? "?"}\n${lastCommand}\n\n${lastStderr}\n${lastStdout}`
      : ""

  log.error("youtube_dl_exhausted_retries", {
    userMessage: friendly,
    exitCode: lastExitCode,
    attempts: ATTEMPTS.length,
  })

  throw new Error(friendly + devDetail)
}
