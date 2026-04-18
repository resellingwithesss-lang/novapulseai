# YouTube ingest for Clipper (operators)

Clipper can download **public** YouTube watch URLs on the server using **yt-dlp**. YouTube frequently challenges **datacenter IPs** (including Railway) with bot checks, sign-in walls, or limited formats. The strongest practical mitigation is a **Netscape-format cookies file** exported from a **normal logged-in browser session**, mounted into the API container and referenced by the operator environment variable **`YT_DLP_COOKIES`** (absolute path to the file).

This document is **operator-only**. End users should use **direct upload** when links fail.

## What the server checks

On API startup, logs include `youtube_ingest_startup` and a cookies summary (`youtube_ingest_startup_cookies_ok` | `youtube_ingest_startup_cookies_missing` | `youtube_ingest_startup_cookies_invalid`).

Admins can call **`GET /api/admin/youtube-ingest-health`** (authenticated admin) for a JSON snapshot: yt-dlp binary resolution, ffmpeg presence, JS runtime paths existence, cookies **status** (not file contents).

## Railway: steps to enable cookies

1. **Export cookies** from a browser where YouTube plays the target content without extra challenges (home IP often better than VPN).
   - Use an extension or tool that exports **Netscape / cookies.txt** format (same format yt-dlp expects for `--cookies`).
   - Ensure the export includes **youtube.com** / **.youtube.com** session cookies.

2. **Add the file to the deployment**
   - Preferred: attach a **Railway volume** (or equivalent persistent disk) mounted at a fixed path (e.g. `/data/secrets/youtube_cookies.txt`).
   - Alternative: bake **not** recommended (cookies expire; rebuild churn). Prefer volume + periodic refresh.

3. **Set environment on the API service**

   - **`YT_DLP_COOKIES`**: absolute path inside the container to the cookies file, e.g. `/data/secrets/youtube_cookies.txt`.
   - No `#` prefix on the path; avoid quotes unless your platform requires them.

4. **Redeploy** so the process reads the new env and file.

5. **Verify**
   - Check logs for `youtube_ingest_startup_cookies_ok`.
   - Or `GET /api/admin/youtube-ingest-health` and confirm `cookies.willPassToYtDlp: true`.

## Other env vars (reference)

| Variable | Purpose |
|----------|---------|
| **`YT_DLP_PATH`** | Optional absolute path to `yt-dlp` binary if not on default PATH. |
| **`FFMPEG_PATH`** | Optional path to `ffmpeg` binary or directory containing it (for merges). |
| **`YT_DLP_JS_RUNTIMES`** | Comma list like `deno:/usr/local/bin/deno,node:/usr/local/bin/node` for yt-dlp EJS / player extraction. |
| **`YT_DLP_EXTRACTOR_ARGS`** | Override YouTube extractor args; set to `off` / `none` / `0` to disable the default web client hint. |

## Honest limitations

- **Cookies are not a guarantee**: they authenticate *a* session; YouTube may still throttle or block some titles from cloud IPs.
- **Cookies expire**: refresh the export when failures return with “invalid / expired cookies” style errors (server classifies these for operators).
- **Private, age-gated, or region-locked** content may still fail even with cookies; **upload the file** for those cases.
