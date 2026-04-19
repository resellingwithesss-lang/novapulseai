-- ============================================================================
-- MARKETING CONSENT FOUNDATION (Phase 1)
-- ----------------------------------------------------------------------------
-- Adds explicit lifecycle-marketing consent fields on "User" and a
-- MarketingConsentStatus enum. Preserves current send-by-default behavior for
-- pre-existing users via LEGACY_OPT_IN backfill; new signups will default to
-- UNKNOWN + marketingEmails=false and must opt in via a consent surface.
--
-- Invariants preserved:
--   * marketingEmails semantics unchanged for existing rows (still true).
--   * Fan-out unchanged for LEGACY_OPT_IN users until they re-answer.
--   * No transactional email path is touched.
--   * Unsubscribe-by-token continues to flip marketingEmails=false; the
--     application-level route will additionally stamp OPTED_OUT.
-- ============================================================================

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'MARKETING_CONSENT_CHANGED';

-- CreateEnum
CREATE TYPE "MarketingConsentStatus" AS ENUM (
  'UNKNOWN',
  'OPTED_IN',
  'OPTED_OUT',
  'DISMISSED',
  'LEGACY_OPT_IN'
);

-- AlterTable (add columns with safe defaults)
ALTER TABLE "User"
  ADD COLUMN "marketingConsentStatus" "MarketingConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "marketingConsentSource" TEXT,
  ADD COLUMN "marketingConsentCapturedAt" TIMESTAMP(3),
  ADD COLUMN "marketingConsentUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "marketingDismissedAt" TIMESTAMP(3),
  ADD COLUMN "lastMarketingEmailSentAt" TIMESTAMP(3);

-- Change default for new rows only (existing rows keep current value).
ALTER TABLE "User" ALTER COLUMN "marketingEmails" SET DEFAULT false;

-- Backfill: everyone currently sendable becomes LEGACY_OPT_IN so the
-- existing broadcast audience is preserved on day one. Anyone who has
-- already unsubscribed (marketingEmails=false) stays UNKNOWN so the new
-- prompts do not nag them.
UPDATE "User"
  SET "marketingConsentStatus" = 'LEGACY_OPT_IN'
  WHERE "marketingEmails" = true
    AND "marketingConsentStatus" = 'UNKNOWN';

-- Hot-path indices for fan-out and admin filtering.
CREATE INDEX "User_marketingConsentStatus_idx"
  ON "User"("marketingConsentStatus");

CREATE INDEX "User_marketingEmails_marketingConsentStatus_idx"
  ON "User"("marketingEmails", "marketingConsentStatus");
