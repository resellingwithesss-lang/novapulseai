-- ============================================================================
-- PHASE B · DATA MIGRATION: SUPER_ADMIN -> OWNER  &  active USER -> CREATOR
-- ----------------------------------------------------------------------------
-- DEPLOY ORDERING (NON-NEGOTIABLE):
--   Phase A       (additive schema, already shipped): adds OWNER, CREATOR,
--                 PlanGrant, PlanGrantReason.
--   Phase A.1     (20260419160000_audit_action_role_changed): adds
--                 AuditAction.ROLE_CHANGED. Also additive.
--   Phase C-lite  (CODE-ONLY, no migration): teaches every role check to
--                 recognise OWNER as equivalent to SUPER_ADMIN, teaches
--                 CREATOR as USER-equivalent for access, teaches staff-floor
--                 + impersonation + admin UI about OWNER, teaches the
--                 frontend to render CREATOR safely. NO PlanGrant reads.
--   Phase B       (THIS FILE): the data migration below. DO NOT apply until
--                 Phase C-lite code is deployed to production, otherwise
--                 rows flipped to OWNER / CREATOR will lose access through
--                 code paths that still hard-match SUPER_ADMIN / USER.
--
-- A pre-flight assertion later in this file attempts to catch that mistake
-- by refusing to run if the Phase A.1 enum value is missing, but the code
-- compatibility gate is an operational concern -- it cannot be enforced from
-- SQL. Keep the two-deploy cadence.
-- ----------------------------------------------------------------------------
-- This is the first Phase of the role/access redesign that mutates existing
-- rows. It is written to be:
--
--   * Atomic      - wrapped in a single implicit transaction (Prisma runs
--                   each .sql file in one tx by default). Either every role
--                   change + every audit row is applied, or nothing is.
--
--   * Idempotent  - re-running produces zero writes. The two UPDATE blocks
--                   scope their WHERE clauses to the *old* role value, so
--                   after the first successful run nothing matches on re-run
--                   and the AuditLog INSERTs (driven by RETURNING) also
--                   produce zero rows.
--
--   * Auditable   - every role change emits an `AuditLog` row with:
--                     action        = 'ROLE_CHANGED'
--                     userId        = NULL (system-triggered; no human actor)
--                     metadata.source        = 'phase_b_data_migration'
--                     metadata.migrationId   = this file's name
--                     metadata.targetUserId  = the user whose role changed
--                     metadata.targetEmail   = for operator readability
--                     metadata.previousRole  = role *before* this migration
--                     metadata.newRole       = role *after* this migration
--                     metadata.rule          = which rule matched
--                     metadata.signals       = (CREATOR case only) booleans
--                                              for each qualifying signal
--
--   * Reversible  - the AuditLog rows written here fully describe the
--                   previous state, so rollback is a single UPDATE ... FROM
--                   "AuditLog" statement (documented at the bottom of this
--                   file under "ROLLBACK PLAN").
--
-- INVARIANTS THIS MIGRATION DOES NOT TOUCH:
--   * Plan / billing / subscription fields
--   * Credit balances or the credit ledger
--   * marketingEmails / marketing consent fields
--   * plan gating middleware (no code paths are updated here; Phase C does
--     the `SUPER_ADMIN` -> `OWNER` code rename behind the deprecation shim)
--   * PlanGrant rows (added in Phase A, still unused by production code)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. PRE-FLIGHT ASSERTIONS
--    Refuse to run unless Phase A's enum additions are present. This stops
--    the migration early on a half-deployed environment instead of failing
--    mid-transaction with a confusing "invalid enum" error.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'Role' AND e.enumlabel = 'OWNER'
  ) THEN
    RAISE EXCEPTION 'Phase B aborted: Role.OWNER enum value missing. Apply Phase A (20260419150000_role_owner_creator_and_plan_grants) first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'Role' AND e.enumlabel = 'CREATOR'
  ) THEN
    RAISE EXCEPTION 'Phase B aborted: Role.CREATOR enum value missing. Apply Phase A first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AuditAction' AND e.enumlabel = 'ROLE_CHANGED'
  ) THEN
    RAISE EXCEPTION 'Phase B aborted: AuditAction.ROLE_CHANGED missing. Apply 20260419160000_audit_action_role_changed first.';
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 1. SUPER_ADMIN -> OWNER
--    Straight rename; no data to compute. Every row that currently holds the
--    deprecated SUPER_ADMIN value becomes OWNER, and we log one audit row per
--    change. CTE + RETURNING keeps the UPDATE and INSERT trivially atomic
--    and idempotent (re-run matches zero rows).
-- ---------------------------------------------------------------------------
WITH updated AS (
  UPDATE "User"
     SET "role"      = 'OWNER',
         "updatedAt" = NOW()
   WHERE "role" = 'SUPER_ADMIN'
  RETURNING "id", "email"
)
INSERT INTO "AuditLog" ("id", "userId", "action", "metadata", "createdAt")
SELECT
  gen_random_uuid()::text,
  NULL,
  'ROLE_CHANGED'::"AuditAction",
  jsonb_build_object(
    'source',       'phase_b_data_migration',
    'migrationId',  '20260419160100_role_phase_b_data_migration',
    'targetUserId', u."id",
    'targetEmail',  u."email",
    'previousRole', 'SUPER_ADMIN',
    'newRole',      'OWNER',
    'rule',         'super_admin_to_owner_rename'
  ),
  NOW()
FROM updated u;


-- ---------------------------------------------------------------------------
-- 2. USER -> CREATOR (activity-based)
--
--    Rule:  role = 'USER' AND (
--             lastLoginAt  >= NOW() - INTERVAL '180 days'
--             OR has at least one Generation row
--             OR has at least one Usage row
--             OR has at least one Workspace row
--           )
--
--    Why `EmailDelivery` is NOT a signal:
--      EmailDelivery rows are written by the system FOR the user, not BY
--      the user. Every signup produces at least a verification / welcome
--      delivery row; marketing broadcasts, lifecycle engine sends, trial-
--      ending reminders, and receipts all accrete here too. Counting them
--      as "creator activity" would promote a user who literally only
--      received a welcome email -- i.e. everyone -- to CREATOR, which
--      collapses the distinction we're trying to create. CREATOR must mean
--      "has engaged with the product", so eligibility is restricted to
--      signals that required a USER action: an explicit recent login, a
--      generation they produced, a metered tool invocation (Usage), or a
--      workspace they created.
--
--    Dormant USER rows (never logged in recently, never generated anything,
--    never used a tool, no workspace) intentionally stay on role = 'USER'.
--    This keeps CREATOR meaningful. They can be promoted later by admins or
--    by future onboarding flows that flip the role on first real action.
--
--    We compute the signals once in a CTE so we can both use them for
--    eligibility AND record them in the audit metadata without re-running
--    the EXISTS subqueries a second time.
-- ---------------------------------------------------------------------------
WITH
  user_signals AS (
    SELECT
      u."id",
      u."email",
      (u."lastLoginAt" IS NOT NULL AND u."lastLoginAt" >= NOW() - INTERVAL '180 days') AS recent_login,
      EXISTS (SELECT 1 FROM "Generation" g WHERE g."userId" = u."id") AS has_generation,
      EXISTS (SELECT 1 FROM "Usage"      s WHERE s."userId" = u."id") AS has_usage,
      EXISTS (SELECT 1 FROM "Workspace"  w WHERE w."userId" = u."id") AS has_workspace
    FROM "User" u
    WHERE u."role" = 'USER'
      AND u."deletedAt" IS NULL
  ),
  eligible AS (
    SELECT *
    FROM user_signals
    WHERE recent_login
       OR has_generation
       OR has_usage
       OR has_workspace
  ),
  updated AS (
    UPDATE "User" u
       SET "role"      = 'CREATOR',
           "updatedAt" = NOW()
      FROM eligible e
     WHERE u."id"   = e."id"
       AND u."role" = 'USER'
    RETURNING u."id"
  )
INSERT INTO "AuditLog" ("id", "userId", "action", "metadata", "createdAt")
SELECT
  gen_random_uuid()::text,
  NULL,
  'ROLE_CHANGED'::"AuditAction",
  jsonb_build_object(
    'source',       'phase_b_data_migration',
    'migrationId',  '20260419160100_role_phase_b_data_migration',
    'targetUserId', e."id",
    'targetEmail',  e."email",
    'previousRole', 'USER',
    'newRole',      'CREATOR',
    'rule',         'user_to_creator_activity_based',
    'signals', jsonb_build_object(
      'recentLogin',   e.recent_login,
      'hasGeneration', e.has_generation,
      'hasUsage',      e.has_usage,
      'hasWorkspace',  e.has_workspace
    )
  ),
  NOW()
FROM updated u
JOIN eligible e ON e."id" = u."id";


-- ============================================================================
-- ROLLBACK PLAN (run ONLY if you need to undo Phase B; not auto-applied)
-- ----------------------------------------------------------------------------
-- The AuditLog rows this migration writes fully describe the previous state,
-- so reversal is a join on metadata -> previousRole. Run both statements in
-- a single transaction:
--
--   BEGIN;
--
--   -- 1) Revert CREATOR -> USER (only rows still on CREATOR and only for
--   --    users whose most recent ROLE_CHANGED from this migration was
--   --    USER -> CREATOR; skips anyone later re-promoted by admins).
--   UPDATE "User" u
--      SET "role"      = 'USER'::"Role",
--          "updatedAt" = NOW()
--     FROM "AuditLog" a
--    WHERE a."action"                           = 'ROLE_CHANGED'
--      AND a."metadata"->>'source'              = 'phase_b_data_migration'
--      AND a."metadata"->>'rule'                = 'user_to_creator_activity_based'
--      AND a."metadata"->>'targetUserId'        = u."id"
--      AND u."role" = 'CREATOR';
--
--   -- 2) Revert OWNER -> SUPER_ADMIN with the same discipline.
--   UPDATE "User" u
--      SET "role"      = 'SUPER_ADMIN'::"Role",
--          "updatedAt" = NOW()
--     FROM "AuditLog" a
--    WHERE a."action"                    = 'ROLE_CHANGED'
--      AND a."metadata"->>'source'       = 'phase_b_data_migration'
--      AND a."metadata"->>'rule'         = 'super_admin_to_owner_rename'
--      AND a."metadata"->>'targetUserId' = u."id"
--      AND u."role" = 'OWNER';
--
--   -- 3) (Optional) record that the rollback happened.
--   INSERT INTO "AuditLog" ("id","userId","action","metadata","createdAt")
--   VALUES (
--     gen_random_uuid()::text, NULL, 'ROLE_CHANGED'::"AuditAction",
--     jsonb_build_object('source','phase_b_rollback','rolledBackMigration',
--                        '20260419160100_role_phase_b_data_migration'),
--     NOW()
--   );
--
--   COMMIT;
--
-- Constraints on reversibility:
--   * The OWNER -> SUPER_ADMIN path only works while the SUPER_ADMIN enum
--     value still exists. Phase E removes it; after that, rollback requires
--     re-adding the enum value first.
--   * If an admin has already re-changed a user's role after this migration
--     ran, we intentionally do NOT revert them (the `u."role" = 'CREATOR'` /
--     `u."role" = 'OWNER'` guards skip those rows).
-- ============================================================================
