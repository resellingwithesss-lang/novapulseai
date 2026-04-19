import { Role } from "@prisma/client"

/**
 * Role compatibility layer (Phase C-lite).
 *
 * Every "is this role privileged?" check in the server should go through
 * one of these helpers so the OWNER <-> SUPER_ADMIN aliasing lives in a
 * single file. `OWNER` is the canonical value from Phase A; `SUPER_ADMIN`
 * is the deprecated alias that Phase B's data migration erases and Phase E
 * removes from the enum.
 *
 * Design rules:
 *   - Accept `string | null | undefined` (not only `Role`) because a lot of
 *     call sites hold the value as a plain string (JWT payloads, snapshots,
 *     admin audit payloads). Prisma's `Role` enum is string-valued so it
 *     satisfies `string` naturally.
 *   - No runtime semantic change vs. the pre-existing scattered checks: the
 *     lists below enumerate exactly the set that was accepted before, just
 *     extended with `OWNER` so future rows that hold that value are treated
 *     identically to `SUPER_ADMIN`.
 *   - This file must not import anything from route or middleware layers so
 *     it can be used from both web request paths and background workers.
 */

type RoleLike = Role | string | null | undefined

/**
 * Highest-authority roles. Every operation currently gated on SUPER_ADMIN
 * (impersonation, ELITE manual assign, ban-protected, delete-protected,
 * preview refusals) accepts either value from this list.
 */
export const OWNER_ROLES: readonly string[] = [Role.OWNER, Role.SUPER_ADMIN]

/**
 * Admin-or-above: everything that was previously gated on
 * `ADMIN || SUPER_ADMIN`. After Phase C-lite this is the single source of
 * truth for the "staff can see this" predicate.
 */
export const ADMIN_OR_ABOVE_ROLES: readonly string[] = [
  Role.ADMIN,
  Role.OWNER,
  Role.SUPER_ADMIN,
]

/**
 * Alias: the staff-floor / billing-exempt set is currently identical to the
 * admin-or-above set. Keeping a distinct name so a future policy change
 * (e.g. if ADMIN should NOT be billing-exempt) only has to edit one array.
 */
export const STAFF_ROLES = ADMIN_OR_ABOVE_ROLES

export function isOwnerRole(role: RoleLike): boolean {
  return typeof role === "string" && OWNER_ROLES.includes(role)
}

export function isAdminOrAboveRole(role: RoleLike): boolean {
  return typeof role === "string" && ADMIN_OR_ABOVE_ROLES.includes(role)
}

/** Same membership as `isAdminOrAboveRole`, named for billing/staff-floor intent. */
export const isStaffRole = isAdminOrAboveRole
