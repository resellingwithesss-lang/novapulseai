import { Plan, Role } from "@prisma/client"
import { normalizePlanTier, planRank } from "../modules/plans/plan.constants"
import { isStaffRole } from "./roles"

/**
 * True when the role should be treated as staff for billing purposes (floored
 * to ELITE regardless of Stripe state). Includes ADMIN, OWNER, and the
 * deprecated SUPER_ADMIN. See `server/src/lib/roles.ts` for the canonical set.
 */
export function isStaffBillingExemptRole(role: Role | string | undefined | null): boolean {
  return isStaffRole(role)
}

/**
 * Floor staff accounts to at least ELITE for API + UI so promoted admins are not shown as FREE
 * when Stripe webhooks briefly disagree or a comp seat has no paid Stripe tier.
 */
export function staffFloorPlan(dbPlan: Plan, role: Role | string | undefined | null): Plan {
  if (!isStaffBillingExemptRole(role)) return dbPlan
  const tier = normalizePlanTier(dbPlan)
  return planRank(tier) >= planRank("ELITE") ? dbPlan : Plan.ELITE
}

/** String plan for billing.access (Prisma enums stringify to same names). */
export function staffEffectivePlanString(
  dbPlan: string | Plan,
  role: Role | string | undefined | null
): string {
  return staffFloorPlan(dbPlan as Plan, role)
}
