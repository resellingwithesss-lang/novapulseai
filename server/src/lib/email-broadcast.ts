import {
  EmailCampaignStatus,
  EmailLogType,
  Plan,
  SubscriptionStatus,
} from "@prisma/client"
import { z } from "zod"
import { prisma } from "./prisma"
import { getPublicAppUrl } from "./email-env"
import { marketingBroadcastWrapper } from "./email-templates"
import { log, serializeErr } from "./logger"
import {
  buildMarketingAudienceWhere,
  marketingAudienceFilterSchema,
  type MarketingAudienceFilter,
} from "./marketing-audience"
import {
  applyCampaignMergeTagsHtml,
  applyCampaignMergeTagsPlain,
} from "./campaign-merge-tags"

/** @deprecated Legacy narrow filter from POST /admin/email/broadcast */
export type AdminBroadcastFilter = {
  plan?: Plan
  subscriptionStatus?: SubscriptionStatus
}

const legacyFilterSchema = z
  .object({
    plan: z.nativeEnum(Plan).optional(),
    subscriptionStatus: z.nativeEnum(SubscriptionStatus).optional(),
  })
  .strict()

/**
 * Normalize stored campaign.filter JSON into a sendable audience definition.
 * Always sets sendableOnly=true so broadcasts never bypass consent invariants.
 */
export function normalizeCampaignAudienceFilter(raw: unknown): MarketingAudienceFilter {
  const asObj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
  const legacy = legacyFilterSchema.safeParse(asObj)
  if (legacy.success) {
    const keys = Object.keys(legacy.data).filter(
      (k) => legacy.data[k as keyof typeof legacy.data] !== undefined
    )
    if (keys.length > 0) {
      const f: MarketingAudienceFilter = { sendableOnly: true }
      if (legacy.data.plan) f.plan = [legacy.data.plan]
      if (legacy.data.subscriptionStatus) {
        f.subscriptionStatus = [legacy.data.subscriptionStatus]
      }
      return f
    }
  }

  const full = marketingAudienceFilterSchema.safeParse(asObj)
  if (!full.success) {
    return { sendableOnly: true }
  }
  return { ...full.data, sendableOnly: true }
}

/**
 * Background fan-out for admin broadcast. Does not block HTTP response.
 * Applies merge tags per recipient; only sendable marketing users are queried.
 */
const EXPANDABLE_STATUSES: ReadonlySet<EmailCampaignStatus> = new Set([
  EmailCampaignStatus.DRAFT,
  EmailCampaignStatus.QUEUED,
  EmailCampaignStatus.SCHEDULED,
])

/**
 * Promotes SCHEDULED campaigns whose `scheduledSendAt` has passed.
 * Safe to call from the same interval as the delivery worker.
 */
export async function processScheduledCampaignsTick(): Promise<void> {
  const now = new Date()
  const due = await prisma.emailCampaign.findMany({
    where: {
      status: EmailCampaignStatus.SCHEDULED,
      scheduledSendAt: { lte: now },
    },
    take: 8,
    orderBy: { scheduledSendAt: "asc" },
    select: { id: true },
  })
  for (const row of due) {
    void expandAdminBroadcastAsync(row.id)
  }
}

export async function expandAdminBroadcastAsync(campaignId: string): Promise<void> {
  try {
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: campaignId },
    })
    if (!campaign) return

    if (!EXPANDABLE_STATUSES.has(campaign.status)) {
      log.warn("email_broadcast_skip_status", {
        campaignId,
        status: campaign.status,
      })
      return
    }

    await prisma.emailCampaign.update({
      where: { id: campaignId },
      data: {
        status: EmailCampaignStatus.SENDING,
        scheduledSendAt: null,
      },
    })

    const audienceFilter = normalizeCampaignAudienceFilter(campaign.filter)
    const where = buildMarketingAudienceWhere(audienceFilter)

    const app = getPublicAppUrl()
    const chunkSize = 250
    let cursor: string | undefined
    let queued = 0

    for (;;) {
      const users = await prisma.user.findMany({
        where,
        take: chunkSize,
        orderBy: { id: "asc" },
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true,
          email: true,
          displayName: true,
          plan: true,
          credits: true,
          subscriptionStatus: true,
          marketingUnsubscribeToken: true,
        },
      })

      if (users.length === 0) break

      for (const u of users) {
        const unsubUrl = `${app}/api/email/unsubscribe?token=${encodeURIComponent(u.marketingUnsubscribeToken)}`
        const recipient = {
          email: u.email,
          displayName: u.displayName,
          plan: u.plan,
          credits: u.credits,
          subscriptionStatus: u.subscriptionStatus,
        }
        const subject = applyCampaignMergeTagsPlain(campaign.subject, recipient, app)
        const innerHtml = applyCampaignMergeTagsHtml(campaign.htmlContent, recipient, app)
        const html = marketingBroadcastWrapper({
          innerHtml,
          unsubscribeUrl: unsubUrl,
        })

        await prisma.emailDelivery.create({
          data: {
            userId: u.id,
            campaignId: campaign.id,
            toEmail: u.email,
            subject,
            html,
            kind: EmailLogType.MARKETING,
          },
        })
        queued++
      }

      cursor = users[users.length - 1]!.id

      await prisma.emailCampaign.update({
        where: { id: campaignId },
        data: { queuedCount: queued },
      })

      if (users.length < chunkSize) break
    }

    await prisma.emailCampaign.update({
      where: { id: campaignId },
      data: {
        status: EmailCampaignStatus.COMPLETED,
        sentAt: new Date(),
        queuedCount: queued,
      },
    })

    log.info("email_broadcast_queued", { campaignId, queued })
  } catch (err) {
    log.error("email_broadcast_failed", {
      campaignId,
      ...serializeErr(err),
    })
    await prisma.emailCampaign
      .update({
        where: { id: campaignId },
        data: { status: EmailCampaignStatus.FAILED },
      })
      .catch(() => {})
  }
}
