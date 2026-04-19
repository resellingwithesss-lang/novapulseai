-- ============================================================================
-- PHASE A: ROLE EXTENSION + PLAN GRANT FOUNDATION
-- ----------------------------------------------------------------------------
-- Purpose: prepare the schema for a clean role model (OWNER/ADMIN/CREATOR/USER)
-- and a first-class sponsored-access primitive (`PlanGrant`) WITHOUT changing
-- any runtime behavior.
--
-- Invariants respected:
--   - Stripe remains the source of truth for billable state. `User.plan` and
--     `User.subscriptionStatus` are NOT touched by this migration.
--   - No existing row is updated. No role is remapped yet (that's Phase B,
--     shipped separately so operators can review the audit trail first).
--   - `SUPER_ADMIN` is kept as a deprecated alias. Code paths continue to
--     function; Phase B will remap SUPER_ADMIN rows to OWNER and Phase E will
--     remove the SUPER_ADMIN value entirely.
--
-- Deploy order:
--   1. npx prisma migrate deploy   (this file)
--   2. npx prisma generate         (so Role.OWNER / Role.CREATOR / PlanGrant /
--                                   PlanGrantReason are available to TS)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Role enum: add OWNER and CREATOR WITHOUT touching USER / ADMIN / SUPER_ADMIN
-- ----------------------------------------------------------------------------
-- Postgres requires each ADD VALUE to be committed before being usable, so
-- each lives in its own statement. IF NOT EXISTS keeps this idempotent if the
-- migration is retried (e.g. rescued after partial failure).
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'CREATOR';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OWNER';

-- ----------------------------------------------------------------------------
-- 2) PlanGrantReason enum
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "PlanGrantReason" AS ENUM (
    'STAFF',
    'PARTNER',
    'COMP',
    'PROMO',
    'BUG_MAKEGOOD',
    'BETA',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 3) PlanGrant table
-- ----------------------------------------------------------------------------
-- `userId`, `grantedByUserId`, `revokedByUserId` all FK to User:
--   - userId: ON DELETE CASCADE (grants are meaningless without the recipient)
--   - grantedByUserId / revokedByUserId: ON DELETE SET NULL (we preserve the
--     grant row for audit even if the OWNER account is later removed)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "PlanGrant" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "plan"            "Plan" NOT NULL,
  "reason"          "PlanGrantReason" NOT NULL,
  "note"            TEXT,
  "grantedByUserId" TEXT,
  "startsAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt"          TIMESTAMP(3),
  "revokedAt"       TIMESTAMP(3),
  "revokedByUserId" TEXT,
  "revokedReason"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlanGrant_pkey" PRIMARY KEY ("id")
);

-- Hot-path entitlement lookup: "any active grant for this user right now?"
CREATE INDEX IF NOT EXISTS "PlanGrant_userId_revokedAt_endsAt_idx"
  ON "PlanGrant"("userId", "revokedAt", "endsAt");

-- Compliance reporting: "all active STAFF grants", "all active PARTNER grants".
CREATE INDEX IF NOT EXISTS "PlanGrant_reason_revokedAt_endsAt_idx"
  ON "PlanGrant"("reason", "revokedAt", "endsAt");

-- Audit trail: "grants issued by a specific owner".
CREATE INDEX IF NOT EXISTS "PlanGrant_grantedByUserId_idx"
  ON "PlanGrant"("grantedByUserId");

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "PlanGrant"
    ADD CONSTRAINT "PlanGrant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PlanGrant"
    ADD CONSTRAINT "PlanGrant_grantedByUserId_fkey"
    FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PlanGrant"
    ADD CONSTRAINT "PlanGrant_revokedByUserId_fkey"
    FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
