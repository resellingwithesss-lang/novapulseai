-- CreateTable
CREATE TABLE "AdJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "tone" TEXT NOT NULL,
    "variantGroupId" TEXT,
    "variantLabel" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "outputUrl" TEXT,
    "thumbnailUrl" TEXT,
    "fileSizeBytes" INTEGER,
    "resolution" TEXT,
    "aspectRatio" TEXT,
    "bitrateKbps" INTEGER,
    "renderDurationMs" INTEGER,
    "audioDurationMs" INTEGER,
    "sceneCount" INTEGER,
    "viralScore" INTEGER,
    "retentionScore" INTEGER,
    "engagementScore" INTEGER,
    "conversionScore" INTEGER,
    "aiConfidence" DOUBLE PRECISION,
    "predictedCtr" DOUBLE PRECISION,
    "predictedWatchPct" DOUBLE PRECISION,
    "predictedCpa" DOUBLE PRECISION,
    "hookStrengthScore" INTEGER,
    "creditsUsed" INTEGER,
    "aiCostUsd" DECIMAL(12,4),
    "renderCostUsd" DECIMAL(12,4),
    "totalCostUsd" DECIMAL(12,4),
    "revenueGeneratedUsd" DECIMAL(12,4),
    "engineVersion" TEXT,
    "renderNodeId" TEXT,
    "gpuId" TEXT,
    "renderRegion" TEXT,
    "queueWaitMs" INTEGER,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "failedReason" TEXT,
    "failedCategory" TEXT,
    "errorStack" TEXT,
    "refunded" BOOLEAN NOT NULL DEFAULT false,
    "autoPostEnabled" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "platformPostId" TEXT,
    "platformUrl" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "clickThroughs" INTEGER NOT NULL DEFAULT 0,
    "storagePath" TEXT,
    "cdnUrl" TEXT,
    "region" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT,
    "captionStyle" TEXT,
    "hashtags" JSONB,
    "ctaType" TEXT,
    "requestId" TEXT,
    "metadata" JSONB,
    "analytics" JSONB,
    "rawPayload" JSONB,
    "manuallyReviewed" BOOLEAN NOT NULL DEFAULT false,
    "approved" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdJob_jobId_key" ON "AdJob"("jobId");

-- CreateIndex
CREATE INDEX "AdJob_userId_idx" ON "AdJob"("userId");

-- CreateIndex
CREATE INDEX "AdJob_status_idx" ON "AdJob"("status");

-- CreateIndex
CREATE INDEX "AdJob_platform_idx" ON "AdJob"("platform");

-- CreateIndex
CREATE INDEX "AdJob_createdAt_idx" ON "AdJob"("createdAt");

-- CreateIndex
CREATE INDEX "AdJob_published_idx" ON "AdJob"("published");

-- CreateIndex
CREATE INDEX "AdJob_archived_idx" ON "AdJob"("archived");

-- CreateIndex
CREATE INDEX "AdJob_variantGroupId_idx" ON "AdJob"("variantGroupId");

-- CreateIndex
CREATE INDEX "AdJob_renderRegion_idx" ON "AdJob"("renderRegion");

-- CreateIndex
CREATE INDEX "AdJob_scheduledFor_idx" ON "AdJob"("scheduledFor");

-- AddForeignKey
ALTER TABLE "AdJob" ADD CONSTRAINT "AdJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
