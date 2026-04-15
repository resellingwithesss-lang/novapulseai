# NovaPulseAI / ViralForge — production deployment

This document matches the **implemented** launch guardrails in the monorepo (env validation, `/health`, `/readyz`, Docker, CI, cookies/CORS). Use it as the single runbook for going live.

**Step-by-step go-live (Vercel + Railway/Render + Postgres):** see **[LAUNCH_EXECUTION.md](./LAUNCH_EXECUTION.md)**.

**Railway + Vercel + Postgres (execution walkthrough):** **[DEPLOY_RAILWAY_VERCEL.md](./DEPLOY_RAILWAY_VERCEL.md)**.

---

## Recommended architecture (cost-conscious early SaaS)

| Layer | Recommendation | Why |
|--------|------------------|-----|
| **Frontend** | **Vercel** (Next.js 13 App Router) | Zero-ops CDN, preview URLs, env per environment. |
| **API** | **Railway**, **Render**, or **Fly.io** | Managed Node, Postgres add-on, secrets, health checks. **Avoid** “serverless only” for this API: Puppeteer, ffmpeg, yt-dlp, and long-running ad jobs need a **persistent VM/container**. |
| **Database** | **Managed Postgres** (Neon, Supabase, RDS, Railway Postgres) | Backups, TLS, connection pooling (PgBouncer) at scale. |
| **Redis** | **Optional** for v1 | Not wired in the codebase today; add when you need distributed rate limits or job queues beyond the in-process email worker. |
| **Object storage** | **Phase 2** (S3/R2) | Today `clips/` and `generated/` are **local disk** on the API host. For multi-instance or diskless containers, move uploads and outputs to object storage and serve via signed URLs or a CDN. |

**Safest first production approach for media (ads, clips, ffmpeg, Puppeteer):**

- Run the **API as a single instance** (or one worker + one web process on the same volume) so `clips/` and `generated/` stay consistent.
- Set **`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`** in Docker (see `server/Dockerfile`) so capture does not rely on Puppeteer’s downloaded Chrome.
- Keep **heavy ad generation** off autoscaled “N× tiny” replicas until you add object storage + a job queue.

---

## Production blockers (resolved in repo vs manual)

| Topic | Status |
|--------|--------|
| DB schema behind code (sign-in P2021/P2022) | **Mitigated:** startup `assertApiDatabaseReady` + `POST`/`GET` auth returns `DATABASE_SCHEMA_MIGRATION_REQUIRED`. **You:** run `npx prisma migrate deploy` on every deploy. |
| Missing critical env in prod | **Implemented:** `validateServerEnvironment()` when `NODE_ENV=production`. |
| CORS / credentialed API | **Implemented:** production allowlist from `CLIENT_URL`, `FRONTEND_URL`, `ALLOWED_ORIGINS`. **You:** set origins to real `https://` app URLs. |
| Cross-origin session cookie (Vercel + separate API host) | **Implemented:** `AUTH_COOKIE_SAMESITE=none` + `secure` cookie (see below). **You:** HTTPS everywhere; set env on API. |
| Next build without public URLs | **Implemented:** `client/next.config.js` requires `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_APP_URL` for production builds. **You:** set them in Vercel / CI. |
| Stripe portal `return_url` | **Implemented:** `resolveFrontendBaseUrl()` (`FRONTEND_URL` / `CLIENT_URL` / `PUBLIC_APP_URL`). |
| Puppeteer in Docker | **Implemented:** `PUPPETEER_EXECUTABLE_PATH`, shared `puppeteerLaunchOptions()`, Debian image installs `chromium`. |
| Health for LB | **Implemented:** `GET /health` (liveness), `GET /readyz` (DB readiness). |
| Prisma Linux engines in Docker | **Implemented:** `binaryTargets = ["native", "debian-openssl-3.0.x"]` in `schema.prisma`. **You:** run `npx prisma generate` after pull. |

---

## Required environment variables

### API server (`server/`, Docker, Railway, etc.)

**Always (all environments):**

- `JWT_SECRET` — min 32 characters  
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`  
- `DATABASE_URL` — required before listen (also enforced in production validation)

**When `NODE_ENV=production` (strict):**

- `OPENAI_API_KEY`  
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`  
- At least one of `CLIENT_URL`, `FRONTEND_URL`, or `ALLOWED_ORIGINS` (non-empty origin allowlist for CORS)  
- At least one of `FRONTEND_URL`, `CLIENT_URL`, or `PUBLIC_APP_URL` (billing portal return URL + emails)

**Strongly recommended:**

- `STRIPE_PRICE_*` monthly price IDs (see `server/.env.example`); server logs a warning if placeholders remain.  
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `PUBLIC_APP_URL` — if using transactional/broadcast email.  
- `TRUST_PROXY_HOPS` — default `1`; set to `2` if you have **CDN → edge → app** (see Express docs).  
- `AUTH_COOKIE_SAMESITE` — default `lax`. Use **`none`** when the browser loads the **Next app on a different site** than the API (e.g. `app.vercel.app` → `api.railway.app`). Requires HTTPS (`secure` cookie).  
- `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` in Docker (set in `server/Dockerfile`).

### Next.js client (Vercel / Docker build)

- `NEXT_PUBLIC_API_URL` — public origin of the API (no path; e.g. `https://api.example.com`)  
- `NEXT_PUBLIC_APP_URL` — canonical app URL (e.g. `https://app.example.com`)  
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — same Web client ID as server `GOOGLE_CLIENT_ID`

---

## Deploy order

1. **Create managed Postgres** and note connection string.  
2. **Apply migrations** (once per environment, and on every release before or as part of rollout):  
   `cd server && npx prisma migrate deploy`  
3. **Set API secrets** on the host (see table above).  
4. **Deploy API**; confirm `GET /health` = 200 and `GET /readyz` = 200.  
5. **Configure Stripe webhook** to `https://<api>/api/billing/webhook` with the **production** signing secret (`STRIPE_WEBHOOK_SECRET`). **Billing-specific events, trial policy, credit replay rules, and QA:** see **[billing-rollout.md](./billing-rollout.md)**.  
6. **Google Cloud Console** — Authorized JavaScript origins: your **Next** URL(s). Authorized redirect URIs if you use redirect flows.  
7. **Deploy Next** with `NEXT_PUBLIC_*` set for that environment.  
8. **Smoke test:** register/login, Google sign-in, billing portal, one paid flow in Stripe test mode first, then production.

---

## Docker

**API (context = `server/`):**

```bash
cd server
docker build -t novapulseai-api .
docker run --env-file .env -p 5000:5000 novapulseai-api
```

The image runs `prisma migrate deploy` then `node dist/index.js`. Ensure `DATABASE_URL` is injected at runtime.

**Client (optional self-host):**

```bash
cd client
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
  --build-arg NEXT_PUBLIC_APP_URL=https://app.example.com \
  -t novapulseai-web .
```

---

## NPM scripts

| Script | Purpose |
|--------|---------|
| `server/npm run start:prod` | `prisma migrate deploy && node dist/index.js` (use if migrations are not run by the platform). |
| `server/npm run migrate:deploy` | Migrations only. |
| Root `npm run ci:check` | Lint + typecheck + `prisma validate` (local gate). |

---

## Rollback

1. **Revert** the deployment to the previous API image / Git revision.  
2. **Database:** Prisma migrations are forward-only in production — do **not** `migrate reset`. If a migration was bad, ship a **follow-up migration** that repairs data/schema.  
3. **Stripe:** disable or rotate webhook secret if a bad deploy processed bad events; replay from Stripe Dashboard if needed.

---

## Post-deploy verification checklist

- [ ] `GET https://api.../health` → 200, JSON `status: ok`  
- [ ] `GET https://api.../readyz` → 200, `checks.database: up`  
- [ ] Register + login (email/password)  
- [ ] Google One Tap / button (cookie present on return)  
- [ ] CORS: no browser errors on credentialed `fetch` to API  
- [ ] Stripe Checkout or portal opens; `return_url` lands on `/dashboard/billing`  
- [ ] Stripe webhook: test event or real subscription updates DB (`User.plan`, credits) — full checklist: [billing-rollout.md](./billing-rollout.md)  
- [ ] One generation or clip path hits OpenAI without 503 misconfig  
- [ ] Optional: ad capture job on staging (Puppeteer + ffmpeg + disk)  
- [ ] Logs: JSON lines in production (`server/src/lib/logger.ts`)

---

## What you still must do manually

- Create cloud accounts (Vercel, API host, Postgres, Stripe live vs test).  
- Paste secrets into each platform (never commit `.env`).  
- **Google OAuth** console: origins + client IDs for prod domains.  
- **Stripe** products/prices and webhook endpoint for prod.  
- **DNS** + TLS certificates (usually automatic on Vercel / Railway / Render).  
- When you outgrow single-disk media: **S3/R2** + URL strategy (not implemented in this pass).

---

## File reference (this launch pass)

- `server/src/lib/validate-server-env.ts` — production env gate  
- `server/src/lib/frontend-url.ts` — Stripe portal base URL  
- `server/src/lib/puppeteer-launch.ts` — Chromium flags + executable path  
- `server/src/app.ts` — `/readyz`, `TRUST_PROXY_HOPS`, health `revision`  
- `server/src/index.ts` — calls `validateServerEnvironment()`  
- `server/src/modules/auth/auth.routes.ts` — `AUTH_COOKIE_SAMESITE`, `secure` when `none`  
- `server/src/modules/billing/billing.manage.routes.ts` — portal `return_url`
- `server/src/modules/billing/billing.routes.ts` — Stripe Checkout `success_url` / `cancel_url`, Zod body, server price map, PRO monthly trial, idempotency keys  
- `server/src/modules/billing/webhook.routes.ts` — signed webhooks, subscription + invoice handlers, replay guards  
- `docs/billing-rollout.md` — **Stripe billing rollout & QA** (env, migrations, webhook events, test/live checks)  
- `server/prisma/schema.prisma` — `binaryTargets` for Linux containers  
- `server/Dockerfile`, `server/.dockerignore`  
- `client/Dockerfile`, `client/.dockerignore`  
- `client/next.config.js` — production public URL validation  
- `.github/workflows/ci.yml` — Prisma validate, server build, client build  
- `docs/PRODUCTION.md` — this file  
