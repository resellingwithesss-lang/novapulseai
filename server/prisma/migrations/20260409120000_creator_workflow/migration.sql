-- Creator workflow: Workspace, BrandVoice, ContentPack; optional workspace on Generation / AdJob.
-- Non-destructive: new tables + nullable FKs only.

CREATE TYPE "ContentPackStatus" AS ENUM ('DRAFT', 'READY', 'FAILED');

CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "niche" TEXT NOT NULL DEFAULT '',
    "targetAudience" TEXT NOT NULL DEFAULT '',
    "primaryPlatforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contentGoals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultCtaStyle" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Workspace_userId_idx" ON "Workspace"("userId");

ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BrandVoice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "name" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT '',
    "pacing" TEXT NOT NULL DEFAULT '',
    "slangLevel" TEXT NOT NULL DEFAULT '',
    "ctaStyle" TEXT NOT NULL DEFAULT '',
    "bannedPhrases" JSONB NOT NULL DEFAULT '[]',
    "audienceSophistication" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandVoice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BrandVoice_userId_idx" ON "BrandVoice"("userId");
CREATE INDEX "BrandVoice_workspaceId_idx" ON "BrandVoice"("workspaceId");

ALTER TABLE "BrandVoice" ADD CONSTRAINT "BrandVoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrandVoice" ADD CONSTRAINT "BrandVoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ContentPack" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "brandVoiceId" TEXT,
    "title" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT '',
    "payloadJson" JSONB NOT NULL,
    "status" "ContentPackStatus" NOT NULL DEFAULT 'READY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentPack_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContentPack_userId_idx" ON "ContentPack"("userId");
CREATE INDEX "ContentPack_workspaceId_idx" ON "ContentPack"("workspaceId");
CREATE INDEX "ContentPack_createdAt_idx" ON "ContentPack"("createdAt");

ALTER TABLE "ContentPack" ADD CONSTRAINT "ContentPack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentPack" ADD CONSTRAINT "ContentPack_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentPack" ADD CONSTRAINT "ContentPack_brandVoiceId_fkey" FOREIGN KEY ("brandVoiceId") REFERENCES "BrandVoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Generation" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "Generation_workspaceId_idx" ON "Generation"("workspaceId");
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdJob" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "AdJob_workspaceId_idx" ON "AdJob"("workspaceId");
ALTER TABLE "AdJob" ADD CONSTRAINT "AdJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
