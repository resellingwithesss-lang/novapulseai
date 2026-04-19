import { Router, Request, Response } from "express"
import rateLimit from "express-rate-limit"
import { z } from "zod"
import { AuditAction, MarketingConsentStatus, Prisma } from "@prisma/client"
import { prisma } from "../../lib/prisma"
import { fail, ok } from "../../lib/http"
import { getPublicAppUrl } from "../../lib/email-env"
import { escapeHtml } from "../../lib/email-templates"

const router = Router()

const unsubscribeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
})

function unsubscribeSuccessHtml(): string {
  const app = escapeHtml(getPublicAppUrl())
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Unsubscribed</title>
</head>
<body style="margin:0;background:#0b0f19;color:#e5e7eb;font-family:system-ui,sans-serif;padding:48px 20px;text-align:center;">
  <h1 style="font-size:1.5rem;font-weight:600;color:#fff;">You’re unsubscribed</h1>
  <p style="max-width:28rem;margin:16px auto;line-height:1.6;color:#9ca3af;">
    Marketing emails are turned off for this account. You may still receive billing receipts,
    security notices, and transactional messages about your subscription.
  </p>
  <p style="margin-top:28px;">
    <a href="${app}/dashboard/settings/preferences" style="color:#c4b5fd;font-weight:600;">Email preferences</a>
    ·
    <a href="${app}/dashboard" style="color:#c4b5fd;font-weight:600;">Dashboard</a>
  </p>
</body>
</html>`
}

async function unsubscribeByToken(
  token: string,
  source: "email_link" | "api"
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const trimmed = token.trim()
  if (trimmed.length < 8) return { ok: false, reason: "invalid_token" }

  const user = await prisma.user.findFirst({
    where: { marketingUnsubscribeToken: trimmed },
    select: {
      id: true,
      marketingEmails: true,
      marketingConsentStatus: true,
      marketingConsentCapturedAt: true,
    },
  })
  if (!user) return { ok: false, reason: "not_found" }

  const now = new Date()
  const alreadyOptedOut =
    !user.marketingEmails &&
    user.marketingConsentStatus === MarketingConsentStatus.OPTED_OUT

  // Idempotent: repeated clicks on the same link do not write new rows but
  // still return success so the UX reads "you're unsubscribed".
  if (alreadyOptedOut) return { ok: true }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        marketingEmails: false,
        marketingConsentStatus: MarketingConsentStatus.OPTED_OUT,
        marketingConsentSource: source,
        marketingConsentUpdatedAt: now,
        marketingConsentCapturedAt: user.marketingConsentCapturedAt ?? now,
        marketingDismissedAt: null,
      },
    })

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: AuditAction.MARKETING_CONSENT_CHANGED,
        metadata: {
          action: "opt_out",
          source,
          previousStatus: user.marketingConsentStatus,
          previousMarketingEmails: user.marketingEmails,
          nextStatus: MarketingConsentStatus.OPTED_OUT,
          nextMarketingEmails: false,
          viaUnsubscribeToken: true,
        } as Prisma.InputJsonValue,
      },
    })
  })

  return { ok: true }
}

/** One-click from email clients (GET). */
router.get("/unsubscribe", unsubscribeLimiter, async (req: Request, res: Response) => {
  const token = typeof req.query.token === "string" ? req.query.token : ""
  const result = await unsubscribeByToken(token, "email_link")
  if (!result.ok) {
    res.status(400).setHeader("Content-Type", "text/html; charset=utf-8")
    return res.send(
      `<!DOCTYPE html><html><body style="font-family:system-ui;padding:40px;background:#0b0f19;color:#fca5a5;text-align:center"><p>Invalid or expired link.</p></body></html>`
    )
  }
  res.status(200).setHeader("Content-Type", "text/html; charset=utf-8")
  return res.send(unsubscribeSuccessHtml())
})

/** JSON unsubscribe for SPA / programmatic clients. */
router.post("/unsubscribe", unsubscribeLimiter, async (req: Request, res: Response) => {
  const parsed = z
    .object({
      token: z.string().min(8).max(200),
    })
    .safeParse(req.body)

  if (!parsed.success) {
    return fail(res, 400, "Invalid request", { issues: parsed.error.flatten() })
  }

  const result = await unsubscribeByToken(parsed.data.token, "api")
  if (!result.ok) {
    return fail(res, 400, "Invalid or expired token")
  }

  return ok(res, { marketingEmails: false })
})

export default router
