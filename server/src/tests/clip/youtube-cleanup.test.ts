import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "fs"
import os from "os"
import path from "path"

import { cleanupYoutubeDownload } from "../../utils/youtube.downloader"

/**
 * `cleanupYoutubeDownload` is safety-critical: it rm -rf's a directory. The
 * only property we really care about is that it NEVER deletes anything outside
 * the `<cwd>/tmp/yt_job_*` shape the downloader itself creates. These tests
 * pin that contract.
 */

function makeTmpCwd(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "viralforge-clip-cleanup-"))
  mkdirSync(path.join(root, "tmp"), { recursive: true })
  return root
}

function withCwd<T>(dir: string, fn: () => T): T {
  const prev = process.cwd()
  try {
    process.chdir(dir)
    return fn()
  } finally {
    process.chdir(prev)
  }
}

test("cleanupYoutubeDownload removes the enclosing yt_job_* dir under tmp/", async () => {
  const fakeCwd = makeTmpCwd()
  await withCwd(fakeCwd, async () => {
    const jobDir = path.join(fakeCwd, "tmp", "yt_job_abc123")
    mkdirSync(jobDir, { recursive: true })
    const videoPath = path.join(jobDir, "video.mp4")
    writeFileSync(videoPath, "mp4 bytes")
    writeFileSync(path.join(jobDir, "video.part"), "partial")
    writeFileSync(path.join(jobDir, "thumbnail.jpg"), "thumb")

    await cleanupYoutubeDownload(videoPath)

    assert.equal(existsSync(jobDir), false, "job dir should be removed")
    assert.equal(existsSync(videoPath), false, "video should be removed")
  })
})

test("cleanupYoutubeDownload ignores paths outside <cwd>/tmp/", async () => {
  const fakeCwd = makeTmpCwd()
  await withCwd(fakeCwd, async () => {
    // A look-alike dir OUTSIDE the tmp root. cleanupYoutubeDownload must refuse.
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), "outside-"))
    const lookalike = path.join(outsideRoot, "yt_job_evil")
    mkdirSync(lookalike, { recursive: true })
    const hostagePath = path.join(lookalike, "important.txt")
    writeFileSync(hostagePath, "do not delete")

    await cleanupYoutubeDownload(path.join(lookalike, "video.mp4"))

    assert.equal(existsSync(hostagePath), true, "hostage file must survive")
    assert.equal(existsSync(lookalike), true, "outside dir must survive")
  })
})

test("cleanupYoutubeDownload ignores dirs under tmp/ without the yt_job_ prefix", async () => {
  const fakeCwd = makeTmpCwd()
  await withCwd(fakeCwd, async () => {
    // clip.controller.ts places uploaded sources under tmp/clip-jobs-sources/.
    // The cleanup helper must refuse to touch this dir even though its path
    // lives under tmp/, because deleting it would wipe sources from OTHER jobs.
    const uploadDir = path.join(fakeCwd, "tmp", "clip-jobs-sources")
    mkdirSync(uploadDir, { recursive: true })
    const otherJobUpload = path.join(uploadDir, "some-other-job.mp4")
    writeFileSync(otherJobUpload, "other job source")
    const thisJobUpload = path.join(uploadDir, "this-job.mp4")
    writeFileSync(thisJobUpload, "this job source")

    await cleanupYoutubeDownload(thisJobUpload)

    assert.equal(existsSync(otherJobUpload), true, "other job's upload must survive")
    assert.equal(existsSync(thisJobUpload), true, "this job's upload must survive")
    assert.equal(existsSync(uploadDir), true, "shared uploads dir must survive")
  })
})

test("cleanupYoutubeDownload is a safe no-op for empty / already-gone paths", async () => {
  await cleanupYoutubeDownload("")
  await cleanupYoutubeDownload("/does/not/exist/yt_job_x/video.mp4")
  // No assertions needed — a throw here would fail the test.
})
