import Stripe from "stripe"
import { stripe } from "../../lib/stripe"

export type SubscriptionPeriodBounds = { start: number; end: number }

/**
 * Stripe typings omit some period fields; read from subscription or first item.
 */
export function getSubscriptionPeriodBounds(sub: Stripe.Subscription): SubscriptionPeriodBounds | null {
  const s = sub as Stripe.Subscription & {
    current_period_start?: number
    current_period_end?: number
  }
  if (
    typeof s.current_period_start === "number" &&
    typeof s.current_period_end === "number" &&
    s.current_period_end > s.current_period_start
  ) {
    return { start: s.current_period_start, end: s.current_period_end }
  }
  const item = sub.items?.data?.[0] as
    | (Stripe.SubscriptionItem & {
        current_period_start?: number
        current_period_end?: number
      })
    | undefined
  if (
    item &&
    typeof item.current_period_start === "number" &&
    typeof item.current_period_end === "number" &&
    item.current_period_end > item.current_period_start
  ) {
    return { start: item.current_period_start, end: item.current_period_end }
  }
  return null
}

function resolveScheduleId(sub: Stripe.Subscription): string | null {
  const sch = sub.schedule
  if (typeof sch === "string" && sch.startsWith("sub_sched_")) return sch
  if (sch && typeof sch === "object" && "id" in sch && typeof (sch as { id: string }).id === "string") {
    return (sch as { id: string }).id
  }
  return null
}

/**
 * Defer a paid→paid downgrade to the end of the current billing period using a Stripe Subscription Schedule.
 * Preserves current price until `period.end`, then switches to `targetPriceId`.
 */
export async function scheduleStripeDowngradeAtPeriodEnd(params: {
  subscription: Stripe.Subscription
  currentPriceId: string
  targetPriceId: string
  period: SubscriptionPeriodBounds
  userId: string
  environmentLabel: string
}): Promise<{ scheduleId: string }> {
  const { subscription, currentPriceId, targetPriceId, period, userId, environmentLabel } = params

  if (period.end <= Math.floor(Date.now() / 1000)) {
    throw new Error("subscription_period_already_ended")
  }

  let scheduleId = resolveScheduleId(subscription)

  if (!scheduleId) {
    const created = await stripe.subscriptionSchedules.create({
      from_subscription: subscription.id,
    })
    scheduleId = created.id
  }

  await stripe.subscriptionSchedules.update(scheduleId, {
    end_behavior: "release",
    phases: [
      {
        start_date: period.start,
        end_date: period.end,
        items: [{ price: currentPriceId, quantity: 1 }],
      },
      {
        start_date: period.end,
        items: [{ price: targetPriceId, quantity: 1 }],
      },
    ],
    metadata: {
      userId,
      environment: environmentLabel,
      appScheduledDowngrade: "true",
    },
  })

  return { scheduleId }
}

export async function releaseStripeSubscriptionScheduleIfPresent(
  scheduleId: string | null | undefined
): Promise<void> {
  if (!scheduleId?.trim()) return
  try {
    await stripe.subscriptionSchedules.release(scheduleId.trim())
  } catch (err: unknown) {
    if (err instanceof Stripe.errors.StripeInvalidRequestError) {
      const m = err.message.toLowerCase()
      if (m.includes("released") || m.includes("canceled") || m.includes("completed")) return
    }
    throw err
  }
}
