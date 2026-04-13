/*
  Warnings:

  - You are about to drop the column `aiConfidence` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `analytics` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `bitrateKbps` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `captionStyle` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `cdnUrl` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `conversionScore` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `ctaType` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `deletedAt` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `engagementScore` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `engineVersion` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `errorStack` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `failedCategory` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `gpuId` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `hashtags` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `hookStrengthScore` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `language` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `outputPath` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `platformPostId` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `platformUrl` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `predictedCpa` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `predictedCtr` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `predictedWatchPct` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `publishedAt` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `queueWaitMs` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `rawPayload` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `region` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `renderNodeId` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `renderRegion` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `retentionScore` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `revenueGeneratedUsd` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `scheduledFor` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `storagePath` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `variantGroupId` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `variantLabel` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `viralScore` on the `AdJob` table. All the data in the column will be lost.
  - You are about to drop the column `ipAddress` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the column `userAgent` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the column `aiConfidence` on the `Generation` table. All the data in the column will be lost.
  - You are about to drop the column `platformTarget` on the `Generation` table. All the data in the column will be lost.
  - You are about to drop the column `qualityScore` on the `Generation` table. All the data in the column will be lost.
  - You are about to drop the column `retentionScore` on the `Generation` table. All the data in the column will be lost.
  - You are about to drop the column `userAgent` on the `RateLimitLog` table. All the data in the column will be lost.
  - You are about to drop the column `payloadHash` on the `StripeEvent` table. All the data in the column will be lost.
  - You are about to drop the column `processedAt` on the `StripeEvent` table. All the data in the column will be lost.
  - You are about to drop the column `country` on the `Usage` table. All the data in the column will be lost.
  - You are about to drop the column `ipAddress` on the `Usage` table. All the data in the column will be lost.
  - You are about to drop the column `requestId` on the `Usage` table. All the data in the column will be lost.
  - You are about to drop the column `sessionId` on the `Usage` table. All the data in the column will be lost.
  - You are about to drop the column `userAgent` on the `Usage` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "AdJob_archived_idx";

-- DropIndex
DROP INDEX "AdJob_platform_idx";

-- DropIndex
DROP INDEX "AdJob_published_idx";

-- DropIndex
DROP INDEX "AdJob_renderRegion_idx";

-- DropIndex
DROP INDEX "AdJob_scheduledFor_idx";

-- DropIndex
DROP INDEX "AdJob_variantGroupId_idx";

-- DropIndex
DROP INDEX "AuditLog_action_idx";

-- DropIndex
DROP INDEX "AuditLog_createdAt_idx";

-- DropIndex
DROP INDEX "AuditLog_requestId_idx";

-- DropIndex
DROP INDEX "AuditLog_userId_idx";

-- DropIndex
DROP INDEX "CreditTransaction_createdAt_idx";

-- DropIndex
DROP INDEX "CreditTransaction_requestId_idx";

-- DropIndex
DROP INDEX "CreditTransaction_type_idx";

-- DropIndex
DROP INDEX "Generation_createdAt_idx";

-- DropIndex
DROP INDEX "Generation_platformTarget_idx";

-- DropIndex
DROP INDEX "Generation_requestId_idx";

-- DropIndex
DROP INDEX "Generation_type_idx";

-- DropIndex
DROP INDEX "RateLimitLog_blocked_idx";

-- DropIndex
DROP INDEX "RateLimitLog_createdAt_idx";

-- DropIndex
DROP INDEX "RateLimitLog_userId_idx";

-- DropIndex
DROP INDEX "StripeEvent_processed_idx";

-- DropIndex
DROP INDEX "StripeEvent_stripeEventId_idx";

-- DropIndex
DROP INDEX "StripeEvent_type_idx";

-- DropIndex
DROP INDEX "Usage_country_idx";

-- DropIndex
DROP INDEX "Usage_createdAt_idx";

-- DropIndex
DROP INDEX "Usage_tool_idx";

-- DropIndex
DROP INDEX "User_banned_idx";

-- DropIndex
DROP INDEX "User_createdAt_idx";

-- DropIndex
DROP INDEX "User_deletedAt_idx";

-- DropIndex
DROP INDEX "User_monthlyResetAt_idx";

-- DropIndex
DROP INDEX "User_plan_idx";

-- DropIndex
DROP INDEX "User_stripeCustomerId_idx";

-- DropIndex
DROP INDEX "User_stripeSubscriptionId_idx";

-- DropIndex
DROP INDEX "User_subscriptionStatus_idx";

-- AlterTable
ALTER TABLE "AdJob" DROP COLUMN "aiConfidence",
DROP COLUMN "analytics",
DROP COLUMN "bitrateKbps",
DROP COLUMN "captionStyle",
DROP COLUMN "cdnUrl",
DROP COLUMN "conversionScore",
DROP COLUMN "ctaType",
DROP COLUMN "deletedAt",
DROP COLUMN "engagementScore",
DROP COLUMN "engineVersion",
DROP COLUMN "errorStack",
DROP COLUMN "failedCategory",
DROP COLUMN "gpuId",
DROP COLUMN "hashtags",
DROP COLUMN "hookStrengthScore",
DROP COLUMN "language",
DROP COLUMN "outputPath",
DROP COLUMN "platformPostId",
DROP COLUMN "platformUrl",
DROP COLUMN "predictedCpa",
DROP COLUMN "predictedCtr",
DROP COLUMN "predictedWatchPct",
DROP COLUMN "publishedAt",
DROP COLUMN "queueWaitMs",
DROP COLUMN "rawPayload",
DROP COLUMN "region",
DROP COLUMN "renderNodeId",
DROP COLUMN "renderRegion",
DROP COLUMN "retentionScore",
DROP COLUMN "revenueGeneratedUsd",
DROP COLUMN "scheduledFor",
DROP COLUMN "storagePath",
DROP COLUMN "variantGroupId",
DROP COLUMN "variantLabel",
DROP COLUMN "viralScore",
ADD COLUMN     "renderCompletedAt" TIMESTAMP(3),
ADD COLUMN     "renderStartedAt" TIMESTAMP(3),
ADD COLUMN     "scenePlan" JSONB,
ADD COLUMN     "script" JSONB,
ADD COLUMN     "voicePath" TEXT,
ADD COLUMN     "workerId" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "ipAddress",
DROP COLUMN "userAgent";

-- AlterTable
ALTER TABLE "Generation" DROP COLUMN "aiConfidence",
DROP COLUMN "platformTarget",
DROP COLUMN "qualityScore",
DROP COLUMN "retentionScore";

-- AlterTable
ALTER TABLE "RateLimitLog" DROP COLUMN "userAgent";

-- AlterTable
ALTER TABLE "StripeEvent" DROP COLUMN "payloadHash",
DROP COLUMN "processedAt";

-- AlterTable
ALTER TABLE "Usage" DROP COLUMN "country",
DROP COLUMN "ipAddress",
DROP COLUMN "requestId",
DROP COLUMN "sessionId",
DROP COLUMN "userAgent";

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileSize" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdVariant" (
    "id" TEXT NOT NULL,
    "adJobId" TEXT NOT NULL,
    "variantIndex" INTEGER NOT NULL,
    "score" INTEGER,
    "script" JSONB,
    "voicePath" TEXT,
    "videoPath" TEXT,
    "thumbnailUrl" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaAsset_userId_idx" ON "MediaAsset"("userId");

-- CreateIndex
CREATE INDEX "AdVariant_adJobId_idx" ON "AdVariant"("adJobId");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdVariant" ADD CONSTRAINT "AdVariant_adJobId_fkey" FOREIGN KEY ("adJobId") REFERENCES "AdJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
