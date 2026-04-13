-- Align DB enum with Prisma schema (ELITE tier); safe if already present.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'Plan' AND e.enumlabel = 'ELITE'
  ) THEN
    ALTER TYPE "Plan" ADD VALUE 'ELITE';
  END IF;
END $$;
