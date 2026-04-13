-- Minimal lineage + library metadata: optional brand voice and source refs on Generation;
-- optional source refs on AdJob; self-relation on Generation for sourceGenerationId.

ALTER TABLE "Generation" ADD COLUMN "brandVoiceId" TEXT;
ALTER TABLE "Generation" ADD COLUMN "sourceContentPackId" TEXT;
ALTER TABLE "Generation" ADD COLUMN "sourceGenerationId" TEXT;
ALTER TABLE "Generation" ADD COLUMN "sourceType" TEXT;

CREATE INDEX "Generation_brandVoiceId_idx" ON "Generation"("brandVoiceId");
CREATE INDEX "Generation_sourceContentPackId_idx" ON "Generation"("sourceContentPackId");
CREATE INDEX "Generation_sourceGenerationId_idx" ON "Generation"("sourceGenerationId");

ALTER TABLE "Generation" ADD CONSTRAINT "Generation_brandVoiceId_fkey" FOREIGN KEY ("brandVoiceId") REFERENCES "BrandVoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_sourceContentPackId_fkey" FOREIGN KEY ("sourceContentPackId") REFERENCES "ContentPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_sourceGenerationId_fkey" FOREIGN KEY ("sourceGenerationId") REFERENCES "Generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdJob" ADD COLUMN "sourceContentPackId" TEXT;
ALTER TABLE "AdJob" ADD COLUMN "sourceGenerationId" TEXT;
ALTER TABLE "AdJob" ADD COLUMN "sourceType" TEXT;

CREATE INDEX "AdJob_sourceContentPackId_idx" ON "AdJob"("sourceContentPackId");

ALTER TABLE "AdJob" ADD CONSTRAINT "AdJob_sourceContentPackId_fkey" FOREIGN KEY ("sourceContentPackId") REFERENCES "ContentPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
