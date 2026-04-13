-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_RESET';
ALTER TYPE "AuditAction" ADD VALUE 'STRIPE_EVENT_PROCESSED';
ALTER TYPE "AuditAction" ADD VALUE 'GENERATION_CREATED';

-- AlterEnum
ALTER TYPE "AuthProvider" ADD VALUE 'GITHUB';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CreditType" ADD VALUE 'BONUS';
ALTER TYPE "CreditType" ADD VALUE 'PROMOTION';

-- AlterEnum
ALTER TYPE "GenerationType" ADD VALUE 'VIDEO_BLUEPRINT';

-- AlterEnum
ALTER TYPE "Plan" ADD VALUE 'LIFETIME';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SubscriptionStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'PAUSED';

-- AlterEnum
ALTER TYPE "UsageTool" ADD VALUE 'VIDEO_BLUEPRINT';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "CreditTransaction" ADD COLUMN     "balanceAfter" INTEGER,
ADD COLUMN     "ipAddress" TEXT;

-- AlterTable
ALTER TABLE "Generation" ADD COLUMN     "aiConfidence" DOUBLE PRECISION,
ADD COLUMN     "platformTarget" TEXT,
ADD COLUMN     "qualityScore" INTEGER,
ADD COLUMN     "retentionScore" INTEGER;

-- AlterTable
ALTER TABLE "RateLimitLog" ADD COLUMN     "blocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "StripeEvent" ADD COLUMN     "payloadHash" TEXT,
ADD COLUMN     "processedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Usage" ADD COLUMN     "country" TEXT,
ADD COLUMN     "sessionId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastIpAddress" TEXT,
ADD COLUMN     "lastUserAgent" TEXT,
ADD COLUMN     "lifetimeValueUsd" DECIMAL(12,4) NOT NULL DEFAULT 0.00,
ADD COLUMN     "totalGenerations" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "AuditLog_requestId_idx" ON "AuditLog"("requestId");

-- CreateIndex
CREATE INDEX "Generation_platformTarget_idx" ON "Generation"("platformTarget");

-- CreateIndex
CREATE INDEX "RateLimitLog_blocked_idx" ON "RateLimitLog"("blocked");

-- CreateIndex
CREATE INDEX "StripeEvent_processed_idx" ON "StripeEvent"("processed");

-- CreateIndex
CREATE INDEX "Usage_country_idx" ON "Usage"("country");

-- CreateIndex
CREATE INDEX "User_banned_idx" ON "User"("banned");
