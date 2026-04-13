# syntax=docker/dockerfile:1
# Optional: self-host the Next.js App Router frontend.
# Prefer Vercel for early SaaS; use this for same-host or private VPC deployments.
#
# Build (pass public env at build — Next bakes NEXT_PUBLIC_* into the client bundle):
#   docker build \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
#     --build-arg NEXT_PUBLIC_APP_URL=https://app.example.com \
#     --build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com \
#     -t novapulseai-web .

FROM node:20-bookworm-slim AS build
WORKDIR /app

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.js ./

EXPOSE 3000
ENV PORT=3000
CMD ["npx", "next", "start", "-H", "0.0.0.0"]
