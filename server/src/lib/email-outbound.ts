import {
  EmailDeliveryStatus,
  EmailLogStatus,
  EmailLogType,
} from "@prisma/client"
import { prisma } from "./prisma"
import { isResendFailure, sendResendEmail } from "./email-resend"
import { isEmailSystemConfigured } from "./email-env"
import { SENDABLE_MARKETING_STATUS_SET } from "./marketing-constants"
import {
  subscriptionUpdatedHtml,
  welcomeGoogleSignupHtml,
  welcomeLocalSignupHtml,
} from "./email-templates"
import { log, serializeErr } from "./logger"

const MAX_SEND_ATTEMPTS = 5
const BATCH_SIZE = 12

export async function queueUserEmail(params: {
  userId: string
  toEmail: string
  subject: string
  html: string
  kind: EmailLogType
  campaignId?: string | null
}): Promise<void> {
  if (!isEmailSystemConfigured()) {
    log.warn("email_queue_skipped", { reason: "RESEND_API_KEY unset" })
    return
  }

  await prisma.emailDelivery.create({
    data: {
      userId: params.userId,
      campaignId: params.campaignId ?? undefined,
      toEmail: params.toEmail,
      subject: params.subject,
      html: params.html,
      kind: params.kind,
    },
  })
}

export async function queueWelcomeEmailForNewUser(params: {
  userId: string
  email: string
  displayName: string | null
  viaGoogle: boolean
}): Promise<void> {
  const html = params.viaGoogle
    ? welcomeGoogleSignupHtml({ email: params.email })
    : welcomeLocalSignupHtml({
        displayName: params.displayName,
        email: params.email,
      })

  await queueUserEmail({
    userId: params.userId,
    toEmail: params.email,
    subject: "Welcome to NovaPulseAI",
    html,
    kind: EmailLogType.TRANSACTIONAL,
  })
}

export async function queueSubscriptionChangeEmail(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, plan: true, subscriptionStatus: true },
  })
  if (!user) return

  const html = subscriptionUpdatedHtml({
    email: user.email,
    planLabel: String(user.plan),
    statusLabel: String(user.subscriptionStatus),
  })

  await queueUserEmail({
    userId,
    toEmail: user.email,
    subject: "Your NovaPulseAI subscription was updated",
    html,
    kind: EmailLogType.TRANSACTIONAL,
  })
}

export async function processEmailQueueTick(): Promise<void> {
  if (!isEmailSystemConfigured()) return

  const jobs = await prisma.emailDelivery.findMany({
    where: { status: EmailDeliveryStatus.QUEUED },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  })

  for (const job of jobs) {
    const locked = await prisma.emailDelivery.updateMany({
      where: { id: job.id, status: EmailDeliveryStatus.QUEUED },
      data: { status: EmailDeliveryStatus.SENDING },
    })
    if (locked.count === 0) continue

    const user = await prisma.user.findUnique({
      where: { id: job.userId },
      select: {
        id: true,
        email: true,
        marketingEmails: true,
        marketingConsentStatus: true,
        deletedAt: true,
        banned: true,
      },
    })

    if (!user || user.deletedAt || user.banned) {
      await recordFailureAndDrop(job.id, job.userId, job.kind, job.subject, "USER_INACTIVE")
      if (job.campaignId) {
        await prisma.emailCampaign.update({
          where: { id: job.campaignId },
          data: { failedCount: { increment: 1 } },
        })
      }
      continue
    }

    if (job.kind === EmailLogType.MARKETING) {
      // Invariant: never deliver MARKETING to a user who is not both
      // `marketingEmails=true` AND in a sendable consent status. Protects
      // against mid-flight consent changes and schema drift.
      const sendable =
        user.marketingEmails &&
        SENDABLE_MARKETING_STATUS_SET.has(user.marketingConsentStatus)
      if (!sendable) {
        await recordFailureAndDrop(
          job.id,
          job.userId,
          job.kind,
          job.subject,
          "MARKETING_OPT_OUT"
        )
        if (job.campaignId) {
          await prisma.emailCampaign.update({
            where: { id: job.campaignId },
            data: { failedCount: { increment: 1 } },
          })
        }
        continue
      }
    }

    const result = await sendResendEmail({
      to: job.toEmail,
      subject: job.subject,
      html: job.html,
    })

    if (isResendFailure(result)) {
      const errMsg = result.error
      const httpStatus = result.status
      const nextAttempts = job.attempts + 1
      const retryable =
        nextAttempts < MAX_SEND_ATTEMPTS &&
        (!httpStatus || httpStatus >= 500 || httpStatus === 429)

      if (retryable) {
        await prisma.emailDelivery.update({
          where: { id: job.id },
          data: {
            status: EmailDeliveryStatus.QUEUED,
            attempts: nextAttempts,
            lastError: errMsg.slice(0, 2000),
          },
        })
        continue
      }

      await recordFailureAndDrop(
        job.id,
        job.userId,
        job.kind,
        job.subject,
        errMsg
      )
      if (job.campaignId) {
        await prisma.emailCampaign.update({
          where: { id: job.campaignId },
          data: { failedCount: { increment: 1 } },
        })
      }
      continue
    }

    const sentAt = new Date()
    await prisma.$transaction([
      prisma.emailLog.create({
        data: {
          userId: job.userId,
          type: job.kind,
          subject: job.subject,
          status: EmailLogStatus.SENT,
        },
      }),
      prisma.emailDelivery.delete({ where: { id: job.id } }),
      prisma.user.update({
        where: { id: job.userId },
        data:
          job.kind === EmailLogType.MARKETING
            ? {
                lastEmailSentAt: sentAt,
                lastMarketingEmailSentAt: sentAt,
              }
            : { lastEmailSentAt: sentAt },
      }),
    ])

    if (job.campaignId) {
      await prisma.emailCampaign.update({
        where: { id: job.campaignId },
        data: { sentCount: { increment: 1 } },
      })
    }
  }
}

async function recordFailureAndDrop(
  deliveryId: string,
  userId: string,
  kind: EmailLogType,
  subject: string,
  error: string
) {
  await prisma.$transaction([
    prisma.emailLog.create({
      data: {
        userId,
        type: kind,
        subject,
        status: EmailLogStatus.FAILED,
        errorMessage: error.slice(0, 2000),
      },
    }),
    prisma.emailDelivery.delete({ where: { id: deliveryId } }),
  ])
}

let workerStarted = false

export function startEmailQueueWorker(): void {
  if (workerStarted) return
  workerStarted = true

  const pollMs = Math.max(
    2000,
    Math.min(60_000, Number(process.env.EMAIL_QUEUE_POLL_MS || "4000"))
  )

  setInterval(() => {
    void processEmailQueueTick().catch((err) => {
      log.error("email_queue_tick_failed", serializeErr(err))
    })
  }, pollMs)

  log.info("email_queue_worker_started", { pollMs })
}
