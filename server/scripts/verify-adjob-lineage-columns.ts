/**
 * Read-only check: `AdJob` has the four optional lineage columns (same logic as startup drift check).
 * Safe for CI/staging/production diagnostics. Run: npm run verify:adjob-schema (from server/).
 */
import { prisma } from "../src/lib/prisma"
import {
  getAdJobPgColumnNames,
  REQUIRED_AD_JOB_OPTIONAL_COLUMNS,
} from "../src/lib/prisma-adjob-drift"

async function main() {
  await prisma.$connect()
  const present = await getAdJobPgColumnNames()
  const missing = REQUIRED_AD_JOB_OPTIONAL_COLUMNS.filter(c => !present.has(c))
  const report = Object.fromEntries(
    REQUIRED_AD_JOB_OPTIONAL_COLUMNS.map(c => [c, present.has(c)])
  )
  console.log(JSON.stringify({ report, missing, ok: missing.length === 0 }, null, 2))
  await prisma.$disconnect()
  if (missing.length > 0) process.exit(1)
}

void main().catch(e => {
  console.error(e)
  process.exit(1)
})
