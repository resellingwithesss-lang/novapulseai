# Railway — API service (manual UI checklist)

Repo is already configured via **`railway.toml`** in this directory. Complete these steps in Railway.

**Build:** Railway uses **`server/Dockerfile`** (not Railpack `npm ci` on the builder VM). That avoids missing **`python`** during native dependency installs (for example **sharp** / node-gyp) and ships **Chromium, ffmpeg, yt-dlp** with the API.

## 1. Create / link the service

1. [railway.app](https://railway.app) → your **project** (same project as Postgres).
2. **New** → **GitHub Repo** → select **this repository**.
3. Open the new **service** → **Settings**:
   - **Root Directory:** `server`
   - **Config-as-code:** if deploy ignores `railway.toml`, set path to **`server/railway.toml`**.
4. **Build → Builder:** should show **Dockerfile** (from `builder = "DOCKERFILE"` in `railway.toml`). If the UI still shows Railpack/Nixpacks, set **Builder** to **Dockerfile** and **Dockerfile path** to **`Dockerfile`** (relative to root directory `server`).
5. Clear any **custom Build command** in the UI so it does not run a second `npm ci` on the host; the Dockerfile owns install and compile.

## 2. Networking

1. **Settings** → **Networking** → **Generate domain** (or attach custom domain).
2. Copy the **HTTPS** URL (no trailing slash) — you will use it as `NEXT_PUBLIC_API_URL` on Vercel and for Stripe webhooks.

## 3. Variables — Postgres

1. Service → **Variables**.
2. **Add Reference** → select your **PostgreSQL** service → variable **`DATABASE_URL`**.
   - (Or paste external `DATABASE_URL` if DB is not on Railway.)

## 4. Variables — required for boot (`NODE_ENV=production`)

Add each **Raw** variable (values are yours):

| Name | Value |
|------|--------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Random string **≥ 32** characters |
| `GOOGLE_CLIENT_ID` | Your Web client ID |
| `GOOGLE_CLIENT_SECRET` | Your Web client secret |
| `OPENAI_API_KEY` | `sk-...` |
| `STRIPE_SECRET_KEY` | `sk_live_...` or `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_STARTER_MONTHLY` | `price_...` |
| `STRIPE_PRICE_PRO_MONTHLY` | `price_...` |
| `STRIPE_PRICE_ELITE_MONTHLY` | `price_...` |
| `FRONTEND_URL` | Your Vercel app origin, e.g. `https://your-app.vercel.app` |
| `CLIENT_URL` | Same as `FRONTEND_URL` (simplest) |
| `PUBLIC_APP_URL` | Same as `FRONTEND_URL` (emails / links) |
| `AUTH_COOKIE_SAMESITE` | `none` (required when Next and API are different hosts) |

Optional: `ALLOWED_ORIGINS`, `RESEND_*`, `TRUST_PROXY_HOPS`, `PRISMA_SKIP_*` (only if documented).

## 5. Deploy

1. **Deployments** → trigger deploy (or push to connected branch).
2. Watch **Build logs** — should show **Using Dockerfile** / Docker build steps (`RUN npm ci`, `prisma generate`, `npm run build` inside the image).
3. Watch **Pre-deploy** — should run `npm run migrate:deploy`.
4. Watch **Deploy** — should run `node dist/index.js` (Railway **Start command** from `railway.toml`; image `CMD` is a fallback if unset).

## 6. Success

- Build finishes without error.
- Pre-deploy exits **0** (migrations applied or “already applied”).
- Runtime logs show server listening; no `validateServerEnvironment` exit.
- `curl https://<your-railway-domain>/health` → **200**
- `curl https://<your-railway-domain>/readyz` → **200**, JSON `ok: true`

## 7. If something fails

| Symptom | Likely cause |
|---------|----------------|
| Build: `Couldn't find the 'python' binary` during `npm ci` | Host Railpack build — use **Dockerfile** builder with **Root Directory** `server` and `railway.toml` loaded (`builder = "DOCKERFILE"`). |
| Build: `tsc` not found | Dev deps missing in image — Dockerfile runs full `npm ci` before `npm prune --omit=dev`. Do **not** set `NPM_CONFIG_PRODUCTION=true` before the build stage completes. |
| Pre-deploy: `prisma` not found | Rare — `prisma` is in **`dependencies`** in `package.json`. Run `npm ci` locally and commit lockfile. |
| Pre-deploy: DB connection error | Wrong **`DATABASE_URL`** or Postgres not reachable from Railway network — use **Reference** to Railway Postgres. |
| Crash on start: missing env | `validateServerEnvironment` — add every variable in section 4. |
| `/readyz` 503 | DB down or `DATABASE_URL` missing at runtime. |
| Health check never green | Timeout too short or app crashes before listen — read **Deploy** logs. |

## 8. What you should NOT override in UI (unless debugging)

If **`railway.toml`** is loaded, these are defined in file:

- **Build:** none on the host — **Dockerfile** performs `npm ci`, `prisma generate`, `npm run build`, `npm prune --omit=dev`.
- **Pre-deploy:** `npm run migrate:deploy`
- **Start:** `node dist/index.js`
- **Health check path:** `/readyz`

Do **not** set a Railpack **Build command** that duplicates `npm ci` unless you intentionally use a non-Docker builder.
