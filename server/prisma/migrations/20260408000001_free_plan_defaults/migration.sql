-- Runs in a new transaction so 'FREE' is safe to use (after prior migration committed).

UPDATE "User"
SET
  plan = 'FREE'::"Plan",
  credits = LEAST(GREATEST(credits, 0), 4)
WHERE
  "subscriptionStatus"::text = 'CANCELED'
  AND "stripeSubscriptionId" IS NULL
  AND plan::text = 'STARTER';

ALTER TABLE "User" ALTER COLUMN "plan" SET DEFAULT 'FREE'::"Plan";
ALTER TABLE "User" ALTER COLUMN "subscriptionStatus" SET DEFAULT 'CANCELED'::"SubscriptionStatus";
ALTER TABLE "User" ALTER COLUMN "credits" SET DEFAULT 4;
