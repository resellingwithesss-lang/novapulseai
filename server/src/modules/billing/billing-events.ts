/**
 * Structured billing logs — safe for production (no secrets, no raw price payloads).
 * Extend with your analytics sink (Segment, BigQuery, etc.) in one place.
 */
export type BillingAnalyticsEvent =
  | "checkout_session_create_requested"
  | "checkout_session_create_succeeded"
  | "checkout_session_create_failed"
  | "checkout_session_completed_webhook"
  | "subscription_sync_webhook"
  | "invoice_paid_webhook"
  | "invoice_payment_failed_webhook"
  | "portal_session_create_requested"
  | "portal_session_create_succeeded"
  | "portal_session_create_failed"
  | "billing_validation_failed"
  | "billing_checkout_attempt"
  | "billing_user_loaded"
  | "billing_config_error"
  | "billing_stale_subscription_cleared"
  | "stripe_error"
  | "stripe_customer_create_started"
  | "stripe_customer_create_succeeded"
  | "stripe_subscription_update_started"
  | "stripe_subscription_update_succeeded"
  | "stripe_subscription_reuse_update_started"
  | "stripe_subscription_reuse_update_succeeded"
  | "stripe_checkout_session_create_started"
  | "stripe_checkout_session_create_succeeded"
  | "billing_route_context"
  | "billing_price_env_drift"
  | "billing_downgrade_blocked"
  | "billing_no_change_same_price"
  | "billing_subscription_branch_entered"
  | "plan_change_classified"
  | "plan_change_stripe_schedule_created"
  | "plan_change_stripe_schedule_failed"
  | "plan_change_stripe_schedule_released"
  | "plan_change_immediate_update"
  | "plan_change_pending_cleared_webhook"

export function logBillingEvent(
  event: BillingAnalyticsEvent,
  fields: Record<string, string | number | boolean | null | undefined>
): void {
  const payload = {
    kind: "billing_event",
    event,
    ts: new Date().toISOString(),
    ...fields,
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload))
}
