import { Router, Response } from "express"
import { z } from "zod"
import { prisma } from "../../lib/prisma"
import { ok, fail } from "../../lib/http"
import { staffFloorPlan } from "../../lib/staff-plan"
import { requireAuth, AuthRequest } from "../auth/auth.middleware"
import { requireCsrfForCookieAuth } from "../../middlewares/csrf-protect"

const router = Router()

const preferencesPatchSchema = z
  .object({
    defaultBrandVoiceId: z.string().cuid().nullable().optional(),
    defaultWorkspaceId: z.string().cuid().nullable().optional(),
    uiDensity: z.enum(["comfortable", "compact"]).optional(),
    emailProductUpdates: z.boolean().optional(),
    emailUsageAlerts: z.boolean().optional(),
  })
  .strict()

const profilePatchSchema = z.object({
  displayName: z
    .string()
    .max(80)
    .nullable()
    .optional()
    .transform((s) => (s === undefined ? undefined : s?.trim() || null)),
})

function mergePreferences(
  prev: Record<string, unknown>,
  patch: z.infer<typeof preferencesPatchSchema>
) {
  const next = { ...prev }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    next[k] = v
  }
  return next
}

router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      displayName: true,
      provider: true,
      emailVerified: true,
      createdAt: true,
      lastLoginAt: true,
      preferences: true,
      credits: true,
      monthlyCredits: true,
      monthlyResetAt: true,
      bonusCredits: true,
      lifetimeCreditsUsed: true,
      totalGenerations: true,
      plan: true,
      subscriptionStatus: true,
      role: true,
    },
  })

  if (!user) {
    return fail(res, 404, "User not found")
  }

  const prefs =
    user.preferences && typeof user.preferences === "object" && !Array.isArray(user.preferences)
      ? (user.preferences as Record<string, unknown>)
      : {}

  return ok(res, {
    profile: {
      email: user.email,
      displayName: user.displayName,
      provider: user.provider,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    },
    preferences: prefs,
    usageSummary: {
      credits: user.credits,
      monthlyCredits: user.monthlyCredits,
      monthlyResetAt: user.monthlyResetAt,
      bonusCredits: user.bonusCredits,
      lifetimeCreditsUsed: user.lifetimeCreditsUsed,
      totalGenerations: user.totalGenerations,
      plan: staffFloorPlan(user.plan, user.role),
      subscriptionStatus: user.subscriptionStatus,
    },
  })
})

router.patch(
  "/profile",
  requireAuth,
  requireCsrfForCookieAuth,
  async (req: AuthRequest, res: Response) => {
  const parsed = profilePatchSchema.safeParse(req.body)
  if (!parsed.success) {
    return fail(res, 400, "Invalid body", { issues: parsed.error.flatten() })
  }

  const { displayName } = parsed.data
  if (displayName === undefined) {
    return fail(res, 400, "Nothing to update")
  }

  const updated = await prisma.user.update({
    where: { id: req.user!.id },
    data: { displayName },
    select: { displayName: true },
  })

  return ok(res, { displayName: updated.displayName })
  }
)

router.patch(
  "/preferences",
  requireAuth,
  requireCsrfForCookieAuth,
  async (req: AuthRequest, res: Response) => {
  const parsed = preferencesPatchSchema.safeParse(req.body)
  if (!parsed.success) {
    return fail(res, 400, "Invalid preferences", { issues: parsed.error.flatten() })
  }

  const userId = req.user!.id
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  })

  if (!user) {
    return fail(res, 404, "User not found")
  }

  const prev =
    user.preferences && typeof user.preferences === "object" && !Array.isArray(user.preferences)
      ? (user.preferences as Record<string, unknown>)
      : {}

  const patch = parsed.data
  if (patch.defaultBrandVoiceId != null) {
    const voice = await prisma.brandVoice.findFirst({
      where: { id: patch.defaultBrandVoiceId, userId },
      select: { id: true },
    })
    if (!voice) {
      return fail(res, 400, "Brand voice not found")
    }
  }

  if (patch.defaultWorkspaceId != null) {
    const ws = await prisma.workspace.findFirst({
      where: { id: patch.defaultWorkspaceId, userId },
      select: { id: true },
    })
    if (!ws) {
      return fail(res, 400, "Workspace not found")
    }
  }

  const merged = mergePreferences(prev, patch)

  await prisma.user.update({
    where: { id: userId },
    data: { preferences: merged as object },
  })

  return ok(res, { preferences: merged })
  }
)

router.get("/credits-ledger", requireAuth, async (req: AuthRequest, res: Response) => {
  const take = Math.min(100, Math.max(1, Number(req.query.limit) || 40))
  const rows = await prisma.creditTransaction.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      amount: true,
      type: true,
      reason: true,
      balanceAfter: true,
      createdAt: true,
    },
  })

  return ok(res, { transactions: rows })
})

export default router
