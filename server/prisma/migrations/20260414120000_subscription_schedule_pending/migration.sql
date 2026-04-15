-- Pending downgrade / subscription schedule (Stripe-deferred plan changes)
ALTER TABLE "User" ADD COLUMN "stripeSubscriptionScheduleId" TEXT;
ALTER TABLE "User" ADD COLUMN "scheduledPlanTarget" "Plan";
ALTER TABLE "User" ADD COLUMN "scheduledPlanBilling" TEXT;
ALTER TABLE "User" ADD COLUMN "scheduledPlanEffectiveAt" TIMESTAMP(3);
