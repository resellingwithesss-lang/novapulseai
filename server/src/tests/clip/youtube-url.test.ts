import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "fs"
import path from "path"

import {
  YOUTUBE_HOSTS,
  YOUTUBE_URL_MAX_LENGTH,
  isAllowedYoutubeUrl,
  validateYoutubeUrl,
  youtubeUrlRejectionMessage,
} from "../../lib/youtube-url"
import type {
  YoutubeUrlRejectReason,
  YoutubeUrlValidation,
} from "../../lib/youtube-url"

type YoutubeUrlFailure = Extract<YoutubeUrlValidation, { ok: false }>

const ACCEPTED: ReadonlyArray<{ input: string; host: string }> = [
  { input: "https://www.youtube.com/watch?v=abc", host: "www.youtube.com" },
  { input: "https://youtube.com/watch?v=abc", host: "youtube.com" },
  { input: "https://youtu.be/abc", host: "youtu.be" },
  { input: "https://youtu.be/abc?si=xyz", host: "youtu.be" },
  { input: "https://m.youtube.com/watch?v=abc", host: "m.youtube.com" },
  { input: "https://m.youtube.com/shorts/abc", host: "m.youtube.com" },
  { input: "https://music.youtube.com/watch?v=abc", host: "music.youtube.com" },
  {
    input: "https://www.youtube-nocookie.com/embed/abc",
    host: "www.youtube-nocookie.com",
  },
  { input: "https://youtube.com/shorts/abc", host: "youtube.com" },
  { input: "youtube.com/watch?v=abc", host: "youtube.com" },
  { input: "https://www.YouTube.com/watch?v=abc", host: "www.youtube.com" },
  { input: "http://www.youtube.com/watch?v=abc", host: "www.youtube.com" },
  { input: "  https://m.youtube.com/watch?v=abc  ", host: "m.youtube.com" },
]

const REJECTED: ReadonlyArray<{
  input: unknown
  reason: YoutubeUrlRejectReason
}> = [
  { input: "", reason: "empty" },
  { input: "   ", reason: "empty" },
  { input: null, reason: "empty" },
  { input: undefined, reason: "empty" },
  { input: 42, reason: "empty" },
  { input: "x".repeat(YOUTUBE_URL_MAX_LENGTH + 1), reason: "too_long" },
  { input: "javascript:alert(1)", reason: "bad_scheme" },
  { input: "ftp://youtube.com/", reason: "bad_scheme" },
  { input: "data:text/html,<script>", reason: "bad_scheme" },
  { input: "https://evil.com/watch?v=abc", reason: "host_not_allowed" },
  {
    input: "https://www.youtube.com.evil.com/watch?v=abc",
    reason: "host_not_allowed",
  },
  { input: "https://", reason: "parse_failed" },
  { input: "not a url with spaces", reason: "parse_failed" },
]

test("validateYoutubeUrl accepts canonical YouTube URLs and returns a normalized absolute URL", () => {
  for (const { input, host } of ACCEPTED) {
    const result = validateYoutubeUrl(input)
    assert.equal(result.ok, true, `expected accepted: ${JSON.stringify(input)}`)
    if (!result.ok) continue
    const success = result as Extract<YoutubeUrlValidation, { ok: true }>
    assert.match(success.url, /^https?:\/\//i, `normalized URL missing scheme: ${success.url}`)
    const parsedHost = new URL(success.url).hostname.toLowerCase()
    assert.equal(parsedHost, host, `unexpected normalized host for ${JSON.stringify(input)}`)
  }
})

test("validateYoutubeUrl rejects non-YouTube / unsafe URLs with specific reasons", () => {
  for (const { input, reason } of REJECTED) {
    const result = validateYoutubeUrl(input)
    assert.equal(result.ok, false, `expected rejected: ${JSON.stringify(input)}`)
    if (result.ok) continue
    const failure = result as YoutubeUrlFailure
    assert.equal(
      failure.reason,
      reason,
      `wrong rejection reason for ${JSON.stringify(input)}: ${failure.reason}`
    )
    const message = youtubeUrlRejectionMessage(failure)
    assert.ok(message.length > 0, "rejection message must be non-empty")
  }
})

test("isAllowedYoutubeUrl is a thin boolean wrapper over validateYoutubeUrl", () => {
  assert.equal(isAllowedYoutubeUrl("https://m.youtube.com/watch?v=abc"), true)
  assert.equal(isAllowedYoutubeUrl("https://evil.com/"), false)
  assert.equal(isAllowedYoutubeUrl(undefined), false)
})

test("client clipper page uses the exact same YouTube host allowlist as the server", () => {
  const clientFile = path.resolve(
    __dirname,
    "../../../../client/src/app/dashboard/tools/clipper/page.tsx"
  )
  const src = readFileSync(clientFile, "utf8")
  const match = src.match(/YOUTUBE_HOSTS\s*=\s*new Set\(\[([\s\S]+?)\]\)/)
  assert.ok(
    match,
    "could not locate YOUTUBE_HOSTS literal in client clipper page — if you moved it, update this test"
  )
  const clientHosts = match[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter((s) => s.length > 0)
  assert.deepEqual(
    new Set(clientHosts),
    new Set(YOUTUBE_HOSTS),
    "client YOUTUBE_HOSTS drifted from server/src/lib/youtube-url.ts — update one of them"
  )
})
