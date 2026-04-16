/**
 * One-off: promote every non-deleted user row matching an email (any provider)
 * to SUPER_ADMIN + ELITE + ACTIVE + high credits. For local/dev only.
 *
 * Usage (from server/):
 *   node -r dotenv/config -r ts-node/register scripts/promote-user-dev.ts you@example.com
 */
import { loadServerEnv } from "../src/lib/load-server-env"
import { prisma } from "../src/lib/prisma"

loadServerEnv()

const CREDITS = 500_000
const MONTHLY_CREDITS = 100_000
const BONUS_CREDITS = 250_000

async function main() {
  const raw = process.argv[2]?.trim()
  const allowProd = process.argv.includes("--allow-prod")
  if (!raw) {
    console.error(
      "Usage: node -r dotenv/config -r ts-node/register scripts/promote-user-dev.ts <email> [--allow-prod]"
    )
    process.exit(1)
  }
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL is not set.")
    process.exit(1)
  }
  const env = (process.env.NODE_ENV || "development").toLowerCase()
  if (env === "production" && !allowProd) {
    console.error("Refusing to run in production without --allow-prod")
    process.exit(1)
  }

  const matches = await prisma.user.findMany({
    where: {
      email: { equals: raw, mode: "insensitive" },
      deletedAt: null,
    },
    select: { id: true, email: true, provider: true, role: true, plan: true },
  })

  if (matches.length === 0) {
    console.error(`No active (non-deleted) user found for email matching: ${raw}`)
    process.exit(1)
  }

  const result = await prisma.user.updateMany({
    where: {
      email: { equals: raw, mode: "insensitive" },
      deletedAt: null,
    },
    data: {
      role: "SUPER_ADMIN",
      plan: "ELITE",
      subscriptionStatus: "ACTIVE",
      credits: CREDITS,
      monthlyCredits: MONTHLY_CREDITS,
      bonusCredits: BONUS_CREDITS,
      subscriptionStartedAt: new Date(),
      trialExpiresAt: null,
      subscriptionEndsAt: null,
      cancelAtPeriodEnd: false,
    },
  })

  console.log(`Updated ${result.count} user row(s) for email matching "${raw}":`)
  for (const u of matches) {
    console.log(`  - ${u.email} (${u.provider}) id=${u.id}  was role=${u.role} plan=${u.plan}`)
  }
  console.log(
    `Now: SUPER_ADMIN, ELITE, ACTIVE, credits=${CREDITS}, monthlyCredits=${MONTHLY_CREDITS}, bonusCredits=${BONUS_CREDITS}`
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
