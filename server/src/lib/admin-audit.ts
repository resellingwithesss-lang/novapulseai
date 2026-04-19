/**
 * Admin audit log helper.
 *
 * Writes `AuditLog` entries for high-impact administrator actions
 * (plan change, credit adjust, ban/unban, user delete, …). These actions
 * mutate user state or billing posture and must be reconstructable for
 * support and compliance, so the helper NEVER throws — if the audit row
 * fails to write, we log to console and return so the original mutation
 * still succeeds. The trade-off is deliberate: losing an audit line is
 * worse than losing the user-facing effect, but a failing audit write
 * should never roll back a legitimate admin action the operator just
 * confirmed.
 */

import type { AuditAction } from "@prisma/client"
import { prisma } from "./prisma"

export type AdminAuditInput = {
  /** Administrator who performed the action. */
  adminUserId: string
  action: AuditAction
  /** Subject of the action (e.g. the user being banned). May be the admin. */
  targetUserId?: string | null
  requestId?: string | null
  /**
   * Anything useful for reconstructing "what did the admin just change"
   * (before/after values, amounts, reasons, provided justification, etc.).
   * This is stored as JSON and is the only structured breadcrumb operators
   * will have after the fact, so include context, not just identifiers.
   */
  metadata?: Record<string, unknown>
}

export async function recordAdminAudit(input: AdminAuditInput): Promise<void> {
  try {
    const metadata: Record<string, unknown> = {
      ...(input.metadata ?? {}),
      adminUserId: input.adminUserId,
      ...(input.targetUserId ? { targetUserId: input.targetUserId } : {}),
    }
    await prisma.auditLog.create({
      data: {
        userId: input.adminUserId,
        action: input.action,
        metadata: metadata as unknown as object,
        ...(input.requestId ? { requestId: input.requestId } : {}),
      },
    })
  } catch (err) {
    console.error("recordAdminAudit failed", {
      adminUserId: input.adminUserId,
      action: input.action,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
