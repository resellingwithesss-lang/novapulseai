-- ============================================================================
-- MARKETING SUBSCRIBER EXPORT AUDIT (Phase 3)
-- ----------------------------------------------------------------------------
-- Adds a dedicated AuditAction value for bulk subscriber CSV exports so
-- compliance/operator reviews can distinguish "exported list" from regular
-- admin activity. Each export also writes a row capturing filter hash and
-- row count (see admin/marketing/subscribers.routes.ts).
-- ============================================================================

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'MARKETING_SUBSCRIBER_EXPORTED';
