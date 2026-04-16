import { stripe } from "../../lib/stripe"

export async function createStripeBillingPortalUrl(params: {
  customerId: string
  returnUrl: string
}): Promise<string | null> {
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: params.customerId,
      return_url: params.returnUrl,
    })
    return session.url
  } catch {
    return null
  }
}
