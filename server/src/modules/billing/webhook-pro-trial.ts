import type Stripe from "stripe"
import { prisma } from "../../lib/prisma"
import { resolvePlanFromStripePriceId } from "../plans/plan.constants"

/**
 * Once Stripe shows a real PRO subscription (not `incomplete`), the user must not receive
 * another PRO-monthly checkout trial. Idempotent: only sets when currently null.
 */
export async function markBillingProTrialConsumedIfProSubscriptionLive(params: {
  userId: string
  subscription: Stripe.Subscription
}): Promise<void> {
  const priceId = params.subscription.items?.data?.[0]?.price?.id ?? null
  const tier = resolvePlanFromStripePriceId(priceId)
  if (tier !== "PRO") return

  const status = params.subscription.status
  if (
    status !== "trialing" &&
    status !== "active" &&
    status !== "past_due" &&
    status !== "unpaid"
  ) {
    return
  }

  await prisma.user.updateMany({
    where: {
      id: params.userId,
      billingProTrialConsumedAt: null,
    },
    data: { billingProTrialConsumedAt: new Date() },
  })
}
