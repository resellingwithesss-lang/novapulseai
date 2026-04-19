import type { Plan, SubscriptionStatus } from "@prisma/client"
import {
  EmailCampaignStatus,
  EmailLogType,
  Prisma,
} from "@prisma/client"
import { prisma } from "./prisma"
import { getPublicAppUrl } from "./email-env"
import { marketingBroadcastWrapper } from "./email-templates"
import { log, serializeErr } from "./logger"
import { SENDABLE_MARKETING_STATUSES } from "./marketing-constants"

export type AdminBroadcastFilter = {
  plan?: Plan
  subscriptionStatus?: SubscriptionStatus
}

/**
 * Background fan-out for admin broadcast. Does not block HTTP response.
 */
export async function expandAdminBroadcastAsync(campaignId: string): Promise<void> {
  try {
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: campaignId },
    })
    if (!campaign) return

    await prisma.emailCampaign.update({
      where: { id: campaignId },
      data: { status: EmailCampaignStatus.SENDING },
    })

    const filter = (campaign.filter ?? {}) as AdminBroadcastFilter
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      banned: false,
      marketingEmails: true,
      marketingConsentStatus: { in: [...SENDABLE_MARKETING_STATUSES] },
    }
    if (filter.plan) where.plan = filter.plan
    if (filter.subscriptionStatus) {
      where.subscriptionStatus = filter.subscriptionStatus
    }

    const app = getPublicAppUrl()
    const chunkSize = 250
    let cursor: string | undefined
    let queued = 0

    for (;;) {
      const users = await prisma.user.findMany({
        where,
        take: chunkSize,
        orderBy: { id: "asc" },
        ...(cursor
          ? { skip: 1, cursor: { id: cursor } }
          : {}),
        select: {
          id: true,
          email: true,
          marketingUnsubscribeToken: true,
        },
      })

      if (users.length === 0) break

      for (const u of users) {
        const unsubUrl = `${app}/api/email/unsubscribe?token=${encodeURIComponent(u.marketingUnsubscribeToken)}`
        const html = marketingBroadcastWrapper({
          innerHtml: campaign.htmlContent,
          unsubscribeUrl: unsubUrl,
        })

        await prisma.emailDelivery.create({
          data: {
            userId: u.id,
            campaignId: campaign.id,
            toEmail: u.email,
            subject: campaign.subject,
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
