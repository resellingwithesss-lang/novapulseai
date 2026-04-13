# syntax=docker/dockerfile:1
# Production API image: Express + Prisma + ffmpeg + Chromium (Puppeteer) + yt-dlp.
#
# Build (context must be this directory):
#   cd server && docker build -t novapulseai-api .
#
# From monorepo root:
#   docker build -f server/Dockerfile -t novapulseai-api ./server

FROM node:20-bookworm-slim AS build
WORKDIR /app

# python-is-python3: yt-dlp-exec preinstall runs `bin-version-check-cli python ...` (needs `python` on PATH).
# python3 + build tools: node-gyp / sharp if a prebuild is missing.
RUN apt-get update && apt-get install -y --no-install-recommends \
  openssl \
  ca-certificates \
  chromium \
  ffmpeg \
  yt-dlp \
  python3 \
  python-is-python3 \
  make \
  g++ \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci

COPY . ./
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  openssl \
  ca-certificates \
  chromium \
  ffmpeg \
  yt-dlp \
  python3 \
  python-is-python3 \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --from=build /app /app

EXPOSE 5000
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/index.js"]
