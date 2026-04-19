/**
 * Role compatibility layer (Phase C-lite) — client mirror of
 * server/src/lib/roles.ts. Every client-side "is this role privileged?"
 * check should route through these helpers so the OWNER <-> SUPER_ADMIN
 * alias lives in a single file.
 *
 * Runtime semantics are unchanged for existing users:
 *   - OWNER is accepted everywhere SUPER_ADMIN was accepted.
 *   - CREATOR is accepted as a user-tier role but has NO special privileges.
 *     It must only affect display (label, filter option); gating stays
 *     identical to USER.
 */

export type RoleLike =
  | "USER"
  | "CREATOR"
  | "ADMIN"
  | "OWNER"
  | "SUPER_ADMIN"
  | string
  | null
  | undefined

const OWNER_ROLE_VALUES = ["OWNER", "SUPER_ADMIN"] as const
const ADMIN_OR_ABOVE_ROLE_VALUES = ["ADMIN", "OWNER", "SUPER_ADMIN"] as const

export function isOwnerRole(role: RoleLike): boolean {
  return typeof role === "string" && (OWNER_ROLE_VALUES as readonly string[]).includes(role)
}

export function isAdminOrAboveRole(role: RoleLike): boolean {
  return (
    typeof role === "string" &&
    (ADMIN_OR_ABOVE_ROLE_VALUES as readonly string[]).includes(role)
  )
}

/** Same membership as `isAdminOrAboveRole`; named for staff-floor / billing intent. */
export const isStaffRole = isAdminOrAboveRole

/**
 * Human-readable role name for UI labels, filter options, and subscriber
 * tables. The deprecated SUPER_ADMIN value renders as "Owner" so operators
 * see the canonical name even while Phase B hasn't yet migrated all rows.
 */
export function roleDisplayName(role: RoleLike): string {
  switch (role) {
    case "USER":
      return "User"
    case "CREATOR":
      return "Creator"
    case "ADMIN":
      return "Admin"
    case "OWNER":
      return "Owner"
    case "SUPER_ADMIN":
      return "Owner"
    default:
      return "User"
  }
}
