# Execute: Railway (API) + Vercel (Next) + Postgres

Do steps **in order**. Replace placeholders:

| Placeholder | What it is |
|-------------|------------|
| `YOUR_API_PUBLIC_URL` | Railway **public URL** for the API service, e.g. `https://novapulseai-production.up.railway.app` (copy from Railway **Settings → Networking → Public Networking**). **No trailing slash.** **No** `/api` suffix. |
| `YOUR_APP_PUBLIC_URL` | Vercel production URL, e.g. `https://your-app.vercel.app` or `https://app.yourdomain.com`. **No trailing slash.** |

---

## Phase A — Postgres (managed)

### Option A1 — Railway Postgres (simplest)

1. In Railway: **New Project** → **Database** → **Add PostgreSQL**.
2. Wait until it is **Running**.
3. Click the Postgres service → **Variables** → copy **`DATABASE_URL`** (or use **Connect** and copy the connection string).
4. It will look like: `postgresql://postgres:PASSWORD@HOST.railway.internal:5432/railway` for **private** networking.
5. For the **API** service (next phase), Railway can inject this automatically: in your **API** service → **Variables** → **Add Reference** → choose the Postgres service → **`DATABASE_URL`**. That is the preferred method (no copy/paste drift).

### Option A2 — External managed Postgres (Neon, Supabase, etc.)

1. Create a **production** database in the provider dashboard.
2. Copy the **connection string** for **Node** / **serverless** (usually includes `sslmode=require`).
3. You will paste it as **`DATABASE_URL`** on the Railway API service in Phase B.

**Before Phase B:** have **one** `DATABASE_URL` value ready (reference or string).

---

## Phase B — Railway API service

### B1. Create the service

1. Same Railway project (recommended): **New** → **GitHub Repo** → select **this monorepo**.
2. Railway creates a service. Open it → **Settings**:
   - **Root Directory:** `server`
   - **Watch paths** (optional): `server/**` so client-only commits do not redeploy the API.
3. **Config as code:** if `server/railway.toml` is not detected, set **Config file path** to `server/railway.toml`.
4. **Copy-paste UI checklist:** see **`server/RAILWAY.md`** in the repo.

### B2. Link Postgres to the API

- If you use **Railway Postgres**: on the **API** service → **Variables** → **Add Reference** → Postgres → **`DATABASE_URL`**.
- If you use **external Postgres**: **Variables** → **New Variable** → `DATABASE_URL` = full connection string from the provider.

### B3. Build & start (exact)

These match **`server/railway.toml`** (overrides UI if the file is loaded). The API is built with **`server/Dockerfile`** so **`npm ci`** runs **inside Debian** with **python3 / g++** available for native modules (for example **sharp**) and with **Chromium, ffmpeg, yt-dlp** baked in.

| Setting | Value |
|---------|--------|
| **Root Directory** | `server` |
| **Builder** | **Dockerfile** (`builder = "DOCKERFILE"`, `dockerfilePath = "Dockerfile"` in `railway.toml`) |
| **Dockerfile path** | `Dockerfile` *(relative to `server/`)* |
| **Build command** | *(leave empty — image build is defined in the Dockerfile)* |
| **Pre-deploy command** | `npm run migrate:deploy` |
| **Start command** | `node dist/index.js` |

Railway sets **`PORT`** automatically. Your app reads `process.env.PORT` (see `server/src/index.ts`) — **do not** hardcode `5000` in production unless your platform requires it.

**Health check:** path **`/readyz`**, timeout **120s** (first Prisma cold start can be slow).

### B4. Public URL

1. API service → **Settings** → **Networking** → **Generate domain** (or attach custom domain).
2. Copy the **HTTPS** URL → this is **`YOUR_API_PUBLIC_URL`**.

### B5. API environment variables (paste on Railway → API service → Variables)

Create **each** row (name = left, value = right). Use your real secrets where noted.

**Core**

| Name | Value |
|------|--------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | *(Reference to Railway Postgres, or paste external string)* |

**Auth / session (Vercel + Railway = different sites → cross-site cookie)**

| Name | Value |
|------|--------|
| `AUTH_COOKIE_SAMESITE` | `none` |

**JWT / Google (same OAuth Web client as Vercel)**

| Name | Value |
|------|--------|
| `JWT_SECRET` | Random string **≥ 32 characters** |
| `GOOGLE_CLIENT_ID` | e.g. `123456789-xxxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud |

**CORS + billing redirects (must match Vercel production URL)**

| Name | Value |
|------|--------|
| `FRONTEND_URL` | **`YOUR_APP_PUBLIC_URL`** |
| `CLIENT_URL` | **`YOUR_APP_PUBLIC_URL`** *(same value is fine)* |
| `PUBLIC_APP_URL` | **`YOUR_APP_PUBLIC_URL`** *(emails / links)* |

**Optional:** `ALLOWED_ORIGINS` — comma-separated **extra** origins only (e.g. `https://your-app-git-staging-xxx.vercel.app` for preview testing against this API).

**OpenAI / Stripe**

| Name | Value |
|------|--------|
| `OPENAI_API_KEY` | `sk-...` |
| `STRIPE_SECRET_KEY` | `sk_live_...` or `sk_test_...` for staging |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret from Stripe (see Phase D) |
| `STRIPE_PRICE_STARTER_MONTHLY` | `price_...` |
| `STRIPE_PRICE_PRO_MONTHLY` | `price_...` |
| `STRIPE_PRICE_ELITE_MONTHLY` | `price_...` |
| `STRIPE_PRICE_STARTER_YEARLY` | *(if you sell yearly)* |
| `STRIPE_PRICE_PRO_YEARLY` | *(if you sell yearly)* |
| `STRIPE_PRICE_ELITE_YEARLY` | *(if you sell yearly)* |

**Email (optional)**

| Name | Value |
|------|--------|
| `RESEND_API_KEY` | From Resend |
| `RESEND_FROM_EMAIL` | `NovaPulseAI <mail@yourdomain.com>` (verified sender / domain in Resend) |

**Proxy (usually leave default)**

| Name | Value |
|------|--------|
| `TRUST_PROXY_HOPS` | `1` |

**Puppeteer / ads (Docker image on Railway)**

| Name | Value |
|------|--------|
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium` |

The **`server/Dockerfile`** image sets **`PUPPETEER_SKIP_CHROMIUM_DOWNLOAD`** and **`PUPPETEER_EXECUTABLE_PATH`** for system Chromium. Set the variable above if you override image defaults or run a custom start command without those env vars.

### B6. Deploy

1. **Deploy** (or push to the connected branch).
2. Open **Deployments** → wait for **Success**.
3. If **Pre-deploy** fails: read logs — almost always **`DATABASE_URL`** wrong or DB unreachable.
4. If **Crash after start**: read logs — often **`validateServerEnvironment`** (missing Stripe/OpenAI/CORS).

### B7. Verify API from your laptop

```bash
curl -sS "YOUR_API_PUBLIC_URL/health"
curl -sS "YOUR_API_PUBLIC_URL/readyz"
```

Expect **HTTP 200** and JSON with `status: ok` / `ok: true`.

---

## Phase C — Google Cloud Console (OAuth Web client)

Use the **same** client ID on Vercel and Railway (`GOOGLE_CLIENT_ID` = `NEXT_PUBLIC_GOOGLE_CLIENT_ID`).

1. [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**.
2. Open your **OAuth 2.0 Client ID** (type **Web application**).

**Authorized JavaScript origins** — add:

- `YOUR_APP_PUBLIC_URL`  
- (Optional) `http://localhost:3000` for local dev  
- (Optional) each Vercel **preview** URL you will use with Google sign-in

**Authorized redirect URIs** — add only if you use redirect-based OAuth flows that need explicit URIs. For this codebase’s **Google button / One Tap** pattern, **JavaScript origins** are the critical part.

3. Save.

---

## Phase D — Stripe

1. [Stripe Dashboard](https://dashboard.stripe.com/) → **Developers** → **Webhooks** → **Add endpoint**.
2. **Endpoint URL:**  
   `YOUR_API_PUBLIC_URL/api/billing/webhook`  
   Example: `https://novapulseai-production.up.railway.app/api/billing/webhook`
3. **Events** — use **“Select events”** and add exactly what the API handles (`server/src/modules/billing/webhook.routes.ts`):
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`  
   (Avoid “Send all events” in **live** mode.)
4. After creating the endpoint, reveal **Signing secret** → copy → Railway **`STRIPE_WEBHOOK_SECRET`**.
5. **API keys:** copy **Secret key** → Railway **`STRIPE_SECRET_KEY`** (test vs live must match webhook mode).
6. **Products / Prices:** create live (or test) prices → copy **Price IDs** into **`STRIPE_PRICE_*`** variables on Railway.

---

## Phase E — Vercel (Next.js frontend)

### E1. New project

1. [vercel.com](https://vercel.com) → **Add New** → **Project** → import **this GitHub repo**.
2. **Root Directory:** `client`
3. **Framework Preset:** Next.js (auto).
4. **Build Command:** default `next build` (leave as-is unless you changed it).
5. **Output:** default.
6. **Install Command:** default `npm install` (or `npm ci` if you use lockfile-only; either works).

### E2. Production environment variables (Vercel → Project → Settings → Environment Variables → **Production**)

| Name | Value |
|------|--------|
| `NEXT_PUBLIC_API_URL` | **`YOUR_API_PUBLIC_URL`** |
| `NEXT_PUBLIC_APP_URL` | **`YOUR_APP_PUBLIC_URL`** |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | **Same string as** `GOOGLE_CLIENT_ID` on Railway |

**Important:** `NEXT_PUBLIC_*` are inlined at **build time**. After changing them, go to **Deployments** → **⋯** on the latest production deployment → **Redeploy** (with “Use existing Build Cache” **unchecked** if you need a full rebuild).

### E3. Production domain

- Either use the default **`*.vercel.app`** URL as **`YOUR_APP_PUBLIC_URL`**, or attach a custom domain under **Settings → Domains**.
- After the URL is final, go back to **Railway** and confirm **`FRONTEND_URL` / `CLIENT_URL` / `PUBLIC_APP_URL`** match that exact origin (scheme + host, no path).

### E4. Deploy

Trigger a deployment. Confirm the build log shows **no** `next.config` error about missing `NEXT_PUBLIC_*`.

---

## Phase F — Final order (checklist)

1. Postgres running + **`DATABASE_URL`** available  
2. Railway API: **Root `server`**, build/start/predeploy as above, **all env vars** set  
3. Railway **public HTTPS URL** → **`YOUR_API_PUBLIC_URL`**  
4. `curl` **`/health`** and **`/readyz`**  
5. Stripe **webhook** → **`YOUR_API_PUBLIC_URL/api/billing/webhook`** + **`STRIPE_WEBHOOK_SECRET`**  
6. Google **JavaScript origins** → **`YOUR_APP_PUBLIC_URL`**  
7. Vercel: **Root `client`**, **`NEXT_PUBLIC_*`**, deploy / redeploy  
8. Smoke tests (below)

---

## Smoke tests (after all phases)

1. Browser: open **`YOUR_APP_PUBLIC_URL`** — page loads, no console CSP errors mentioning blocked API.
2. **Register** (email + password) → success.
3. **Logout** / **Login** → success.
4. **Google** sign-in → completes; you remain signed in after refresh.
5. **Billing** (test mode first if possible): open checkout or customer portal → Stripe loads → return URL lands on **`/dashboard/billing`** on your app domain.
6. Stripe **Webhook** tab → recent delivery **200** (not 4xx/5xx).
7. Optional: one **AI** action (generation) succeeds.

If Google works but API returns **401** on `fetch`: check **`AUTH_COOKIE_SAMESITE=none`**, HTTPS on both sides, and CORS allowlist includes **`YOUR_APP_PUBLIC_URL`**.
