# Billing / Stripe checkout — production debug

**Deployment shape (browser → Next → Express → Stripe):** see [`deployment-topology.md`](./deployment-topology.md).

## Where `/api/billing/change-plan` runs

- **Implemented in the Express API** (`server/src/modules/billing/billing.routes.ts`), mounted at `app.use("/api/billing", billingRoutes)` in `server/src/app.ts`.
- **Not** a Next.js Route Handler in this repo.

## How the browser reaches it

1. The client calls `api.post("/billing/change-plan", body)` (see `client/src/app/pricing/page.tsx`, `client/src/app/dashboard/billing/page.tsx`).
2. `client/src/lib/api.ts` **`buildUrl`** (browser): same-origin path **`/api/billing/change-plan`** (no `NEXT_PUBLIC_API_URL` in the fetch URL).
3. **Next.js** (`client/next.config.js`) **rewrites** `/api/:path*` → **`${NEXT_PUBLIC_API_URL}/api/:path*`**.
4. The **Express** server must expose `POST /api/billing/change-plan` on that host.

So: **Vercel “frontend” project** handles `/api/*` by proxying to whatever **`NEXT_PUBLIC_API_URL`** is. The **API must be deployed and reachable** at that URL.

## Required environment

### Next.js (frontend / marketing app) build & runtime

| Variable | Role |
|----------|------|
| **`NEXT_PUBLIC_API_URL`** | Absolute base URL of the **Express API** (no trailing `/api` required; rewrites append `/api/...`). **Required in production** (`next.config.js` validates at build). |
| **`NEXT_PUBLIC_APP_URL`** | App URL (also required at build in prod). |

### Express API (separate service or same monorepo deploy)

| Variable | Role |
|----------|------|
| **`STRIPE_SECRET_KEY`** | Stripe secret (`sk_live_…` or `sk_test_…`). |
| **`STRIPE_PRICE_*`** | Six price env vars (`STARTER`/`PRO`/`ELITE` × `MONTHLY`/`YEARLY`) — must be real `price_…` ids in the **same mode** as the secret key. |
| **`FRONTEND_URL` or `CLIENT_URL` (or `PUBLIC_APP_URL`)** | Used for Checkout success/cancel URLs (`server/src/lib/frontend-url.ts`). |
| **`JWT_SECRET`**, **`DATABASE_URL`**, etc. | Auth and DB as elsewhere. |

Production startup (`server/src/lib/validate-server-env.ts`) can **exit** if Stripe price envs are missing or malformed when `NODE_ENV=production`.

## How to debug a failing checkout

1. **Browser DevTools → Network** → select `POST …/api/billing/change-plan` (or checkout).
2. Read the **JSON body**: it should include **`code`** and **`requestId`** on errors (not only `"Checkout failed"`).
   - If you see **`"Checkout failed"`** with **no `code`**, the **API deployment is stale** — rebuild/redeploy the Express server from current `main`.
3. Copy **`requestId`** (or response header **`X-Request-Id`**).
4. On the **API** host logs (not only the Next.js page logs), search for that id or for JSON lines with `"kind":"billing_event"`.

### Log sequence (happy path)

`billing_route_context` → `billing_checkout_attempt` → `billing_user_loaded` → (optional) `billing_subscription_branch_entered` → `stripe_checkout_session_create_started` → `stripe_checkout_session_create_succeeded`.

### Common failure signatures

| Symptom | Likely cause |
|---------|----------------|
| **`STRIPE_SUBSCRIPTION_NOT_FOUND`** / `billing_stale_subscription_cleared` | DB `stripeSubscriptionId` not in Stripe (test id + live key, deleted sub). Route clears and retries checkout. |
| **`STRIPE_PRICE_NOT_FOUND`** / `prodFailureHint` mentions live/test | Price ids from wrong Stripe mode vs `STRIPE_SECRET_KEY`. |
| **`STRIPE_CUSTOMER_NOT_FOUND`** | Stale `stripeCustomerId` — customer missing in Stripe for this key. |
| **`MISSING_STRIPE_PRICE_ENV`** / **`MALFORMED_STRIPE_PRICE_ENV`** | Env missing or not `price_…`. |
| **`MISSING_FRONTEND_URL`** | API missing `FRONTEND_URL` / `CLIENT_URL`. |
| **401 `UNAUTHORIZED`** | Cookie/session not sent or invalid (see auth cookie / same-site). |
| **502 / HTML** from `/api/...` | **`NEXT_PUBLIC_API_URL`** wrong, API down, or rewrite target not serving JSON. |
| **Page logs only, no API logs** | You’re viewing **Next** logs; open logs for the **API** project or the process behind `NEXT_PUBLIC_API_URL`. |

## Manual production check

1. Open production site → **Pricing** → sign in.
2. Click a paid plan.
3. Expect redirect to **Stripe Checkout** (`checkout.stripe.com` or similar).
4. On failure, capture **response JSON** + **`X-Request-Id`** and grep API logs.

## Security

- Never log full **`STRIPE_SECRET_KEY`**, full price ids in production analytics, or full payment payloads.
- Logs use **prefixes** (`priceIdPrefix`, `dbSubscriptionIdPrefix`) and **`stripeKeyMode`** (`live` / `test` / `unknown`) inferred from the key prefix only.
