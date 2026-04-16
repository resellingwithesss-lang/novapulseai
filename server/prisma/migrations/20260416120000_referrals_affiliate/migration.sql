-- Referral / affiliate commissions + user attribution
CREATE TYPE "ReferralCommissionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'VOID');

ALTER TYPE "AuditAction" ADD VALUE 'REFERRAL_COMMISSION_RECORDED';

ALTER TABLE "User" ADD COLUMN "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN "referredByUserId" TEXT;

CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

CREATE INDEX "User_referredByUserId_idx" ON "User"("referredByUserId");

ALTER TABLE "User" ADD CONSTRAINT "User_referredByUserId_fkey" FOREIGN KEY ("referredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ReferralCommission" (
    "id" TEXT NOT NULL,
    "referrerUserId" TEXT NOT NULL,
    "refereeUserId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "stripeEventId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'gbp',
    "invoiceAmountMinor" INTEGER NOT NULL,
    "commissionRateBps" INTEGER NOT NULL DEFAULT 500,
    "commissionAmountMinor" INTEGER NOT NULL,
    "plan" "Plan",
    "status" "ReferralCommissionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralCommission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralCommission_stripeInvoiceId_key" ON "ReferralCommission"("stripeInvoiceId");
CREATE INDEX "ReferralCommission_referrerUserId_idx" ON "ReferralCommission"("referrerUserId");
CREATE INDEX "ReferralCommission_refereeUserId_idx" ON "ReferralCommission"("refereeUserId");
CREATE INDEX "ReferralCommission_status_idx" ON "ReferralCommission"("status");
CREATE INDEX "ReferralCommission_createdAt_idx" ON "ReferralCommission"("createdAt");

ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_referrerUserId_fkey" FOREIGN KEY ("referrerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_refereeUserId_fkey" FOREIGN KEY ("refereeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
