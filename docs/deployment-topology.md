# Deployment topology (NovaPulseAI)

## Answers (billing / API)

| Question | Answer |
|----------|--------|
| Is `POST /api/billing/change-plan` a Next route? | **No.** There is **no** `client/src/app/api/...` route for billing. |
| Where is it implemented? | **Express:** `server/src/modules/billing/billing.routes.ts`, mounted under `server/src/app.ts` as `app.use("/api/billing", billingRoutes)`. |
| Exact URL the **browser** calls | **`https://<NEXT_PUBLIC_APP_HOST>/api/billing/change-plan`** (same origin as the Next app; path only in `fetch`). |
| Where does **`NEXT_PUBLIC_API_URL`** apply? | **Next.js server-side rewrites** (`client/next.config.js`): incoming `/api/*` is proxied to **`{NEXT_PUBLIC_API_URL}/api/*`**. It is **not** the hostname inside the browser `fetch()` URL for client-side calls (see `client/src/lib/api.ts` `buildUrl`). |
| Frontend + backend together? | **Typically no on Vercel:** one project builds **Next**; the **Express API** is a **separate** deploy (another Vercel Node service, Railway, Fly, etc.). The monorepo shares code; **runtime** is two hosts unless you intentionally colocate. |
| Which Vercel project “has” the billing route? | The **API** deployment (Express). The **Next** Vercel project **proxies** `/api/*` to that API; it does **not** contain the Express handler source at runtime. |

## Text diagram (production)

```
Browser
  │  fetch("https://app.example.com/api/billing/change-plan", { credentials: "include", ... })
  ▼
Frontend host (Next on Vercel — NEXT_PUBLIC_APP_URL)
  │  rewrite: /api/:path*  →  NEXT_PUBLIC_API_URL + "/api/" + :path*
  ▼
API host (Express — value of NEXT_PUBLIC_API_URL)
  │  POST /api/billing/change-plan  →  billing.routes.ts
  ▼
Stripe API (HTTPS, from API server using STRIPE_SECRET_KEY)
```

## Required env alignment

1. **`NEXT_PUBLIC_APP_URL`** — public URL of the **Next** app (used at build; should match what users open).
2. **`NEXT_PUBLIC_API_URL`** — absolute base URL of the **Express** app (scheme + host + optional port). **Must not** share the same **origin** as `NEXT_PUBLIC_APP_URL` unless you truly serve Express on the same origin without this rewrite loop (default Vercel Next does not).

See `client/next.config.js` for build-time checks.

## Wrong topology symptoms

- **502 / HTML** on `/api/billing/change-plan` — rewrite target wrong or API down.
- **Cookie auth fails** on API — cookie is set for the **Next** origin; the API receives the **forwarded** `Cookie` header from Next’s proxy. If the API URL is a **different** site without proxy, you would need CORS + credentials and a different client strategy (not what this repo’s browser `api.ts` does).

This repo’s **browser** billing calls assume **same-origin `/api/...`** so the session cookie reaches **Next**, which forwards to **Express**.
