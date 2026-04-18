import { existsSync, statSync } from "fs"
import path from "path"
import { log } from "../lib/logger"

const CHROME_LIKE_UA_NOTE = "Chrome-like UA is set in the downloader; cookies authenticate the session."

/** How `YT_DLP_COOKIES` resolved for this process (no file contents logged). */
export type YoutubeCookiesStatus =
  | "not_configured"
  | "env_set_path_missing"
  | "path_not_file"
  | "file_empty"
  | "readable"

export type YoutubeCookiesResolution = {
  status: YoutubeCookiesStatus
  /** Absolute path only when status is `readable` — passed to yt-dlp `--cookies`. */
  pathForYtDlp?: string
  /** Raw configured value length only (not the value). */
  envWasSet: boolean
}

export function resolveYoutubeCookiesForYtDlp(): YoutubeCookiesResolution {
  const raw = process.env.YT_DLP_COOKIES?.trim()
  if (!raw) {
    return { status: "not_configured", envWasSet: false }
  }
  const cleaned = raw.replace(/^["']|["']$/g, "")
  let resolved: string
  try {
    resolved = path.resolve(path.normalize(cleaned))
  } catch {
    return { status: "env_set_path_missing", envWasSet: true }
  }
  if (!existsSync(resolved)) {
    return { status: "env_set_path_missing", envWasSet: true }
  }
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(resolved)
  } catch {
    return { status: "env_set_path_missing", envWasSet: true }
  }
  if (!st.isFile()) {
    return { status: "path_not_file", envWasSet: true }
  }
  if (st.size <= 0) {
    return { status: "file_empty", envWasSet: true }
  }
  return { status: "readable", pathForYtDlp: resolved, envWasSet: true }
}

export function resolveYtDlpBinaryPath(): string {
  const env = process.env.YT_DLP_PATH?.trim()
  if (env && existsSync(env)) return env
  const candidates = ["/usr/local/bin/yt-dlp", "/usr/bin/yt-dlp"]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return "yt-dlp"
}

export function resolveFfmpegBinDir(): string | undefined {
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

function ytDlpBinaryExistsOnDisk(bin: string): boolean {
  if (bin === "yt-dlp") return false
  return existsSync(bin)
}

function ffmpegBinaryExists(ffmpegDir: string | undefined): boolean {
  if (!ffmpegDir) return false
  const bin = path.join(ffmpegDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
  return existsSync(bin)
}

function parseJsRuntimePaths(): { label: string; path: string }[] {
  const raw =
    process.env.YT_DLP_JS_RUNTIMES?.trim() ||
    "deno:/usr/local/bin/deno,node:/usr/local/bin/node"
  const out: { label: string; path: string }[] = []
  for (const part of raw.split(",")) {
    const seg = part.trim()
    const idx = seg.indexOf(":")
    if (idx <= 0) continue
    const label = seg.slice(0, idx).trim()
    const p = seg.slice(idx + 1).trim()
    if (label && p) out.push({ label, path: p })
  }
  return out
}

export type YoutubeIngestHealthSnapshot = {
  ytDlp: {
    binary: string
    /** True when `binary` is an absolute path that exists on disk. */
    binaryFilePresent: boolean
  }
  ffmpeg: {
    binDir?: string
    ffmpegPresent: boolean
  }
  jsRuntimes: {
    /** Each entry: label + whether the configured path exists. */
    entries: { label: string; path: string; present: boolean }[]
  }
  cookies: {
    status: YoutubeCookiesStatus
    /** True when a non-empty cookies file is passed to yt-dlp. */
    willPassToYtDlp: boolean
    /** Human hint for operators (no secrets). */
    hint: string
  }
  notes: string[]
}

export function getYoutubeIngestHealthSnapshot(): YoutubeIngestHealthSnapshot {
  const bin = resolveYtDlpBinaryPath()
  const ffmpegDir = resolveFfmpegBinDir()
  const cookieRes = resolveYoutubeCookiesForYtDlp()
  const jsEntries = parseJsRuntimePaths().map((e) => ({
    label: e.label,
    path: e.path,
    present: existsSync(e.path),
  }))

  const notes: string[] = []
  notes.push(CHROME_LIKE_UA_NOTE)
  if (bin === "yt-dlp" && !ytDlpBinaryExistsOnDisk(bin)) {
    notes.push("yt-dlp resolved to PATH name only — ensure the binary is installed and on PATH in the container.")
  }

  let cookiesHint = ""
  switch (cookieRes.status) {
    case "not_configured":
      cookiesHint =
        "No cookies file configured. YouTube often challenges datacenter IPs; export Netscape cookies.txt and set the operator env (see docs/YOUTUBE_CLIPPER_OPERATORS.md)."
      break
    case "env_set_path_missing":
      cookiesHint =
        "Cookies env is set but the path does not exist on this host. Check Railway volume mount path and redeploy."
      break
    case "path_not_file":
      cookiesHint = "Cookies path exists but is not a regular file (use a file, not a directory)."
      break
    case "file_empty":
      cookiesHint = "Cookies file is empty — export again from a logged-in browser session."
      break
    case "readable":
      cookiesHint = "Cookies file is present and non-empty — yt-dlp will receive --cookies for each run."
      break
    default:
      cookiesHint = ""
  }

  return {
    ytDlp: {
      binary: bin,
      binaryFilePresent: ytDlpBinaryExistsOnDisk(bin),
    },
    ffmpeg: {
      binDir: ffmpegDir,
      ffmpegPresent: ffmpegBinaryExists(ffmpegDir),
    },
    jsRuntimes: { entries: jsEntries },
    cookies: {
      status: cookieRes.status,
      willPassToYtDlp: cookieRes.status === "readable",
      hint: cookiesHint,
    },
    notes,
  }
}

/** Call once after env is loaded (e.g. from `index.ts`). */
export function logYoutubeIngestStartupDiagnostics(): void {
  const snap = getYoutubeIngestHealthSnapshot()
  const cookie = snap.cookies
  const cookieLogKey =
    cookie.status === "readable"
      ? "youtube_ingest_startup_cookies_ok"
      : cookie.status === "not_configured"
        ? "youtube_ingest_startup_cookies_missing"
        : "youtube_ingest_startup_cookies_invalid"

  log.info("youtube_ingest_startup", {
    ytDlpBinary: snap.ytDlp.binary,
    ytDlpBinaryFilePresent: snap.ytDlp.binaryFilePresent,
    ffmpegBinDir: snap.ffmpeg.binDir ?? null,
    ffmpegPresent: snap.ffmpeg.ffmpegPresent,
    jsRuntimes: snap.jsRuntimes.entries,
    cookiesStatus: cookie.status,
    cookiesWillPassToYtDlp: cookie.willPassToYtDlp,
    operatorDoc: "docs/YOUTUBE_CLIPPER_OPERATORS.md",
  })

  log.info(cookieLogKey, {
    cookiesStatus: cookie.status,
    hint: cookie.hint,
  })

  /**
   * Legacy bake path — the Dockerfile no longer copies `server/cookies.txt`
   * into `/app/cookies.txt` (that COPY broke builds when the file was absent
   * from the build context). Some deploys still place a cookies file at
   * `/app/cookies.txt` via a custom overlay / volume mount, so we continue
   * to log whether it's present, but the missing case is expected and not
   * actionable on its own. Never log file contents.
   */
  const bakedCookiesPath = "/app/cookies.txt"
  let bakedCookiesPresent = false
  try {
    if (existsSync(bakedCookiesPath)) {
      const st = statSync(bakedCookiesPath)
      bakedCookiesPresent = st.isFile() && st.size > 0
    }
  } catch {
    bakedCookiesPresent = false
  }

  if (bakedCookiesPresent) {
    log.info("youtube_operator_baked_cookies_found", {
      message:
        "Cookies file found at /app/cookies.txt — set YT_DLP_COOKIES=/app/cookies.txt to use it (file contents never logged).",
      path: bakedCookiesPath,
    })
  } else {
    log.info("youtube_operator_baked_cookies_missing", {
      message:
        "No cookies file at /app/cookies.txt (expected on default builds). To supply cookies, mount a Netscape cookies file at any path and set YT_DLP_COOKIES to its absolute path. See docs/YOUTUBE_CLIPPER_OPERATORS.md.",
      path: bakedCookiesPath,
    })
  }
}
