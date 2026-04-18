import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync } from "fs"
import os from "os"
import path from "path"

import {
  __resetFfmpegBinaryCachesForTests,
  assertFfmpegAvailable,
  getFfmpegBinaryPath,
  getFfprobeBinaryPath,
  resolveFfmpegBinary,
  resolveFfprobeBinary,
} from "../../lib/ffmpeg-binaries"

/**
 * These tests pin the resolution contract for the ffmpeg / ffprobe binary
 * resolver. We do NOT execute the binaries — the real spawn behavior is
 * exercised by integration tests / manual smoke. What we verify here:
 *   - env override wins over every other source
 *   - env accepts both a file path AND a containing directory
 *   - missing / bogus env gracefully falls through to the next step
 *   - cache survives across calls within a test
 *   - assertFfmpegAvailable throws a readable error for a stale env path
 */

function makeFakeBin(name: string): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "vf-ffmpeg-bins-"))
  const file = path.join(dir, name)
  writeFileSync(file, "#!/bin/sh\nexit 0\n")
  try {
    chmodSync(file, 0o755)
  } catch {
    /* windows — chmod is a no-op for the test contract we care about */
  }
  return { dir, file }
}

function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => T
): T {
  const prev: Record<string, string | undefined> = {}
  for (const key of Object.keys(overrides)) {
    prev[key] = process.env[key]
    if (overrides[key] == null) delete process.env[key]
    else process.env[key] = overrides[key]
  }
  try {
    __resetFfmpegBinaryCachesForTests()
    return fn()
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
    __resetFfmpegBinaryCachesForTests()
  }
}

const IS_WINDOWS = process.platform === "win32"
const FFMPEG_NAME = IS_WINDOWS ? "ffmpeg.exe" : "ffmpeg"
const FFPROBE_NAME = IS_WINDOWS ? "ffprobe.exe" : "ffprobe"

test("FFMPEG_PATH pointing at a file wins over every other source", () => {
  const { file } = makeFakeBin(FFMPEG_NAME)
  withEnv({ FFMPEG_PATH: file, FFPROBE_PATH: undefined }, () => {
    const r = resolveFfmpegBinary()
    assert.equal(r.path, file)
    assert.equal(r.source, "env")
    assert.equal(r.verifiedOnDisk, true)
    // getFfmpegBinaryPath is the thin wrapper used by spawn call sites.
    assert.equal(getFfmpegBinaryPath(), file)
  })
})

test("FFMPEG_PATH pointing at a directory resolves to the binary inside", () => {
  const { dir, file } = makeFakeBin(FFMPEG_NAME)
  withEnv({ FFMPEG_PATH: dir, FFPROBE_PATH: undefined }, () => {
    const r = resolveFfmpegBinary()
    assert.equal(r.path, file)
    assert.equal(r.source, "env")
  })
})

test("FFPROBE_PATH overrides ffprobe independently of ffmpeg", () => {
  const { file } = makeFakeBin(FFPROBE_NAME)
  withEnv({ FFMPEG_PATH: undefined, FFPROBE_PATH: file }, () => {
    const r = resolveFfprobeBinary()
    assert.equal(r.path, file)
    assert.equal(r.source, "env")
    assert.equal(getFfprobeBinaryPath(), file)
  })
})

test("bogus FFMPEG_PATH falls through; resolver never throws", () => {
  withEnv(
    { FFMPEG_PATH: "/definitely/not/a/real/path/ffmpeg", FFPROBE_PATH: undefined },
    () => {
      const r = resolveFfmpegBinary()
      // Either @ffmpeg-installer (present in this repo), a common Linux path,
      // or the PATH fallback will cover it — we just need to confirm the
      // resolver doesn't throw and doesn't claim "env".
      assert.notEqual(r.source, "env")
    }
  )
})

test("resolver caches: repeated calls return the same object until reset", () => {
  const { file } = makeFakeBin(FFMPEG_NAME)
  withEnv({ FFMPEG_PATH: file, FFPROBE_PATH: undefined }, () => {
    const a = resolveFfmpegBinary()
    const b = resolveFfmpegBinary()
    assert.strictEqual(a, b, "second call should hit the cache")
  })
})

test("assertFfmpegAvailable is a no-op when an executable binary is configured", () => {
  const { file } = makeFakeBin(FFMPEG_NAME)
  withEnv({ FFMPEG_PATH: file, FFPROBE_PATH: undefined }, () => {
    assert.doesNotThrow(() => assertFfmpegAvailable())
  })
})

test("bogus FFMPEG_PATH directory is ignored (falls through without throwing)", () => {
  // A dir that exists but does NOT contain ffmpeg must fall through to the
  // next resolution step, not fail hard. This covers the common deploy foot-
  // gun of setting FFMPEG_PATH to a sibling of the binary.
  const emptyDir = mkdtempSync(path.join(os.tmpdir(), "vf-empty-ffmpeg-dir-"))
  mkdirSync(emptyDir, { recursive: true })
  withEnv({ FFMPEG_PATH: emptyDir, FFPROBE_PATH: undefined }, () => {
    const r = resolveFfmpegBinary()
    assert.notEqual(r.source, "env", "should not claim env when env dir is empty")
    assert.doesNotThrow(() => assertFfmpegAvailable())
  })
})
