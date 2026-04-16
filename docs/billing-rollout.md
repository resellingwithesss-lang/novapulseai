# NovaPulseAI — Stripe billing rollout & QA

Operational runbook for **subscription checkout**, **webhooks**, **customer portal**, **PRO monthly trial** (server-driven), and **credits**. Code lives under `server/src/modules/billing/` and `client/src/lib/plans.ts`.

See also: [PRODUCTION.md](./PRODUCTION.md) (platform-wide deploy).

---

## 1. Required environment variables

### API (`server/` — Railway, Docker, etc.)

| Variable | Required | Purpose |
|----------|----------|---------|
| `STRIPE_SECRET_KEY` | Yes (prod) | Stripe API |
| `STRIPE_WEBHOOK_SECRET` | Yes (prod) | Webhook signature verification |
| `STRIPE_PRICE_STARTER_MONTHLY` / `YEARLY` | Strongly yes | Server-resolved price IDs for checkout |
| `STRIPE_PRICE_PRO_MONTHLY` / `YEARLY` | Strongly yes | Same |
| `STRIPE_PRICE_ELITE_MONTHLY` / `YEARLY` | Strongly yes | Same |
| `STRIPE_PRO_TRIAL_DAYS` | Optional | PRO **monthly** checkout trial length in days. **Unset = 14**. **0 = no trial** on checkout. Max **90**. |
| `BILLING_ENVIRONMENT` | Optional | Stripe `metadata.environment` (defaults to `NODE_ENV`) |
| `FRONTEND_URL` or `CLIENT_URL` or `PUBLIC_APP_URL` | Yes (prod) | Checkout success/cancel URLs + portal `return_url` |

Placeholders containing `replace_with` or `STRIPE_*_ID` are **rejected** for checkout (`resolveApprovedStripePriceId` returns null).

### Next.js (`client/` — Vercel build)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | API origin (no path) |
| `NEXT_PUBLIC_APP_URL` | Canonical app URL |
| `NEXT_PUBLIC_STRIPE_PRICE_*` | Client-only hints (e.g. pricing page); **checkout still uses server env** |
| `NEXT_PUBLIC_STRIPE_PRO_TRIAL_DAYS` | Optional; should match **`STRIPE_PRO_TRIAL_DAYS`** for marketing copy (default **14**) |

---

## 2. Database migration

New column: **`User.billingProTrialConsumedAt`** — set from webhooks when a **PRO** subscription is live in Stripe; blocks repeat **PRO monthly** checkout trials.

```bash
cd server
npx prisma migrate deploy
```

On first deploy after pull: confirm migration **`20260213120000_add_billing_pro_trial_consumed`** applied.

---

## 3. Stripe Dashboard — webhook endpoint

**URL:** `https://<your-api-host>/api/billing/webhook`

**Signing secret:** paste into **`STRIPE_WEBHOOK_SECRET`** on the API (use the secret for *this* endpoint, test vs live).

**Events to send (minimum):**

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

**Important:** Do **not** rely on Stripe Product “trial period” in the Dashboard for PRO — trials are applied in **Checkout session** creation via **`subscription_data.trial_period_days`** only when the server marks the user eligible.

**Raw body:** The API mounts this route with **`express.raw({ type: "application/json" })`** before JSON parsers (`server/src/app.ts`). Do not put another body parser in front of it.

---

## 4. Replay safety & credits

- **`StripeEvent`** table: each `stripeEventId` is upserted **`processed: true`** after successful handling.
- **Advisory lock** per event id reduces double-processing under concurrency.
- **`invoice.paid`**: before inserting a “Monthly billing reset” **`CreditTransaction`**, the handler checks for an existing row with **`metadata.stripeEventId === event.id`** for that user (idempotent replays).

---

## 5. Access model (trialing = paid access)

Server entitlements (`server/src/modules/billing/billing.access.ts`) treat **`TRIALING`** like **`ACTIVE`** for paid tiers. **`PAST_DUE`** does not grant normal paid access.

---

## 6. Manual QA — Stripe **test** mode

1. Set API to **test** `STRIPE_SECRET_KEY` and **test** webhook secret; use **test** price IDs in `STRIPE_PRICE_*`.
2. `POST /api/billing/checkout` as a **FREE** user with body `{ "plan": "PRO", "billing": "monthly" }` — expect **302/URL** to Checkout; in Stripe Dashboard → Checkout session, confirm **`trial_period_days`** matches **`STRIPE_PRO_TRIAL_DAYS`** (or absent if `0`).
3. Complete Checkout → webhooks run → DB: **`subscriptionStatus`** may be **`TRIALING`**, **`billingProTrialConsumedAt`** set, **`trialExpiresAt`** set from Stripe.
4. Repeat checkout for same user: **no** second trial on PRO monthly (server omits `trial_period_days`).
5. `{ "plan": "PRO", "billing": "yearly" }` — **no** trial.
6. `{ "plan": "STARTER", "billing": "monthly" }` — **no** PRO trial.
7. Replay **`invoice.paid`** (Stripe CLI or Dashboard resend): **one** credit ledger row per `stripeEventId`.
8. **Portal:** user with **`stripeCustomerId`** → `POST /api/billing/portal` returns URL; user without customer → **400** + `code: NO_STRIPE_CUSTOMER`.
9. **Strict body:** `POST /checkout` with extra keys e.g. `{ "plan": "PRO", "billing": "monthly", "priceId": "price_hack" }` → **400** (ignored / rejected — server never trusts client price id).

---

## 7. Live mode smoke test

1. Switch API env to **live** keys and **live** `STRIPE_PRICE_*` ids.  
2. Create **live** webhook endpoint + secret; update **`STRIPE_WEBHOOK_SECRET`**.  
3. `prisma migrate deploy` on production DB.  
4. One real card (or Stripe test card in test mode only on test) through Checkout; confirm DB + **Billing** UI + **`GET /api/billing/subscription`**.  
5. Cancel in portal; confirm **`customer.subscription.deleted`** downgrades non-staff user to **FREE** per webhook rules.

---

## 8. Automated tests (local)

```bash
cd server
npm run test:monetization
```

---

## 9. Residual risks / caveats

- **Client vs server trial day env:** Keep **`NEXT_PUBLIC_STRIPE_PRO_TRIAL_DAYS`** aligned with **`STRIPE_PRO_TRIAL_DAYS`** or pricing copy can disagree with checkout behavior.
- **Historical users:** `billingProTrialConsumedAt` is **null** until first qualifying webhook after deploy; a user who already consumed a PRO trial in the past may get **one** more trial until webhooks backfill — mitigate with a one-off SQL backfill if needed (`UPDATE "User" SET "billingProTrialConsumedAt" = now() WHERE ...`).
- **Webhook ordering:** `checkout.session.completed` and `customer.subscription.*` can race; handlers are **idempotent** where it matters (trial slot, `stripeSubscriptionId`, credit ledger).
