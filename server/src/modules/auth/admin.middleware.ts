import { Response, NextFunction } from "express"
import { AuthRequest } from "./auth.middleware"
import { isAdminOrAboveRole, isOwnerRole } from "../../lib/roles"

/**
 * Requires any admin-or-above role (ADMIN, OWNER, or deprecated SUPER_ADMIN).
 * Assumes requireAuth already validated the DB user.
 */
export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    })
  }

  if (!isAdminOrAboveRole(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Admin access only",
    })
  }

  return next()
}

/**
 * Requires OWNER (or deprecated SUPER_ADMIN, which Phase B migrates to OWNER).
 * Used for preview-as-user and other high-risk operations that were previously
 * gated on SUPER_ADMIN alone.
 */
export function requireOwner(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    })
  }

  if (!isOwnerRole(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Owner access only",
    })
  }

  return next()
}

/**
 * @deprecated Phase C-full will rewrite every import to `requireOwner`.
 * Kept as an alias so existing imports keep compiling during the transition
 * to OWNER. Accepts exactly the same roles as `requireOwner` — i.e. OWNER or
 * the legacy SUPER_ADMIN value.
 */
export const requireSuperAdmin = requireOwner
