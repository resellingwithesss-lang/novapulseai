import Stripe from "stripe"

/** Stripe Price IDs are opaque; we only assert shape to catch env typos early. */
export function isPlausibleStripePriceId(id: string): boolean {
  const t = id.trim()
  return t.length >= 8 && t.length <= 128 && /^price_[a-zA-Z0-9]+$/.test(t)
}

export type BillingErrorClassification = {
  httpStatus: number
  clientMessage: string
  code: string
  /** Safe for structured logs — no secrets, no full payment method payloads */
  logFields: Record<string, string | number | boolean | undefined>
}

function isStripeError(err: unknown): err is Stripe.errors.StripeError {
  return err instanceof Stripe.errors.StripeError
}

/**
 * Maps Stripe / Prisma failures to HTTP + user-safe copy + log fields.
 * Never put API keys or card numbers in `clientMessage` or `logFields`.
 */
export function classifyBillingRouteError(
  err: unknown,
  context: { requestId: string; operation: string }
): BillingErrorClassification {
  if (isStripeError(err)) {
    const code = err.code ?? err.type ?? "stripe_error"
    const status = err.statusCode ?? 500
    const logFields: Record<string, string | number | boolean | undefined> = {
      requestId: context.requestId,
      operation: context.operation,
      stripeType: err.type,
      stripeCode: err.code,
      stripeStatusCode: status,
      stripeParam: err.param,
    }

    const m = err.message.toLowerCase()
    if (err.code === "resource_missing" && (m.includes("subscription") || err.param === "subscription")) {
      return {
        httpStatus: 409,
        clientMessage:
          "Your saved subscription was not found in Stripe (often a test vs live key mismatch). We reset your billing state — try checkout again, or open Billing.",
        code: "STRIPE_SUBSCRIPTION_NOT_FOUND",
        logFields,
      }
    }

    if (m.includes("no such price") || (err.code === "resource_missing" && m.includes("price"))) {
      return {
        httpStatus: 400,
        clientMessage:
          "This price is not available in your Stripe account for the API key in use. Use live Dashboard prices with sk_live_ (and test with sk_test_).",
        code: "STRIPE_PRICE_NOT_FOUND",
        logFields,
      }
    }

    if (m.includes("no such customer") || (err.code === "resource_missing" && m.includes("customer"))) {
      return {
        httpStatus: 400,
        clientMessage:
          "Your saved Stripe customer was not found. Billing will create a new customer on checkout if needed.",
        code: "STRIPE_CUSTOMER_NOT_FOUND",
        logFields,
      }
    }

    if (err.code === "resource_missing") {
      return {
        httpStatus: 400,
        clientMessage:
          "Stripe could not find a billing resource. Confirm API key mode matches your Dashboard (test vs live).",
        code: "STRIPE_RESOURCE_MISSING",
        logFields,
      }
    }

    if (err.code === "api_key_expired" || err.code === "invalid_api_key") {
      return {
        httpStatus: 503,
        clientMessage: "Billing is temporarily unavailable. Please try again later.",
        code: "STRIPE_AUTH_CONFIG",
        logFields,
      }
    }

    if (err.type === "StripeCardError") {
      return {
        httpStatus: 402,
        clientMessage: err.message || "Your card was declined. Update the payment method in Billing.",
        code: "STRIPE_CARD_ERROR",
        logFields: { ...logFields, declineCode: err.decline_code },
      }
    }

    const clientMessage =
      status >= 400 && status < 500
        ? "Stripe could not complete this billing change. Open Billing or try again."
        : "Billing service error. Please try again in a few minutes."

    return {
      httpStatus: status >= 400 && status < 600 ? status : 502,
      clientMessage,
      code: "STRIPE_ERROR",
      logFields: { ...logFields, messageSnippet: err.message.slice(0, 240) },
    }
  }

  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes("STRIPE_SECRET_KEY")) {
    return {
      httpStatus: 503,
      clientMessage: "Billing is not configured on the server.",
      code: "STRIPE_NOT_CONFIGURED",
      logFields: { requestId: context.requestId, operation: context.operation },
    }
  }

  if (err && typeof err === "object" && "code" in err) {
    const c = String((err as { code?: unknown }).code)
    if (c.startsWith("P")) {
      return {
        httpStatus: 503,
        clientMessage:
          "Database schema may be out of date. Run migrations on the API server, then retry.",
        code: "DATABASE_SCHEMA",
        logFields: {
          requestId: context.requestId,
          operation: context.operation,
          prismaCode: c,
          messageSnippet: msg.slice(0, 240),
        },
      }
    }
  }

  return {
    httpStatus: 500,
    clientMessage: "Billing request failed. Please try again or open Billing from your dashboard.",
    code: "BILLING_UNEXPECTED",
    logFields: {
      requestId: context.requestId,
      operation: context.operation,
      messageSnippet: msg.slice(0, 240),
    },
  }
}

export function isStripeSubscriptionMissingError(err: unknown): boolean {
  if (!isStripeError(err)) return false
  if (err.code !== "resource_missing") return false
  const m = err.message.toLowerCase()
  return m.includes("subscription") || err.param === "subscription"
}
