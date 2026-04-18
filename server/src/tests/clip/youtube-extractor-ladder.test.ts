/**
 * Narrow unit tests for the YouTube ingest ladder's per-attempt extractor
 * args resolution and the shape of the ladder itself.
 *
 * Production regression context (see `server/src/utils/youtube.downloader.ts`):
 * every attempt previously passed `youtube:player_client=web`, so when
 * YouTube bot-challenged the `web` client from datacenter IPs (Railway /
 * AWS / GCP / Azure), all 5 attempts hit the same gate and failed. This
 * pushed virtually every public unauthenticated link into the
 * "YouTube server session" blocker UI. Varying `player_client` across the
 * ladder (`tv`, `mweb`, `default`, `web`, combined) reclaims most of those
 * as successful downloads with no cookies required.
 *
 * These tests pin:
 *   - per-attempt default extractor args use the spec's playerClient
 *   - YT_DLP_EXTRACTOR_ARGS operator override wins (full replacement)
 *   - YT_DLP_EXTRACTOR_ARGS=off/none/0 disables extractor args entirely
 *   - the ladder uses multiple distinct client configurations
 *   - the first step prefers a low-nsig / progressive format + tv client
 */

import { strict as assert } from "node:assert"
import { test, beforeEach, afterEach } from "node:test"

import {
  ATTEMPTS,
  buildFlags,
  resolveExtractorArgsForAttempt,
  type AttemptSpec,
} from "../../utils/youtube.downloader"

const OUTPUT_TMPL = "/tmp/yt_job_test/video.%(ext)s"

const BASE_SPEC: AttemptSpec = {
  name: "test",
  format: "best",
  mergeMp4: false,
  forceIpv4: false,
  playerClient: "tv",
}

let prevExtractorArgs: string | undefined

beforeEach(() => {
  prevExtractorArgs = process.env.YT_DLP_EXTRACTOR_ARGS
  delete process.env.YT_DLP_EXTRACTOR_ARGS
})

afterEach(() => {
  if (prevExtractorArgs === undefined) {
    delete process.env.YT_DLP_EXTRACTOR_ARGS
  } else {
    process.env.YT_DLP_EXTRACTOR_ARGS = prevExtractorArgs
  }
})

test("default extractor args use the per-attempt playerClient", () => {
  assert.equal(
    resolveExtractorArgsForAttempt({ ...BASE_SPEC, playerClient: "tv" }),
    "youtube:player_client=tv"
  )
  assert.equal(
    resolveExtractorArgsForAttempt({ ...BASE_SPEC, playerClient: "mweb" }),
    "youtube:player_client=mweb"
  )
  assert.equal(
    resolveExtractorArgsForAttempt({ ...BASE_SPEC, playerClient: "web,tv,mweb" }),
    "youtube:player_client=web,tv,mweb"
  )
})

test("YT_DLP_EXTRACTOR_ARGS override replaces the per-attempt default wholesale", () => {
  process.env.YT_DLP_EXTRACTOR_ARGS = "youtube:player_client=web;player_skip=webpage"
  assert.equal(
    resolveExtractorArgsForAttempt({ ...BASE_SPEC, playerClient: "tv" }),
    "youtube:player_client=web;player_skip=webpage"
  )
})

test("YT_DLP_EXTRACTOR_ARGS=off disables extractor args entirely", () => {
  for (const val of ["off", "none", "0"]) {
    process.env.YT_DLP_EXTRACTOR_ARGS = val
    assert.equal(
      resolveExtractorArgsForAttempt({ ...BASE_SPEC, playerClient: "tv" }),
      undefined,
      `expected extractor args disabled for YT_DLP_EXTRACTOR_ARGS=${val}`
    )
  }
})

test("buildFlags wires the resolved extractor args into the yt-dlp flag set", () => {
  const flags = buildFlags(OUTPUT_TMPL, { ...BASE_SPEC, playerClient: "mweb" }, undefined, undefined)
  assert.equal(flags.extractorArgs, "youtube:player_client=mweb")
  assert.equal(flags.format, "best")
  assert.equal(flags.output, OUTPUT_TMPL)
})

test("buildFlags omits extractorArgs when the operator disables them", () => {
  process.env.YT_DLP_EXTRACTOR_ARGS = "off"
  const flags = buildFlags(OUTPUT_TMPL, { ...BASE_SPEC, playerClient: "tv" }, undefined, undefined)
  assert.equal(flags.extractorArgs, undefined)
})

test("buildFlags only passes cookies when a path is provided", () => {
  const withCookies = buildFlags(OUTPUT_TMPL, BASE_SPEC, undefined, "/run/secrets/yt-cookies.txt")
  assert.equal(withCookies.cookies, "/run/secrets/yt-cookies.txt")
  const withoutCookies = buildFlags(OUTPUT_TMPL, BASE_SPEC, undefined, undefined)
  assert.equal(withoutCookies.cookies, undefined)
})

test("ATTEMPTS ladder uses multiple distinct player clients", () => {
  const clients = new Set(ATTEMPTS.map((a) => a.playerClient))
  assert.ok(
    clients.size >= 3,
    `ladder must vary playerClient across attempts (got: ${[...clients].join(", ")})`
  )
})

test("ATTEMPTS ladder starts with non-web clients (tv or mweb) for datacenter-IP success", () => {
  // The first two attempts should prefer clients YouTube rarely bot-challenges
  // from cloud providers. If someone reorders the ladder to put `web` first
  // again we regress to the previous production behavior.
  const firstTwo = ATTEMPTS.slice(0, 2).map((a) => a.playerClient)
  for (const client of firstTwo) {
    assert.ok(
      client === "tv" || client === "mweb",
      `expected first two attempts to use tv/mweb, got: ${firstTwo.join(", ")}`
    )
  }
})

test("ATTEMPTS ladder first step avoids mandatory DASH merge (no nsig unless necessary)", () => {
  // Progressive mp4 preference keeps the first attempt simple: no separate
  // video+audio DASH streams, no mandatory nsig extraction, fastest success
  // path when YouTube is cooperative.
  const first = ATTEMPTS[0]
  assert.equal(first.mergeMp4, false, "first ladder step must not require an mp4 merge")
  assert.ok(
    /best\[ext=mp4\]|best$|best\[/.test(first.format),
    `first ladder step format should prefer progressive best, got: ${first.format}`
  )
})
