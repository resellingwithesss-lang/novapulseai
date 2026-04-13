-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'CREDITS_RESET';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CreditType" ADD VALUE 'MONTHLY_RESET';
ALTER TYPE "CreditType" ADD VALUE 'PLAN_UPGRADE';

-- AlterEnum
ALTER TYPE "Plan" ADD VALUE 'STARTER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bonusCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lifetimeCreditsUsed" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "User_monthlyResetAt_idx" ON "User"("monthlyResetAt");
