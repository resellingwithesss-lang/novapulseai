export type CheckoutPlanIntent = {
  plan: "STARTER" | "PRO" | "ELITE"
  billing: "monthly" | "yearly"
}

const STORAGE_KEY = "novapulseai_checkout_plan_intent"

/** One-shot flag: user just registered/signed in and should resume Stripe checkout on /pricing */
export const RESUME_CHECKOUT_FLAG = "novapulseai_resume_checkout"

export function setResumeCheckoutFlag() {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(RESUME_CHECKOUT_FLAG, "1")
  } catch {
    // ignore
  }
}

export function peekResumeCheckoutFlag(): boolean {
  if (typeof window === "undefined") return false
  try {
    return sessionStorage.getItem(RESUME_CHECKOUT_FLAG) === "1"
  } catch {
    return false
  }
}

export function clearResumeCheckoutFlag() {
  if (typeof window === "undefined") return
  try {
    sessionStorage.removeItem(RESUME_CHECKOUT_FLAG)
  } catch {
    // ignore
  }
}

const PAID_PLANS = new Set<CheckoutPlanIntent["plan"]>([
  "STARTER",
  "PRO",
  "ELITE",
])

export function isPaidUiPlan(
  value: string | null | undefined
): value is CheckoutPlanIntent["plan"] {
  if (!value) return false
  return PAID_PLANS.has(value.toUpperCase() as CheckoutPlanIntent["plan"])
}

export function isBillingType(
  value: string | null | undefined
): value is CheckoutPlanIntent["billing"] {
  return value === "monthly" || value === "yearly"
}

export function writeCheckoutPlanIntent(intent: CheckoutPlanIntent) {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intent))
  } catch {
    // ignore quota / private mode
  }
}

export function readCheckoutPlanIntent(): CheckoutPlanIntent | null {
  if (typeof window === "undefined") return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CheckoutPlanIntent>
    if (!isPaidUiPlan(parsed.plan) || !isBillingType(parsed.billing)) {
      return null
    }
    return {
      plan: String(parsed.plan).toUpperCase() as CheckoutPlanIntent["plan"],
      billing: parsed.billing,
    }
  } catch {
    return null
  }
}

export function clearCheckoutPlanIntent() {
  if (typeof window === "undefined") return
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function parsePlanIntentFromSearchParams(
  params: Pick<URLSearchParams, "get">
): CheckoutPlanIntent | null {
  const plan = params.get("plan")
  const billing = params.get("billing")
  if (!isPaidUiPlan(plan) || !isBillingType(billing)) return null
  const upper = plan.toUpperCase() as CheckoutPlanIntent["plan"]
  return { plan: upper, billing }
}
