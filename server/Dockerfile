# syntax=docker/dockerfile:1
# Production API image: Express + Prisma + ffmpeg + Chromium (Puppeteer) + yt-dlp.
#
# Build (context must be this directory):
#   cd server && docker build -t novapulseai-api .
#
# From monorepo root:
#   docker build -f server/Dockerfile -t novapulseai-api ./server
# yt-dlp: we install the official release binary (not only Debian's package, which lags YouTube changes).
# npm's yt-dlp-exec postinstall targets an asset named "yt-dlp" that is not the Linux glibc binary — skip it and use /usr/local/bin/yt-dlp at runtime (see YOUTUBE_DL_SKIP_DOWNLOAD).

FROM node:20-bookworm-slim AS build
WORKDIR /app

# python-is-python3: yt-dlp-exec preinstall runs `bin-version-check-cli python ...` (needs `python` on PATH).
# python3 + build tools: node-gyp / sharp if a prebuild is missing.
RUN apt-get update && apt-get install -y --no-install-recommends \
  openssl \
  ca-certificates \
  chromium \
  python3 \
  python-is-python3 \
  make \
  g++ \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Avoid broken/mismatched postinstall binary; production uses system yt-dlp (see runner stage).
ENV YOUTUBE_DL_SKIP_DOWNLOAD=true
RUN npm ci

COPY . ./
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app

ARG TARGETARCH=amd64

RUN apt-get update && apt-get install -y --no-install-recommends \
  openssl \
  ca-certificates \
  curl \
  chromium \
  ffmpeg \
  python3 \
  python-is-python3 \
  && rm -rf /var/lib/apt/lists/* \
  && set -eux \
  && arch="$(echo "${TARGETARCH}" | tr '[:upper:]' '[:lower:]')" \
  && case "$arch" in \
       arm64|aarch64) ytdlp_asset="yt-dlp_linux_aarch64" ;; \
       *) ytdlp_asset="yt-dlp_linux" ;; \
     esac \
  && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytdlp_asset}" -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && /usr/local/bin/yt-dlp --version \
  && ffmpeg -version | head -n1 \
  && ffprobe -version | head -n 1

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --from=build /app /app

EXPOSE 5000
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/index.js"]
