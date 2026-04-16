import { randomBytes } from "crypto"
import { existsSync, statSync } from "fs"
import { mkdir, readdir, rm } from "fs/promises"
import path from "path"
import { log, serializeErr } from "../lib/logger"

type YtDlpExec = {
  create: (binaryPath: string) => {
    (url: string, flags?: Record<string, unknown>, opts?: Record<string, unknown>): Promise<unknown>
    exec: (
      url: string,
      flags?: Record<string, unknown>,
      opts?: Record<string, unknown>
    ) => Promise<{ stdout?: string; stderr?: string; exitCode?: number }>
  }
  args: (url: string, flags?: Record<string, unknown>) => string[]
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create: createYtDlp, args: ytDlpArgs } = require("yt-dlp-exec") as YtDlpExec

const CHROME_LIKE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

const isProduction = process.env.NODE_ENV === "production"

/** TEMP (remove after prod debugging): grep Railway logs for this exact substring. */
const CLIPPER_YT_FILE_PICK_DEBUG = "CLIPPER_YT_FILE_PICK_DEBUG"

function debugYoutubeFilePick(phase: string, fields: Record<string, unknown>): void {
  log.warn(`${CLIPPER_YT_FILE_PICK_DEBUG} | ${phase}`, {
    _clipperYtDebug: true,
    phase,
    ...fields,
  })
}

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".webm",
  ".mov",
  ".m4v",
  ".avi",
  ".mpeg",
  ".mpg",
  ".flv",
])

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

function isPathUnderRoot(file: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(file))
  return rel !== "" && !rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel)
}

function pushResolvedPathIfFileExists(rawPath: string, out: string[]): void {
  let p = rawPath.trim().replace(/^["']|["']$/g, "")
  if (!p) return
  try {
    const resolved = path.resolve(path.normalize(p))
    if (existsSync(resolved) && statSync(resolved).isFile()) {
      out.push(resolved)
    }
  } catch {
    /* ignore */
  }
}

/**
 * Lines from yt-dlp that look like existing filesystem paths:
 * - plain absolute paths (incl. after_move:filepath)
 * - "[download] Destination: …" (often the only path line when --print is missing)
 * - "Merging formats into …"
 */
function extractCandidatePathsFromOutput(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    const destBracket = line.match(/^\[download\]\s+Destination:\s*(.+)$/i)
    if (destBracket) {
      pushResolvedPathIfFileExists(destBracket[1], out)
      continue
    }

    const mergeInto = line.match(/Merging formats into\s+"([^"]+)"/i)
    if (mergeInto) {
      pushResolvedPathIfFileExists(mergeInto[1], out)
      continue
    }
    const mergeIntoUnquoted = line.match(/Merging formats into\s+(\S[^\r\n]*\.(?:mp4|mkv|webm|mov))/i)
    if (mergeIntoUnquoted) {
      pushResolvedPathIfFileExists(mergeIntoUnquoted[1], out)
      continue
    }

    if (/^\[/.test(line)) continue

    let plain = line.replace(/^["']|["']$/g, "")
    if (!plain) continue

    if (plain.startsWith("/") && !plain.includes("://")) {
      pushResolvedPathIfFileExists(plain, out)
      continue
    }
    if (/^[A-Za-z]:[\\/]/.test(plain)) {
      pushResolvedPathIfFileExists(plain, out)
    }
  }
  return [...new Set(out)]
}

function classifyYoutubeDlError(stderr: string, stdout: string): string {
  const text = `${stderr}\n${stdout}`.toLowerCase()

  if (/no such option:\s*--no-newline|no such option:.*newline/i.test(text)) {
    return "Server misconfiguration: the API is running an outdated build that passes an invalid yt-dlp flag. Redeploy the latest server image."
  }
  if (/no such option:/i.test(text)) {
    return "Server misconfiguration: an invalid yt-dlp option was passed. Check server logs for the exact flag and redeploy."
  }
  if (/sign in to confirm you.?re not a bot|not a bot|bot check/i.test(text)) {
    return "YouTube blocked automated access (bot check). Try again later, set YT_DLP_COOKIES, or upload the video file."
  }
  if (/no supported javascript runtime|javascript runtime|ejs\b|formats may be missing/i.test(text)) {
    return "YouTube extraction is degraded on this server (JavaScript runtime / EJS). Update yt-dlp or install a JS runtime per yt-dlp docs, or upload the file."
  }
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
  if (/merger|merging|post-?process|ffmpeg exited|encoder|conversion failed|error running/i.test(text)) {
    return "Merge failed: the video downloaded but combining streams failed. Try again or upload the file."
  }
  if (
    /requested format is not available|no video formats found|unable to download video|format not available|nothing to download/i.test(
      text
    )
  ) {
    return "Format failed: no compatible stream was available for this link."
  }
  if (/unable to rename|error.*rename|interrupted|incomplete/i.test(text)) {
    return "Download interrupted: the transfer did not finish. Try again or upload the file."
  }

  return "Download failed: YouTube did not return a file we could save. Try again later, another link, or upload the source video."
}

/** yt-dlp fragment / partial naming: video.f303.mp4, .part, etc. */
function isPartialOrTempName(basename: string): boolean {
  const lower = basename.toLowerCase()
  if (lower.endsWith(".part")) return true
  if (lower.endsWith(".ytdl")) return true
  if (lower.endsWith(".temp")) return true
  if (lower.includes(".part.")) return true
  if (/\.f\d+\.[a-z0-9]+$/i.test(basename)) return true
  return false
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries: import("fs").Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const full = path.join(dir, String(ent.name))
      if (ent.isDirectory()) await walk(full)
      else out.push(full)
    }
  }
  await walk(root)
  return out
}

async function validateMediaFile(p: string): Promise<{ size: number; ext: string }> {
  if (!existsSync(p)) {
    throw new Error("Download completed but file missing: path does not exist after selection.")
  }
  const st = statSync(p)
  if (!st.isFile()) {
    throw new Error("Download completed but selection is not a file.")
  }
  if (st.size <= 0) {
    throw new Error("Download completed but the file is empty (0 bytes).")
  }
  const ext = path.extname(p).toLowerCase()
  if (!VIDEO_EXTENSIONS.has(ext)) {
    throw new Error(`Download completed but extension ${ext} is not a supported video container.`)
  }
  if (p.toLowerCase().endsWith(".part")) {
    throw new Error("Download completed but the selected file is still a partial (.part).")
  }
  return { size: st.size, ext }
}

/**
 * Prefer yt-dlp printed paths; else largest completed video under jobDir (skip fragments if a merged file exists).
 */
async function resolveOutputVideoPath(args: {
  jobDir: string
  stdout: string
  stderr: string
  filesBefore: Set<string>
  attempt: number
  strategy: string
}): Promise<string> {
  const { jobDir, stdout, stderr, filesBefore, attempt, strategy } = args
  const combinedOut = `${stdout}\n${stderr}`
  const printed = extractCandidatePathsFromOutput(combinedOut)

  debugYoutubeFilePick("PICK_ENTER", {
    attempt,
    strategy,
    jobDir,
    stdoutLen: stdout.length,
    stderrLen: stderr.length,
    stdoutTail: stdout.length > 2500 ? stdout.slice(-2500) : stdout,
    stderrTail: stderr.length > 1500 ? stderr.slice(-1500) : stderr,
    filesBeforeCount: filesBefore.size,
  })

  debugYoutubeFilePick("PICK_PRINTED_PATHS", {
    attempt,
    strategy,
    jobDir,
    printedCount: printed.length,
    printedPaths: printed,
  })

  for (const p of printed.reverse()) {
    const n = path.resolve(p)
    if (!isPathUnderRoot(n, jobDir)) {
      debugYoutubeFilePick("PICK_PRINTED_SKIP", {
        attempt,
        strategy,
        path: n,
        reason: "not_under_jobDir",
      })
      continue
    }
    if (isPartialOrTempName(path.basename(n))) {
      debugYoutubeFilePick("PICK_PRINTED_SKIP", {
        attempt,
        strategy,
        path: n,
        reason: "partial_or_temp_name",
      })
      continue
    }
    try {
      const v = await validateMediaFile(n)
      debugYoutubeFilePick("PICK_PRINTED_SELECTED", {
        attempt,
        strategy,
        path: n,
        sizeBytes: v.size,
        ext: v.ext,
        exists: existsSync(n),
      })
      return n
    } catch (e) {
      debugYoutubeFilePick("PICK_PRINTED_SKIP", {
        attempt,
        strategy,
        path: n,
        reason: "validate_failed",
        validateError: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const after = await listFilesRecursive(jobDir)
  const newFiles = after.filter((p) => !filesBefore.has(path.normalize(p)))
  const videoCandidates = newFiles.filter((p) => {
    const base = path.basename(p)
    if (isPartialOrTempName(base)) return false
    const ext = path.extname(p).toLowerCase()
    if (!VIDEO_EXTENSIONS.has(ext)) return false
    return true
  })

  const stats = videoCandidates
    .map((p) => {
      try {
        const st = statSync(p)
        return { p, size: st.size, base: path.basename(p), isFrag: /\.f\d+\./i.test(path.basename(p)) }
      } catch {
        return null
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.size > 0)

  if (stats.length === 0) {
    debugYoutubeFilePick("PICK_FALLBACK_NO_CANDIDATES", {
      attempt,
      strategy,
      jobDir,
      newFilesCount: newFiles.length,
      newFilesSample: newFiles.slice(0, 30),
      videoCandidatesCount: videoCandidates.length,
    })
    throw new Error("Download completed but no valid video file was found in the job directory.")
  }

  const merged = stats.filter((s) => !s.isFrag)
  const pool = merged.length ? merged : stats
  pool.sort((a, b) => b.size - a.size)
  const best = pool[0].p

  debugYoutubeFilePick("PICK_FALLBACK_POOL", {
    attempt,
    strategy,
    jobDir,
    usedNonFragmentOnly: merged.length > 0,
    poolSize: pool.length,
    topCandidates: pool.slice(0, 8).map((s) => ({
      path: s.p,
      base: s.base,
      sizeBytes: s.size,
      isFrag: s.isFrag,
    })),
  })

  const v = await validateMediaFile(best)
  debugYoutubeFilePick("PICK_FALLBACK_SELECTED", {
    attempt,
    strategy,
    path: best,
    sizeBytes: v.size,
    ext: v.ext,
    exists: existsSync(best),
  })
  return best
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
    /** Final filepath is printed to stdout after post-process / merge (source of truth when present). */
    print: "after_move:filepath",
    noPlaylist: true,
    noCheckCertificate: true,
    geoBypass: true,
    geoBypassCountry: "US",
    userAgent: CHROME_LIKE_UA,
    retries: 3,
    fragmentRetries: 3,
    noColor: true,
    noProgress: true,
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
  const jobDir = path.resolve(tmpRoot, `yt_job_${id}`)
  await rm(jobDir, { recursive: true, force: true }).catch(() => {})
  await mkdir(jobDir, { recursive: true })

  /** Fixed stem inside isolated dir — avoids matching wrong files in shared tmp/. */
  const outputTemplate = path.join(jobDir, "video.%(ext)s")

  const bin = resolveYtDlpBinary()
  const ffmpegDir = resolveFfmpegDir()
  const cookiesPath = resolveCookiesPath()
  const ytDlp = createYtDlp(bin)

  let lastStderr = ""
  let lastStdout = ""
  let lastCommand = ""
  let lastExitCode: number | undefined
  /** True when yt-dlp exited successfully but we could not resolve/validate the output file. */
  let lastProblemWasResolution = false

  for (let i = 0; i < ATTEMPTS.length; i++) {
    const spec = ATTEMPTS[i]
    const attemptNum = i + 1

    await rm(jobDir, { recursive: true, force: true }).catch(() => {})
    await mkdir(jobDir, { recursive: true })

    const filesBeforeList = await listFilesRecursive(jobDir)
    const filesBefore = new Set(filesBeforeList.map((p) => path.normalize(p)))

    const flags = buildFlags(outputTemplate, spec, ffmpegDir, cookiesPath)
    const argv = [bin, ...ytDlpArgs(url, flags)]

    log.info("youtube_dl_attempt_start", {
      attempt: attemptNum,
      total: ATTEMPTS.length,
      strategy: spec.name,
      jobDir,
      /** If true, an old build is still running (bad dargs + newline:false). Must be false after fix. */
      argvContainsNoNewline: argv.some((a) => /no-newline/i.test(String(a))),
      argvJoined: argv.join(" "),
      filesBefore: filesBeforeList,
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
      const result = (await ytDlp.exec(url, flags, {
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
      })) as { stdout?: string; stderr?: string; exitCode?: number }

      const stdout = result.stdout ?? ""
      const stderr = result.stderr ?? ""
      const exitCode = result.exitCode ?? 0

      const filesAfterList = await listFilesRecursive(jobDir)
      const filesAfterMeta = filesAfterList.map((p) => {
        try {
          const st = statSync(p)
          return {
            path: p,
            size: st.isFile() ? st.size : 0,
            ext: path.extname(p).toLowerCase(),
            isFile: st.isFile(),
          }
        } catch {
          return { path: p, size: 0, ext: path.extname(p).toLowerCase(), isFile: false }
        }
      })

      let selected: string
      try {
        selected = await resolveOutputVideoPath({
          jobDir,
          stdout,
          stderr,
          filesBefore,
          attempt: attemptNum,
          strategy: spec.name,
        })
      } catch (pickErr) {
        lastProblemWasResolution = true
        lastStdout = stdout
        lastStderr = stderr
        lastExitCode = exitCode
        lastCommand = argv.join(" ")
        log.error("youtube_dl_output_pick_failed", {
          attempt: attemptNum,
          strategy: spec.name,
          exitCode,
          jobDir,
          stdout,
          stderr,
          filesAfter: filesAfterMeta,
          pickError: pickErr instanceof Error ? pickErr.message : String(pickErr),
        })
        continue
      }

      const validated = await validateMediaFile(selected)

      debugYoutubeFilePick("PICK_PIPELINE_RETURN", {
        attempt: attemptNum,
        strategy: spec.name,
        jobDir,
        selectedOutput: selected,
        selectedSizeBytes: validated.size,
        selectedExt: validated.ext,
        selectedExists: existsSync(selected),
      })

      log.info("youtube_dl_attempt_ok", {
        attempt: attemptNum,
        strategy: spec.name,
        jobDir,
        exitCode,
        stdout,
        stderr,
        filesAfter: filesAfterMeta,
        selectedOutput: selected,
        selectedExists: existsSync(selected),
        selectedSizeBytes: validated.size,
        selectedExt: validated.ext,
      })

      return selected
    } catch (err: unknown) {
      lastProblemWasResolution = false
      const { stderr, stdout, command, exitCode } = getExecaProps(err)
      lastStderr = stderr ?? ""
      lastStdout = stdout ?? ""
      lastCommand = command ?? argv.join(" ")
      lastExitCode = exitCode

      let filesAfterSnapshot: { path: string; size: number; ext: string }[] = []
      try {
        const list = await listFilesRecursive(jobDir)
        filesAfterSnapshot = list.map((p) => {
          try {
            const st = statSync(p)
            return { path: p, size: st.isFile() ? st.size : 0, ext: path.extname(p).toLowerCase() }
          } catch {
            return { path: p, size: 0, ext: path.extname(p).toLowerCase() }
          }
        })
      } catch {
        /* ignore */
      }

      log.error("youtube_dl_attempt_failed", {
        attempt: attemptNum,
        total: ATTEMPTS.length,
        strategy: spec.name,
        jobDir,
        exitCode,
        command: lastCommand,
        stderr: lastStderr,
        stdout: lastStdout,
        filesAfter: filesAfterSnapshot,
        ...serializeErr(err),
      })
    }
  }

  const friendly = lastProblemWasResolution
    ? "Download completed but output file missing: yt-dlp finished but no valid video file could be confirmed. Check server logs or upload the file."
    : classifyYoutubeDlError(lastStderr, lastStdout)
  const devDetail =
    !isProduction && (lastStderr || lastStdout)
      ? `\n\n--- yt-dlp raw (dev) ---\nexit=${lastExitCode ?? "?"}\n${lastCommand}\n\n${lastStderr}\n${lastStdout}`
      : ""

  log.error("youtube_dl_exhausted_retries", {
    userMessage: friendly,
    exitCode: lastExitCode,
    attempts: ATTEMPTS.length,
    lastJobDir: jobDir,
    lastProblemWasResolution,
  })

  throw new Error(friendly + devDetail)
}
