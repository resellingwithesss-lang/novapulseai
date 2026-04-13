# Database deploy (Prisma)

## Required on every deploy

From the **`server/`** directory (where `prisma/schema.prisma` lives):

```bash
npm run migrate:deploy
```

(`migrate:deploy` runs `prisma migrate deploy` — applies pending SQL so the live PostgreSQL schema matches `schema.prisma`.)

## Root cause of the AdJob / lineage issue

If **`AdJob`** is missing columns that exist in `schema.prisma` (for example **`workspaceId`**, **`sourceContentPackId`**, **`sourceGenerationId`**, **`sourceType`**), the app is almost always pointed at a database where **Prisma migrations were not applied** for that environment. The normal fix is to run **`npm run migrate:deploy`** from **`server/`** with the correct **`DATABASE_URL`**.

Do not rely on the API’s **degraded insert path** long term: `adJobCreateWithWorkspaceFallback` retries once without those optional columns on **P2022** so old or mis-deployed DBs can still create rows, but **workspace/source lineage is then dropped** on that retry. Treat that as **temporary resilience**, not a substitute for migrations.

## Why it matters for ads

When those columns are missing but the app sends them, inserts can fail with Prisma **P2022** until migrations are applied. Ad generation and lineage-linked creates expect the migrated schema.

## Environment

- Set **`DATABASE_URL`** to your PostgreSQL connection string before running migrate or starting the server.
- Do not run `migrate dev` in production; use **`migrate deploy`** (via **`npm run migrate:deploy`**).

## Optional checks

### Startup drift warning

After `prisma.$connect()`, the server compares live `AdJob` columns to the expected set and logs **`[AdJob schema] Missing column(s): …`** if the DB is behind. It does not exit. Skip with **`PRISMA_SKIP_ADJOB_SCHEMA_CHECK=true`** only if you accept the risk (unusual setups).

### Verification script (read-only)

From **`server/`**:

```bash
npm run verify:adjob-schema
```

Exits **`0`** when all four optional lineage columns exist on **`AdJob`**; **`1`** if any are missing. Safe for CI against a non-production DB or as a pre-flight check.

### Optional smoke tests (local)

| Script | npm script | Notes |
|--------|------------|--------|
| `scripts/smoke-adjob-happy-path.ts` | `npm run smoke:adjob-create` | Creates one `AdJob` then deletes it; checks first insert succeeds without P2022 fallback. |
| `scripts/dev-smoke-admin-ads-api.ts` | `npm run smoke:ads-api:dev` | **Dev-only:** mutates the oldest user (ADMIN + ELITE) and may create a workspace; requires API already running. |

## Rollback

Use your normal DB backup/restore process; Prisma does not auto-rollback migrations.
