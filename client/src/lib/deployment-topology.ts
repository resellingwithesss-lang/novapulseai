/**
 * Deployment topology — keep in sync with `docs/deployment-topology.md` and `client/next.config.js`.
 *
 * Browser (client-side): `api.ts` uses same-origin paths only → `/api/...`.
 * Next.js: rewrites `/api/*` → `${process.env.NEXT_PUBLIC_API_URL}/api/*`.
 * Express: implements `POST /api/billing/change-plan` (not a Next Route Handler).
 */
export const DEPLOYMENT_TOPOLOGY = {
  expressBillingChangePlanMethodPath: "POST /api/billing/change-plan",
  /** Path the browser `fetch` uses (relative to the Next deployment origin). */
  browserRelativePathChangePlan: "/api/billing/change-plan",
  /** Env that defines the Express upstream for Next rewrites (build-time on Vercel). */
  nextPublicApiUrlEnv: "NEXT_PUBLIC_API_URL",
  nextPublicAppUrlEnv: "NEXT_PUBLIC_APP_URL",
} as const
