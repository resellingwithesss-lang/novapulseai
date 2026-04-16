import { Response, NextFunction } from "express"
import { Role } from "@prisma/client"
import { AuthRequest } from "./auth.middleware"

/**
 * Requires ADMIN or SUPER_ADMIN role.
 * Assumes requireAuth already validated DB user.
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

  if (req.user.role !== "ADMIN" && req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({
      success: false,
      message: "Admin access only",
    })
  }

  return next()
}

/**
 * Requires SUPER_ADMIN. Used for preview-as-user and other high-risk operations.
 */
export function requireSuperAdmin(
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

  if (req.user.role !== Role.SUPER_ADMIN) {
    return res.status(403).json({
      success: false,
      message: "Super admin only",
    })
  }

  return next()
}