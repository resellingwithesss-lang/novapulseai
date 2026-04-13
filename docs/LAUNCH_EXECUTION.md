# Final launch execution — Vercel + Railway or Render + Postgres

Use this file at go-live. Replace placeholders:

| Placeholder | Example |
|---------------|---------|
| `APP_ORIGIN` | `https://app.yourdomain.com` (production Next.js URL, **no trailing slash**) |
| `API_ORIGIN` | `https://your-api.up.railway.app` or `https://your-api.onrender.com` (**no** `/api` suffix) |

`NEXT_PUBLIC_API_URL` must equal **`API_ORIGIN`** (the Express server root). The browser calls `API_ORIGIN/api/...` (or uses Next rewrites to proxy `/api` — your `next.config.js` rewrites to this base).

---

## 1. What is already done (in repo)

- Production **env validation** on API (`server/src/lib/validate-server-env.ts`) when `NODE_ENV=production`.
- **DB readiness** at boot (`assertApiDatabaseReady`) + **`GET /readyz`** (Prisma `SELECT 1`).
- **`GET /health`** liveness + optional `revision` from `RENDER_GIT_COMMIT` / `RAILWAY_GIT_COMMIT_SHA` / etc.
- **CORS** allowlist from `CLIENT_URL`, `FRONTEND_URL`, `ALLOWED_ORIGINS` (`server/src/lib/cors-allowlist.ts`).
- **Stripe** Checkout + Portal return URLs via **`resolveFrontendBaseUrl()`** (`FRONTEND_URL` → `CLIENT_URL` → `PUBLIC_APP_URL`).
- **Auth cookie**: `AUTH_COOKIE_SAMESITE` (`server/src/modules/auth/auth.routes.ts`); use **`none`** when app and API are different sites (Vercel + Railway).
- **Trust proxy**: `TRUST_PROXY_HOPS` (default `1`) in `server/src/app.ts`.
- **Next production build** requires `NEXT_PUBLIC_API_URL` + `NEXT_PUBLIC_APP_URL` (`client/next.config.js`).
- **Dockerfile** for API (`server/Dockerfile`) with chromium, ffmpeg, yt-dlp; **`start:prod`** runs migrations + node.
- **CI**: Prisma validate, server build, client build (`.github/workflows/ci.yml`).
- Long-form reference: `docs/PRODUCTION.md`.

---

## 2. What you must still do manually (cannot be automated in git)

1. **Create accounts**: Vercel, Railway or Render, Postgres provider (or platform add-on), Stripe, Google Cloud.
2. **Buy/configure DNS** for `APP_ORIGIN` (optional custom domain for API).
3. **Paste secrets** into each dashboard (never commit `.env`).
4. **Stripe**: create **live** products/prices; copy price IDs into `STRIPE_PRICE_*`; create **webhook** endpoint pointing at **`API_ORIGIN/api/billing/webhook`**; copy signing secret to `STRIPE_WEBHOOK_SECRET`.
5. **Google Cloud Console**: OAuth Web client — **Authorized JavaScript origins** = `APP_ORIGIN` (and preview origins if needed). Add **`ALLOWED_ORIGINS`** on API for each Vercel preview origin you use with credentialed API calls.
6. **First deploy**: run migrations against the **production** `DATABASE_URL` (Docker `CMD` and `npm run start:prod` already include `prisma migrate deploy`; if your start command is plain `node dist/index.js`, run migrate as a release step).
7. **Single API instance** (or shared disk) until you add object storage for `clips/` + `generated/` (see `docs/PRODUCTION.md`).

---

## 3. Exact deployment order

1. **Postgres** — create database; enable SSL; copy **`DATABASE_URL`** (often `?sslmode=require` or provider-specific).
2. **API service** (Railway or Render) — create service from repo; set root to **`server/`** (or use Docker build from `server/`); set **all API env vars** (section 4); set **`NODE_ENV=production`**.
3. **First API deploy** — confirm logs: no exit on `validateServerEnvironment`; **`GET API_ORIGIN/health`** → 200; **`GET API_ORIGIN/readyz`** → 200.
4. **Stripe webhook** — URL **`API_ORIGIN/api/billing/webhook`**; events: at minimum `customer.subscription.*`, `invoice.paid` / your current webhook handler set (match what `webhook.routes.ts` subscribes to); **live** signing secret on API.
5. **Google OAuth** — origins include **`APP_ORIGIN`**.
6. **Vercel** — import repo **`client/`** as project root *or* monorepo with **Root Directory** = `client`; set **all Vercel env vars** (section 5); **Production** `NEXT_PUBLIC_APP_URL` = **`APP_ORIGIN`**, `NEXT_PUBLIC_API_URL` = **`API_ORIGIN`**.
7. **Redeploy Vercel** after env change (Next bakes `NEXT_PUBLIC_*` at build).
8. **End-to-end smoke** (section 7).

**Why API before Vercel:** you need a stable **`API_ORIGIN`** for `NEXT_PUBLIC_API_URL` and for Stripe’s webhook URL. You can swap order only if `API_ORIGIN` is already known (custom domain).

---

## 4. Environment variables — API (Railway or Render)

Set on the **API** service (same names as `server/.env.example`).

### Required for process to start (`NODE_ENV=production`)

| Variable | Value |
|----------|--------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Postgres connection string from provider |
| `JWT_SECRET` | Random string **≥ 32 characters** |
| `GOOGLE_CLIENT_ID` | Same Web client ID as Vercel `NEXT_PUBLIC_GOOGLE_CLIENT_ID` |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud |
| `OPENAI_API_KEY` | OpenAI secret key |
| `STRIPE_SECRET_KEY` | `sk_live_...` (or test for staging) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret for **this** endpoint’s mode (test vs live) |

### Required for CORS + billing redirects (must match real URLs)

| Variable | Value |
|----------|--------|
| `FRONTEND_URL` | **`APP_ORIGIN`** (recommended single source) |
| `CLIENT_URL` | Also **`APP_ORIGIN`** if you use it elsewhere, or omit if `FRONTEND_URL` is set |
| `ALLOWED_ORIGINS` | Optional comma-separated extra origins (e.g. `https://your-app-git-main-xxx.vercel.app` for previews) |

**CORS rule:** the browser’s `Origin` for your Next app must appear in the allowlist. Setting **`FRONTEND_URL`** and **`CLIENT_URL`** both to **`APP_ORIGIN`** is the simplest production setup.

### Cross-origin session (Vercel app ≠ API host)

| Variable | Value |
|----------|--------|
| `AUTH_COOKIE_SAMESITE` | **`none`** |
| (implicit) | API must be **HTTPS**; cookie is `secure` when `none` |

### Recommended

| Variable | Value |
|----------|--------|
| `PORT` | Usually set by platform (Railway/Render inject `PORT`); keep default **5000** only if platform docs say so |
| `TRUST_PROXY_HOPS` | `1` (raise to `2` only if you see wrong client IP / rate-limit issues behind double proxies) |
| `STRIPE_PRICE_STARTER_MONTHLY` | Live price id |
| `STRIPE_PRICE_PRO_MONTHLY` | Live price id |
| `STRIPE_PRICE_ELITE_MONTHLY` | Live price id |
| `STRIPE_PRICE_*_YEARLY` | If you sell yearly |
| `PUBLIC_APP_URL` | Same as **`APP_ORIGIN`** — used for email links / unsubscribe (`server/src/lib/email-env.ts`) |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | If sending email |

### Docker / Nixpacks on Railway

If the image/shell has Chromium at `/usr/bin/chromium`:

| Variable | Value |
|----------|--------|
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium` |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | `true` (optional; avoids duplicate browser download) |

**Health checks (Render / some setups):** path **`/readyz`** (strict) or **`/health`** (light).

---

## 5. Environment variables — Vercel (Next.js)

Set for **Production** (and **Preview** if you test previews against a staging API).

| Variable | Production value |
|----------|------------------|
| `NEXT_PUBLIC_APP_URL` | **`APP_ORIGIN`** |
| `NEXT_PUBLIC_API_URL` | **`API_ORIGIN`** |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Same as server `GOOGLE_CLIENT_ID` |

**Preview branches:** either point `NEXT_PUBLIC_API_URL` to a **staging API** or add that preview **`APP_ORIGIN`** to API **`ALLOWED_ORIGINS`** and use a preview API with matching CORS.

After changing `NEXT_PUBLIC_*`, trigger a **new deployment** (rebuild).

---

## 6. Google OAuth alignment

| Location | Setting |
|----------|---------|
| **Google Cloud → OAuth Web client → Authorized JavaScript origins** | `APP_ORIGIN` (and any preview `https://...vercel.app` you use) |
| **Vercel** | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` = that client’s ID |
| **API** | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` = same client |

If Google sign-in fails with origin errors, the **origin in the browser address bar** must be listed in Google Console **and** in API CORS (`FRONTEND_URL` / `ALLOWED_ORIGINS`).

---

## 7. Post-deploy tests (in order)

1. Open **`APP_ORIGIN`** — app loads, no CSP console errors for `connect-src` to **`API_ORIGIN`**.
2. **`curl -sS API_ORIGIN/health`** — JSON `status: ok`.
3. **`curl -sS API_ORIGIN/readyz`** — JSON `ok: true`, `checks.database: up`.
4. **Register** a new user (email/password) — success, cookie set (Application → Cookies → API host).
5. **Login** — success.
6. **Google** button — completes; session cookie present on API domain.
7. **Billing** — open checkout or portal; Stripe opens; after cancel/success, return URL is **`APP_ORIGIN/dashboard/billing`**.
8. **Stripe Dashboard → Webhooks** — send test event or complete test payment; API logs no 400 on signature.
9. **One AI path** (e.g. generation) — no “OPENAI_API_KEY missing” style errors.
10. **Optional:** run one **ad** / **clip** job on staging first (CPU + disk + Puppeteer).

---

## 8. Final blockers before launch (go / no-go)

- [ ] **`DATABASE_URL`** points to **production** DB; **`npx prisma migrate deploy`** has been run at least once against it.
- [ ] **`API_ORIGIN`** is **HTTPS** and stable.
- [ ] **`FRONTEND_URL`** (or `CLIENT_URL` / `PUBLIC_APP_URL`) equals **`APP_ORIGIN`**; CORS allowlist includes **`APP_ORIGIN`**.
- [ ] **`AUTH_COOKIE_SAMESITE=none`** if app and API are on **different** hostnames.
- [ ] **Vercel** `NEXT_PUBLIC_API_URL` === **`API_ORIGIN`**, `NEXT_PUBLIC_APP_URL` === **`APP_ORIGIN`**; redeploy after env set.
- [ ] **Stripe live** keys + **live** webhook secret + **live** price IDs (or consciously stay on test mode for a soft launch).
- [ ] **Google** JavaScript origins include **`APP_ORIGIN`**.
- [ ] **`/readyz`** returns 200 from the internet (not only localhost).
- [ ] You accept **single-instance API** (or equivalent) for **clips/generated** until object storage exists.

---

## 9. Railway vs Render (one-line differences)

| Topic | Railway | Render |
|--------|---------|--------|
| **Public URL** | Generated `*.up.railway.app` or custom domain | `*.onrender.com` or custom |
| **Health check** | Optional HTTP health path **`/readyz`** | Set health check URL to **`API_ORIGIN/readyz`** |
| **Migrations** | Use **`npm run start:prod`** in start command, or separate release phase | Same |
| **Disk** | Ephemeral unless you add a volume | Same — plan for **one** instance for media |

---

## 10. Rollback (30 seconds)

1. Revert API deployment to previous image / Git SHA in Railway or Render.  
2. Revert Vercel deployment to previous **Production** deployment.  
3. **Do not** `prisma migrate reset` on production. Fix bad migrations forward only.
