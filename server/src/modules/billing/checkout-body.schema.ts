import { z } from "zod"

export const paidPlanTierSchema = z.enum(["STARTER", "PRO", "ELITE"])

export const billingIntervalSchema = z.enum(["monthly", "yearly"])

export const checkoutOrChangePlanBodySchema = z
  .object({
    plan: paidPlanTierSchema,
    billing: billingIntervalSchema.optional().default("monthly"),
  })
  .strict()

export type CheckoutOrChangePlanBody = z.infer<typeof checkoutOrChangePlanBodySchema>
