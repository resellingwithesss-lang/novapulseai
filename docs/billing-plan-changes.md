# Billing plan changes (upgrades, downgrades, intervals)

## Source of truth

- **Stripe** is authoritative for subscription state, price, period, and schedules.
- The app **mirrors** Stripe into Postgres (`User.plan`, `User.subscriptionStatus`, credits on invoice/plan transitions) via **webhooks** and immediate API responses where safe.

## API entry points

| Action | Route |
|--------|--------|
| Subscribe / change paid plan (same session) | `POST /api/billing/checkout` or `POST /api/billing/change-plan` |
| Cancel at period end (paid → end, then FREE via webhook) | `POST /api/billing/cancel` |
| Resume cancel-at-period-end | `POST /api/billing/resume` |
| Self-serve portal | `POST /api/billing/portal` |

`change-plan` / `checkout` share one handler: `checkoutOrChangePlan` in `server/src/modules/billing/billing.routes.ts`.

## Classification (`plan-change-classification.ts`)

Server classifies each request as:

- **`upgrade`** — higher plan tier (e.g. STARTER → PRO).
- **`downgrade`** — lower plan tier (e.g. ELITE → STARTER).
- **`lateral_interval_change`** — same tier, monthly ↔ yearly.
- **`no_change`** — same Stripe price id as current item.
- **`invalid_change`** — e.g. subscription not ACTIVE/TRIALING, or current price not mapped to env prices.
- **`cancel_to_free`** — reserved for flows that end paid access; use **`POST /billing/cancel`** (cancel at period end), not the paid `plan` body.

## Behavior

### Upgrades & lateral interval (same tier, different billing)

- **Immediate** `stripe.subscriptions.update` with `proration_behavior: "create_prorations"`.
- Any existing **SubscriptionSchedule** for a prior deferred downgrade is **released** first so Stripe does not apply an old phase.

### Downgrades (paid → lower paid tier)

- **Deferred to period end** via Stripe **Subscription Schedules** (`stripe-downgrade-schedule.ts`):
  - Phase 1: current price until `current_period_end`.
  - Phase 2: target (lower) price from period end onward.
- The app stores UX / reconciliation fields on `User`: `scheduledPlanTarget`, `scheduledPlanBilling`, `scheduledPlanEffectiveAt`, `stripeSubscriptionScheduleId`.
- API returns `type: "scheduled_downgrade"` with `effectiveAt` (ISO).
- If schedule creation fails, the API may return `type: "redirect_to_portal"` with a **Stripe Customer Portal** URL when possible.

### When access / plan in DB changes

- Until the schedule’s second phase starts, Stripe still bills the **current** price; webhooks keep `User.plan` aligned with the **current** Stripe price id.
- When the scheduled target price becomes active, `customer.subscription.updated` fires; the app **clears** pending schedule fields when Stripe’s price + interval match the stored pending target (`plan-change` + `webhook.routes.ts`).

### Paid → FREE

- Use **`POST /api/billing/cancel`** (`cancel_at_period_end: true`). When the subscription ends, **`customer.subscription.deleted`** sets the user to **FREE** and resets credits (existing webhook behavior).

## Webhooks

Handled in `server/src/modules/billing/webhook.routes.ts`:

- `invoice.paid` — credit reset to plan allowance.
- `customer.subscription.updated` / `created` — sync plan, status, period, cancel-at-period-end; clear pending downgrade when applied.
- `customer.subscription.deleted` — FREE + credit baseline for non-staff users.
- `invoice.payment_failed` — `PAST_DUE` status.

## Migrations

Apply:

`npx prisma migrate deploy`

Adds optional `User` columns for scheduled downgrades (see `prisma/migrations/20260414120000_subscription_schedule_pending`).

## Stripe Dashboard

- **Customer Portal** should allow customers to manage payment method and cancel; plan swaps can also be done there if needed.
- **Webhooks** must be configured for the events above on the same Stripe account/mode as `STRIPE_SECRET_KEY`.

## Limitations / follow-ups

- **Proration policy** for upgrades/lateral is Stripe’s `create_prorations` — adjust only with product/legal review.
- **Multiple pending changes** in one period are not queued in app logic; releasing an old schedule before a new downgrade replaces the previous intent.
- **Automated tests** cover classification; Stripe schedule calls are not mocked end-to-end in CI without Stripe test fixtures.
