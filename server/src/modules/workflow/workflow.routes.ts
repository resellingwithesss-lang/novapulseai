import { Router, Response } from "express"
import { prisma } from "../../lib/prisma"
import { requireAuth, AuthRequest } from "../auth/auth.middleware"
import { getWorkflowLimits } from "../plans/plan.constants"
import { resolveRequestId, toolFail, toolOk } from "../../lib/tool-response"

const router = Router()

router.get("/summary", requireAuth, async (req: AuthRequest, res: Response) => {
  const requestId = resolveRequestId(req)
  const userId = req.user?.id
  if (!userId) {
    return toolFail(res, 401, "Unauthorized", {
      requestId,
      stage: "validate",
      code: "UNAUTHORIZED",
    })
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    })
    const plan = user?.plan ?? "FREE"
    const [workspaceCount, brandVoiceCount, contentPackCount] =
      await Promise.all([
        prisma.workspace.count({ where: { userId } }),
        prisma.brandVoice.count({ where: { userId } }),
        prisma.contentPack.count({ where: { userId } }),
      ])
    const limits = getWorkflowLimits(plan)
    return toolOk(res, {
      requestId,
      stage: "finalize",
      counts: {
        workspaces: workspaceCount,
        brandVoices: brandVoiceCount,
        contentPacks: contentPackCount,
      },
      limits: {
        maxWorkspaces: limits.workspaces,
        maxBrandVoices: limits.brandVoices,
        maxContentPacks: limits.contentPacks,
      },
    })
  } catch (err) {
    console.error("WORKFLOW_SUMMARY_ERROR", err)
    return toolFail(res, 500, "Failed to load workflow summary", {
      requestId,
      stage: "failed",
      code: "INTERNAL_ERROR",
    })
  }
})

export default router
