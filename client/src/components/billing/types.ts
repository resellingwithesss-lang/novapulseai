export type BillingSubscription = {
  plan: string
  subscriptionStatus: string
  subscriptionStartedAt: string | null
  subscriptionEndsAt: string | null
  trialExpiresAt: string | null
  cancelAtPeriodEnd: boolean
  hasStripeCustomer?: boolean
  /** Present when a paid→lower-paid change is deferred to period end (Stripe schedule + DB mirror). */
  scheduledDowngrade?: {
    targetPlan: string
    targetBilling: string | null
    effectiveAt: string
  } | null
}

export type BillingInvoiceRow = {
  id: string
  created: number
  status: string | null
  amount_paid: number
  hosted_invoice_url: string | null
}

export type BillingStatusChipMeta = {
  color: string
  bg: string
  border: string
  label: string
}
