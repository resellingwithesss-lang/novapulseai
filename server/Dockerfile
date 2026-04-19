# syntax=docker/dockerfile:1
# Production API image: Express + Prisma + ffmpeg + Chromium (Puppeteer) + yt-dlp.
#
# Build (context must be this directory):
#   cd server && docker build -t novapulseai-api .
#
# From monorepo root:
#   docker build -f server/Dockerfile -t novapulseai-api ./server
#
# yt-dlp: we install the official release binary (not Debian's package, which lags
# YouTube changes). npm's yt-dlp-exec postinstall targets an asset that isn't the
# Linux glibc standalone binary — skip it and use /usr/local/bin/yt-dlp at runtime
# (see YOUTUBE_DL_SKIP_DOWNLOAD).

# =========================================================================
# BUILD STAGE — tsc + prisma generate + prune. No Chromium / ffmpeg needed.
# =========================================================================
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Build-only native deps:
# - python3 + python-is-python3: yt-dlp-exec's preinstall calls
#   `bin-version-check-cli python ...` and requires `python` on PATH.
# - make + g++: node-gyp fallback when sharp / native prebuilds are missing.
# - ca-certificates: HTTPS trust for npm registry + Prisma engine downloads.
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  python3 \
  python-is-python3 \
  make \
  g++ \
  && rm -rf /var/lib/apt/lists/*

# Stop Puppeteer and yt-dlp-exec from pulling their own binaries during
# `npm ci`. Runtime versions are installed in the runner stage.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV YOUTUBE_DL_SKIP_DOWNLOAD=true

COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci

COPY . ./
RUN npx prisma generate && npm run build && npm prune --omit=dev

# =========================================================================
# RUNNER STAGE — runtime only. Chromium, ffmpeg, yt-dlp, Deno.
# =========================================================================
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ARG TARGETARCH=amd64

# --- Runtime system packages (single layer, single apt-get) ---
# ffmpeg         : clip + ads pipelines (and ffprobe ships with it)
# chromium       : Puppeteer (ads capture + analyzer); used via
#                  PUPPETEER_EXECUTABLE_PATH below
# ca-certificates: HTTPS trust store for outbound calls
# curl           : fetches yt-dlp binary + Deno install script below
# unzip          : required by Deno's install.sh
# openssl        : Prisma query engine uses libssl (libssl3 ships in the base
#                  image, but keeping `openssl` here makes the engine's
#                  OpenSSL detection deterministic across base-image updates)
RUN apt-get update && apt-get install -y --no-install-recommends \
  ffmpeg \
  chromium \
  ca-certificates \
  curl \
  unzip \
  openssl \
  && rm -rf /var/lib/apt/lists/*

# --- Deno + yt-dlp in a SEPARATE layer ---
# Kept out of the apt layer so a transient download failure (Deno dl-server,
# GitHub releases CDN) does not invalidate the apt cache on retry. This is
# the most common cause of "apt-get install failed" on Railway rebuilds:
# a later step in the same RUN fails, the whole layer is re-run next time,
# and the failure now appears at apt because that's the first line.
RUN set -eux \
  && export DENO_INSTALL=/usr/local \
  && curl -fsSL https://deno.land/install.sh | sh \
  && chmod +x /usr/local/bin/deno \
  && deno --version \
  && arch="$(echo "${TARGETARCH}" | tr '[:upper:]' '[:lower:]')" \
  && case "$arch" in \
       arm64|aarch64) ytdlp_asset="yt-dlp_linux_aarch64" ;; \
       *) ytdlp_asset="yt-dlp_linux" ;; \
     esac \
  && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlp_asset}" -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && /usr/local/bin/yt-dlp --version \
  && ffmpeg -version | head -n 1 \
  && ffprobe -version | head -n 1

ENV NODE_ENV=production
# Puppeteer → system Chromium installed above; never try to download its own.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# yt-dlp EJS / YouTube player extraction: prefer Deno, then Node.
ENV YT_DLP_JS_RUNTIMES=deno:/usr/local/bin/deno,node:/usr/local/bin/node
# Point the shared ffmpeg-binaries resolver at the apt-installed binary so
# fluent-ffmpeg + spawn() sites agree on a single path across the server.
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe
# ---------------------------------------------------------------------------
# YouTube operator cookies are intentionally NOT baked into this image.
# Provide them at runtime via a Railway Volume or Secret File mount and set
# `YT_DLP_COOKIES` to the absolute path of the mounted file. See
# `docs/YOUTUBE_CLIPPER_OPERATORS.md` for the operator runbook.
# ---------------------------------------------------------------------------

COPY --from=build /app /app

EXPOSE 5000
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/index.js"]
