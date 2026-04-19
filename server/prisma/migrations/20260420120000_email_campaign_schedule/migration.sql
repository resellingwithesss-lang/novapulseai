-- Scheduled bulk campaigns (fan-out + consent invariants unchanged).
ALTER TYPE "EmailCampaignStatus" ADD VALUE 'SCHEDULED';

ALTER TABLE "EmailCampaign" ADD COLUMN "scheduledSendAt" TIMESTAMP(3);
