import { existsSync, statSync } from "fs"
import path from "path"
import fluentFfmpeg from "fluent-ffmpeg"
import { log } from "./logger"

/**
 * Shared, cached resolution of ffmpeg / ffprobe binary paths for the whole
 * server. Replaces ad-hoc `spawn("ffmpeg", …)` usage that silently relies on
 * PATH and fails cryptically on hosts where PATH does not include ffmpeg.
 *
 * Resolution order (first hit wins):
 *   1. Explicit env (`FFMPEG_PATH` / `FFPROBE_PATH`). Accepts either the
 *      binary path itself OR the containing directory.
 *   2. The bundled `@ffmpeg-installer/ffmpeg` npm package (ffmpeg only —
 *      the package does not ship ffprobe).
 *   3. Well-known absolute paths: `/usr/bin`, `/usr/local/bin`,
 *      `/opt/homebrew/bin`.
 *   4. Bare name fallback (`ffmpeg` / `ffprobe`) — caller relies on PATH.
 *
 * The module intentionally avoids executing the binary to probe it; resolution
 * is pure filesystem + env. Callers that need a hard guarantee should use
 * `assertFfmpegAvailable()` at a job entry point to surface a clean error.
 */

type BinarySource =
  | "env"
  | "ffmpeg-installer"
  | "common-path"
  | "path-fallback"

export type ResolvedBinary = {
  /** Path that should be passed to spawn / fluent-ffmpeg. */
  path: string
  source: BinarySource
  /**
   * True when `path` was verified as an existing regular file during
   * resolution. `path-fallback` sources are false since we only trust PATH.
   */
  verifiedOnDisk: boolean
}

const IS_WINDOWS = process.platform === "win32"
const FFMPEG_FILENAME = IS_WINDOWS ? "ffmpeg.exe" : "ffmpeg"
const FFPROBE_FILENAME = IS_WINDOWS ? "ffprobe.exe" : "ffprobe"

const COMMON_UNIX_DIRS = ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"]

function isExecutableFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile()
  } catch {
    return false
  }
}

function resolveFromEnv(
  envValue: string | undefined,
  filename: string
): string | null {
  if (!envValue) return null
  const cleaned = envValue.trim().replace(/^["']|["']$/g, "")
  if (!cleaned) return null
  let resolved: string
  try {
    resolved = path.resolve(cleaned)
  } catch {
    return null
  }
  try {
    const st = statSync(resolved)
    if (st.isFile()) return resolved
    if (st.isDirectory()) {
      const inside = path.join(resolved, filename)
      if (isExecutableFile(inside)) return inside
    }
  } catch {
    return null
  }
  return null
}

function resolveFromCommonPaths(filename: string): string | null {
  for (const dir of COMMON_UNIX_DIRS) {
    const candidate = path.join(dir, filename)
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

function tryLoadFfmpegInstaller(): string | null {
  try {
    // Optional require: `@ffmpeg-installer/ffmpeg` has no TypeScript types
    // and may be absent in minimal deploys. Treat any failure as "not
    // available" and fall through to the next resolution step.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const installer = require("@ffmpeg-installer/ffmpeg") as {
      path?: unknown
    }
    const candidate = typeof installer?.path === "string" ? installer.path : null
    if (candidate && isExecutableFile(candidate)) return candidate
    return null
  } catch {
    return null
  }
}

let ffmpegCache: ResolvedBinary | null = null
let ffprobeCache: ResolvedBinary | null = null

export function resolveFfmpegBinary(): ResolvedBinary {
  if (ffmpegCache) return ffmpegCache

  const envPath = resolveFromEnv(process.env.FFMPEG_PATH, FFMPEG_FILENAME)
  if (envPath) {
    return (ffmpegCache = { path: envPath, source: "env", verifiedOnDisk: true })
  }

  const installerPath = tryLoadFfmpegInstaller()
  if (installerPath) {
    return (ffmpegCache = {
      path: installerPath,
      source: "ffmpeg-installer",
      verifiedOnDisk: true,
    })
  }

  const common = resolveFromCommonPaths(FFMPEG_FILENAME)
  if (common) {
    return (ffmpegCache = {
      path: common,
      source: "common-path",
      verifiedOnDisk: true,
    })
  }

  return (ffmpegCache = {
    path: FFMPEG_FILENAME,
    source: "path-fallback",
    verifiedOnDisk: false,
  })
}

export function resolveFfprobeBinary(): ResolvedBinary {
  if (ffprobeCache) return ffprobeCache

  const envPath = resolveFromEnv(process.env.FFPROBE_PATH, FFPROBE_FILENAME)
  if (envPath) {
    return (ffprobeCache = {
      path: envPath,
      source: "env",
      verifiedOnDisk: true,
    })
  }

  // If ffmpeg was resolved to a real dir (env or common path), ffprobe almost
  // certainly lives next to it. This saves distros where `/usr/bin/ffmpeg`
  // and `/usr/bin/ffprobe` are installed together by the system package.
  const ffmpeg = resolveFfmpegBinary()
  if (
    (ffmpeg.source === "env" || ffmpeg.source === "common-path") &&
    ffmpeg.verifiedOnDisk
  ) {
    const sibling = path.join(path.dirname(ffmpeg.path), FFPROBE_FILENAME)
    if (isExecutableFile(sibling)) {
      return (ffprobeCache = {
        path: sibling,
        source: ffmpeg.source,
        verifiedOnDisk: true,
      })
    }
  }

  const common = resolveFromCommonPaths(FFPROBE_FILENAME)
  if (common) {
    return (ffprobeCache = {
      path: common,
      source: "common-path",
      verifiedOnDisk: true,
    })
  }

  return (ffprobeCache = {
    path: FFPROBE_FILENAME,
    source: "path-fallback",
    verifiedOnDisk: false,
  })
}

/** Convenience: just the ffmpeg path, for `spawn(...)` call sites. */
export function getFfmpegBinaryPath(): string {
  return resolveFfmpegBinary().path
}

/** Convenience: just the ffprobe path, for `spawn(...)` call sites. */
export function getFfprobeBinaryPath(): string {
  return resolveFfprobeBinary().path
}

/**
 * Wire the resolved binaries into `fluent-ffmpeg` so every `import ffmpeg
 * from "fluent-ffmpeg"` call site across the server uses the same binary as
 * the `spawn(...)`-based sites. Call once at startup (after env load). Safe
 * to call multiple times.
 */
export function configureFluentFfmpeg(): void {
  const ffmpeg = resolveFfmpegBinary()
  const ffprobe = resolveFfprobeBinary()

  // `setFfmpegPath` / `setFfprobePath` accept absolute paths AND bare names
  // (relying on PATH). Passing the bare name in the fallback case keeps the
  // prior "PATH lookup" behavior instead of failing outright.
  fluentFfmpeg.setFfmpegPath(ffmpeg.path)
  fluentFfmpeg.setFfprobePath(ffprobe.path)

  log.info("ffmpeg_binaries_configured", {
    ffmpegPath: ffmpeg.path,
    ffmpegSource: ffmpeg.source,
    ffprobePath: ffprobe.path,
    ffprobeSource: ffprobe.source,
  })

  if (ffmpeg.source === "path-fallback") {
    log.warn("ffmpeg_binary_path_fallback", {
      message:
        "ffmpeg not found via FFMPEG_PATH, @ffmpeg-installer, or common install dirs — relying on PATH. Set FFMPEG_PATH or install ffmpeg in the container.",
    })
  }
  if (ffprobe.source === "path-fallback") {
    log.warn("ffprobe_binary_path_fallback", {
      message:
        "ffprobe not found via FFPROBE_PATH or common install dirs — relying on PATH. Set FFPROBE_PATH or install ffmpeg (which ships ffprobe) in the container.",
    })
  }
}

/**
 * Throw a clean, operator-actionable error if ffmpeg cannot be resolved to an
 * on-disk file. Use at job-entry points (e.g. clip pipeline start) so users
 * see a real message instead of a cryptic ENOENT from spawn().
 *
 * Does NOT execute the binary; a `path-fallback` source returns silently
 * because we cannot cheaply validate PATH availability.
 */
export function assertFfmpegAvailable(): void {
  const ffmpeg = resolveFfmpegBinary()
  if (ffmpeg.source === "path-fallback") return
  if (!ffmpeg.verifiedOnDisk || !isExecutableFile(ffmpeg.path)) {
    throw new Error(
      `ffmpeg binary was resolved to "${ffmpeg.path}" (source: ${ffmpeg.source}) but that path does not exist. ` +
        `Install ffmpeg (apt install ffmpeg, brew install ffmpeg) or set FFMPEG_PATH.`
    )
  }
}

/** Test-only: reset caches between tests. Not for production use. */
export function __resetFfmpegBinaryCachesForTests(): void {
  ffmpegCache = null
  ffprobeCache = null
}
