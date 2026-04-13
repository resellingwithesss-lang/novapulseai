import Stripe from "stripe"

/* =====================================================
STRIPE CLIENT (lazy — server can boot without STRIPE_SECRET_KEY)
===================================================== */

let _stripe: Stripe | null = null

function requireStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add it to server/.env to use billing routes."
    )
  }
  if (!_stripe) {
    _stripe = new Stripe(key, {
      apiVersion: "2026-01-28.clover",
      timeout: 20000,
      maxNetworkRetries: 2,
    })
  }
  return _stripe
}

/** Lazily created on first use so `app.ts` can load without Stripe keys. */
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop: string | symbol) {
    const client = requireStripe()
    const value = Reflect.get(client as object, prop, client) as unknown
    if (typeof value === "function") {
      return (value as (...a: unknown[]) => unknown).bind(client)
    }
    return value
  },
})
