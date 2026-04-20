/**
 * One-off: promote every non-deleted user row matching an email (any provider).
 * Default: SUPER_ADMIN + ELITE + ACTIVE + high credits.
 * With `--preview`: PREVIEW role — full product tools, no admin APIs (ELITE-floored entitlements, credit-exempt).
 *
 * Usage (from server/):
 *   node -r dotenv/config -r ts-node/register scripts/promote-user-dev.ts you@example.com
 *   node -r dotenv/config -r ts-node/register scripts/promote-user-dev.ts you@example.com --preview
 */
import { loadServerEnv } from "../src/lib/load-server-env"
import { prisma } from "../src/lib/prisma"

loadServerEnv()

const CREDITS = 500_000
const MONTHLY_CREDITS = 100_000
const BONUS_CREDITS = 250_000

async function main() {
  const args = process.argv.slice(2).filter(a => a !== "--allow-prod")
  const previewMode = args.includes("--preview")
  const raw = args.find(a => a !== "--preview")?.trim()
  const allowProd = process.argv.includes("--allow-prod")
  if (!raw) {
    console.error(
      "Usage: node -r dotenv/config -r ts-node/register scripts/promote-user-dev.ts <email> [--preview] [--allow-prod]"
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
    data: previewMode
      ? {
          role: "PREVIEW",
          plan: "ELITE",
          subscriptionStatus: "ACTIVE",
          credits: CREDITS,
          monthlyCredits: MONTHLY_CREDITS,
          bonusCredits: BONUS_CREDITS,
          subscriptionStartedAt: new Date(),
          trialExpiresAt: null,
          subscriptionEndsAt: null,
          cancelAtPeriodEnd: false,
          emailVerified: true,
        }
      : {
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
  if (previewMode) {
    console.log(
      `Now: PREVIEW (full product, no /admin), ELITE, ACTIVE, credits=${CREDITS} (generation uses credit-exempt path for preview)`
    )
    console.log(
      "Tip: set AD_DEMO_EMAIL / AD_DEMO_PASSWORD to the same email/password for NovaPulseAI ad capture login, or pass demoLoginEmail/demoLoginPassword on POST /api/ads/generate as staff."
    )
  } else {
    console.log(
      `Now: SUPER_ADMIN, ELITE, ACTIVE, credits=${CREDITS}, monthlyCredits=${MONTHLY_CREDITS}, bonusCredits=${BONUS_CREDITS}`
    )
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
