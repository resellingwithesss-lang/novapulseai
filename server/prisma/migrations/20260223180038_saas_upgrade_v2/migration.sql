/*
  Warnings:

  - You are about to alter the column `estimatedCost` on the `Generation` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,4)`.
  - You are about to alter the column `estimatedCost` on the `Usage` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,4)`.
  - You are about to alter the column `totalAiCostUsd` on the `User` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,4)`.

*/
-- AlterEnum
ALTER TYPE "CreditType" ADD VALUE 'ADMIN_ADJUSTMENT';

-- AlterTable
ALTER TABLE "CreditTransaction" ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "Generation" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "modelUsed" TEXT,
ADD COLUMN     "userAgent" TEXT,
ALTER COLUMN "estimatedCost" SET DATA TYPE DECIMAL(10,4);

-- AlterTable
ALTER TABLE "RateLimitLog" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Usage" ALTER COLUMN "estimatedCost" SET DATA TYPE DECIMAL(10,4);

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "totalAiCostUsd" SET DATA TYPE DECIMAL(10,4);

-- CreateIndex
CREATE INDEX "CreditTransaction_type_idx" ON "CreditTransaction"("type");

-- CreateIndex
CREATE INDEX "Generation_requestId_idx" ON "Generation"("requestId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_subscriptionStatus_idx" ON "User"("subscriptionStatus");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");
