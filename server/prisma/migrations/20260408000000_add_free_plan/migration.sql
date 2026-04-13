-- PG forbids using a new enum value in the same transaction as ADD VALUE.
-- Only extend the enum here; see next migration for data + column defaults.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'Plan' AND e.enumlabel = 'FREE'
  ) THEN
    ALTER TYPE "Plan" ADD VALUE 'FREE';
  END IF;
END $$;
