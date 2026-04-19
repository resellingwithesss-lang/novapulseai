-- ============================================================================
-- LIFECYCLE ENGINE (Phase 4: automated trigger streams)
-- ----------------------------------------------------------------------------
-- Creates the LifecycleTrigger enum + LifecycleSend ledger. LifecycleSend is
-- the atomic dedup primitive: the engine writes this row inside the same
-- transaction that enqueues the EmailDelivery, so concurrent engine ticks
-- cannot double-fire the same (user, trigger, cooldown-window).
-- Additive only; no existing tables altered.
-- ============================================================================

-- CreateEnum
CREATE TYPE "LifecycleTrigger" AS ENUM (
  'CREDIT_EXHAUSTION_UPGRADE',
  'TRIAL_ENDING_REMINDER',
  'INACTIVE_USER_REACTIVATION',
  'ELITE_FEATURE_PROMOTION',
  'REFERRAL_PUSH'
);

-- CreateTable
CREATE TABLE "LifecycleSend" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "trigger" "LifecycleTrigger" NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "emailDeliveryId" TEXT,
  "metadata" JSONB,

  CONSTRAINT "LifecycleSend_pkey" PRIMARY KEY ("id")
);

-- Hot-path dedup query: "has this (userId, trigger) been sent since cutoff?"
CREATE INDEX "LifecycleSend_userId_trigger_sentAt_idx"
  ON "LifecycleSend"("userId", "trigger", "sentAt");

-- Observability: "per-trigger volume over time window"
CREATE INDEX "LifecycleSend_trigger_sentAt_idx"
  ON "LifecycleSend"("trigger", "sentAt");

-- Observability: "recent sends across all triggers"
CREATE INDEX "LifecycleSend_sentAt_idx" ON "LifecycleSend"("sentAt");

-- AddForeignKey
ALTER TABLE "LifecycleSend"
  ADD CONSTRAINT "LifecycleSend_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
