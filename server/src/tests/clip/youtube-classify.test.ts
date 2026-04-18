/**
 * Narrow unit tests for `classifyYoutubeDlError`.
 *
 * Regression context (see `server/src/utils/youtube.downloader.ts`):
 * an earlier classifier regex matched on `formats may be missing`,
 * bare `javascript runtime`, and `\bejs\b`. Those phrases appear as
 * ADVISORY warnings in yt-dlp stderr on essentially every YouTube run
 * (signature / nsig extraction degradation). Any failed job whose last
 * attempt included those warnings got classified as
 * `MSG_YT_JS_RUNTIME_USER`, which the frontend promotes to the hardest
 * "YouTube playback limit" blocker UI — preventing retries for cases that
 * were actually bot checks, transient 403s, merge errors, etc.
 *
 * These tests pin the narrower classifier so that:
 *   - true JS-runtime-missing messages still classify as JS runtime
 *   - advisory "formats may be missing" / bare "javascript runtime"
 *     warnings do NOT classify as JS runtime (and therefore do NOT
 *     render the playback-limit blocker UI downstream)
 *   - bot / cookies / geo / age / unavailable / merge branches still win
 */

import { strict as assert } from "node:assert"
import { test } from "node:test"

import {
  MSG_YT_BLOCKED_SERVER_SIDE,
  MSG_YT_COOKIES_INVALID_OR_EXPIRED,
  MSG_YT_COOKIES_REQUIRED_NOT_CONFIGURED,
  MSG_YT_GENERIC_FAILURE,
  MSG_YT_JS_RUNTIME_USER,
  classifyYoutubeDlError,
  type YoutubeDlClassifyCtx,
} from "../../utils/youtube.downloader"

const CTX_NO_COOKIES: YoutubeDlClassifyCtx = {
  cookiesPassedToYtDlp: false,
  cookiesEnvSet: false,
}

const CTX_COOKIES_PASSED: YoutubeDlClassifyCtx = {
  cookiesPassedToYtDlp: true,
  cookiesEnvSet: true,
}

test("true JS-runtime-missing error still classifies as JS runtime", () => {
  const stderr =
    "ERROR: [youtube] dQw4w9WgXcQ: Requires a JavaScript runtime but none of the configured runtimes could be started"
  assert.equal(
    classifyYoutubeDlError(stderr, "", CTX_NO_COOKIES),
    MSG_YT_JS_RUNTIME_USER
  )
})

test("explicit 'No supported JavaScript runtime available' classifies as JS runtime", () => {
  const stderr =
    "ERROR: No supported JavaScript runtime available. Install Deno or Node.js and retry."
  assert.equal(
    classifyYoutubeDlError(stderr, "", CTX_NO_COOKIES),
    MSG_YT_JS_RUNTIME_USER
  )
})

test("advisory 'formats may be missing' warning does NOT classify as JS runtime", () => {
  // This is the critical regression case. yt-dlp prints this on most modern
  // YouTube runs even when a JS runtime is configured and the download would
  // otherwise succeed on a different attempt. If the final attempt then fails
  // for an unrelated reason (and no specific branch matches), we must fall
  // through to the generic failure message — NOT the JS runtime blocker UI.
  const stderr = [
    "WARNING: [youtube] dQw4w9WgXcQ: Signature extraction failed: Some formats may be missing",
    "WARNING: [youtube] dQw4w9WgXcQ: nsig extraction failed: Some formats may be missing",
    "ERROR: [youtube] dQw4w9WgXcQ: Unable to extract video data",
  ].join("\n")

  const result = classifyYoutubeDlError(stderr, "", CTX_NO_COOKIES)
  assert.notEqual(result, MSG_YT_JS_RUNTIME_USER)
})

test("bare 'javascript runtime' advisory mention does NOT classify as JS runtime", () => {
  // yt-dlp sometimes suggests installing a JS runtime as a hint even when one
  // is already configured. The hint alone must not hijack the classifier.
  const stderr = [
    "WARNING: [youtube] dQw4w9WgXcQ: try running yt-dlp with a javascript runtime installed",
    "ERROR: HTTP Error 403: Forbidden",
  ].join("\n")

  const result = classifyYoutubeDlError(stderr, "", CTX_NO_COOKIES)
  assert.notEqual(result, MSG_YT_JS_RUNTIME_USER)
})

test("bare '\\bejs\\b' advisory does NOT classify as JS runtime", () => {
  const stderr = [
    "WARNING: [youtube] dQw4w9WgXcQ: EJS player signature cache miss, falling back",
    "ERROR: HTTP Error 429: Too Many Requests",
  ].join("\n")

  const result = classifyYoutubeDlError(stderr, "", CTX_NO_COOKIES)
  assert.notEqual(result, MSG_YT_JS_RUNTIME_USER)
})

test("bot check with 'formats may be missing' advisory still classifies as blocked, not JS runtime", () => {
  const stderr = [
    "WARNING: [youtube] dQw4w9WgXcQ: Signature extraction failed: Some formats may be missing",
    "ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you're not a bot",
  ].join("\n")

  assert.equal(
    classifyYoutubeDlError(stderr, "", CTX_NO_COOKIES),
    MSG_YT_BLOCKED_SERVER_SIDE
  )
})

test("bare 'use --cookies' remediation hint WITHOUT a specific auth-gate signal does NOT promote to session-required", () => {
  // Regression case for the production "YOUTUBE SERVER SESSION" false
  // blocker. Modern yt-dlp prints this exact hint as part of *every*
  // bot-check error and in several generic "extraction failed" paths. It is
  // NOT a definitive statement that the video requires a signed-in session.
  // Treat it as a generic failure (soft retry UI in the client), not the
  // hard session-required blocker.
  const stderr =
    "ERROR: [youtube] dQw4w9WgXcQ: Unable to extract video data. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies."
  assert.equal(
    classifyYoutubeDlError(stderr, "", CTX_NO_COOKIES),
    MSG_YT_GENERIC_FAILURE
  )
})

test("bot check + 'use --cookies' remediation hint classifies as blocked, NOT as session-required", () => {
  // Production regression: stderr combines the bot-check headline and
  // yt-dlp's remediation hint. The previous classifier checked the cookies
  // hint first and returned MSG_YT_COOKIES_REQUIRED_NOT_CONFIGURED, which
  // the frontend maps to the "YouTube server session" blocker. The correct
  // answer is MSG_YT_BLOCKED_SERVER_SIDE — retry-friendly, with an optional
  // cookies hint, not a hard auth-gate.
  const stderr = [
    "ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.",
    "    See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies.",
  ].join("\n")
  assert.equal(
    classifyYoutubeDlError(stderr, "", CTX_NO_COOKIES),
    MSG_YT_BLOCKED_SERVER_SIDE
  )
})

test("members-only video still classifies as session-required (true auth gate)", () => {
  const stderr =
    "ERROR: [youtube] dQw4w9WgXcQ: This video is only available to members of this channel. Use --cookies to authenticate."
  assert.equal(
    classifyYoutubeDlError(stderr, "", CTX_NO_COOKIES),
    MSG_YT_COOKIES_REQUIRED_NOT_CONFIGURED
  )
})

test("explicit 'cookies required' still classifies as session-required", () => {
  const stderr = "ERROR: [youtube] dQw4w9WgXcQ: Cookies are required to view this content."
  assert.equal(
    classifyYoutubeDlError(stderr, "", CTX_NO_COOKIES),
    MSG_YT_COOKIES_REQUIRED_NOT_CONFIGURED
  )
})

test("broken cookies file with cookies passed classifies as cookies-invalid", () => {
  const stderr =
    "ERROR: Unable to parse cookie file: not in netscape format or corrupted cookie"
  assert.equal(
    classifyYoutubeDlError(stderr, "", CTX_COOKIES_PASSED),
    MSG_YT_COOKIES_INVALID_OR_EXPIRED
  )
})

test("private video wins over advisory 'formats may be missing' noise", () => {
  const stderr = [
    "WARNING: [youtube] xyz: Some formats may be missing",
    "ERROR: [youtube] xyz: Private video. Sign in if you've been granted access to this video",
  ].join("\n")

  assert.match(
    classifyYoutubeDlError(stderr, "", CTX_NO_COOKIES),
    /^Private video:/
  )
})

test("age-restricted wins over advisory 'formats may be missing' noise", () => {
  const stderr = [
    "WARNING: [youtube] xyz: Some formats may be missing",
    "ERROR: [youtube] xyz: Sign in to confirm your age",
  ].join("\n")

  assert.match(
    classifyYoutubeDlError(stderr, "", CTX_NO_COOKIES),
    /^Age restricted:/
  )
})

test("region block wins over advisory 'formats may be missing' noise", () => {
  const stderr = [
    "WARNING: [youtube] xyz: Some formats may be missing",
    "ERROR: [youtube] xyz: This video is not available in your country",
  ].join("\n")

  assert.match(
    classifyYoutubeDlError(stderr, "", CTX_NO_COOKIES),
    /^Region blocked:/
  )
})

test("HTTP 403 with only advisory noise falls through to generic retry-friendly message", () => {
  // Frontend maps this generic string to CLIP_UI_YOUTUBE_BLOCKED (soft banner
  // with a Retry button + cookies hint) — NOT the hard "YouTube playback
  // limit" blocker.
  const stderr = [
    "WARNING: [youtube] dQw4w9WgXcQ: Signature extraction failed: Some formats may be missing",
    "ERROR: [youtube] dQw4w9WgXcQ: HTTP Error 403: Forbidden",
  ].join("\n")

  assert.equal(
    classifyYoutubeDlError(stderr, "", CTX_NO_COOKIES),
    MSG_YT_GENERIC_FAILURE
  )
})
