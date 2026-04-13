import { getPublicAppUrl } from "./email-env"

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function emailShell(inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NovaPulseAI</title>
</head>
<body style="margin:0;background:#0b0f19;color:#e8e8ef;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b0f19;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#111827;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 8px 28px;font-size:13px;font-weight:600;letter-spacing:0.08em;color:#a78bfa;text-transform:uppercase;">NovaPulseAI</td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px 28px;font-size:15px;color:#e5e7eb;">
              ${inner}
            </td>
          </tr>
        </table>
        <p style="max-width:560px;margin:16px auto 0;font-size:11px;color:#6b7280;text-align:center;">
          You received this transactional email because of an action on your account.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function welcomeLocalSignupHtml(params: {
  displayName: string | null
  email: string
}): string {
  const name = params.displayName?.trim() || "there"
  const app = getPublicAppUrl()
  return emailShell(`
    <p style="margin:0 0 12px;font-size:20px;font-weight:600;color:#fff;">Welcome, ${escapeHtml(name)}</p>
    <p style="margin:0 0 16px;color:#cbd5e1;">Your NovaPulseAI account is ready. You start on the <strong>Free</strong> plan with credits to try the Video Script engine.</p>
    <p style="margin:0 0 20px;color:#cbd5e1;"><strong>Credits</strong> power each run (scripts, clips, stories). Usage varies by tool and job size — the same rules apply across Billing and Settings.</p>
    <a href="${escapeHtml(app)}/dashboard" style="display:inline-block;padding:12px 22px;border-radius:999px;background:linear-gradient(90deg,#7c3aed,#db2777);color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Open dashboard</a>
  `)
}

export function welcomeGoogleSignupHtml(params: { email: string }): string {
  const app = getPublicAppUrl()
  return emailShell(`
    <p style="margin:0 0 12px;font-size:20px;font-weight:600;color:#fff;">Google sign-in connected</p>
    <p style="margin:0 0 16px;color:#cbd5e1;">Hi ${escapeHtml(params.email)}, your NovaPulseAI account is live. You’re on <strong>Free</strong> with starter credits.</p>
    <p style="margin:0 0 20px;color:#cbd5e1;">Use the dashboard to explore tools. Upgrade anytime from <strong>Billing</strong> when you need more credits or Story Maker / Elite video workflows.</p>
    <a href="${escapeHtml(app)}/dashboard" style="display:inline-block;padding:12px 22px;border-radius:999px;background:linear-gradient(90deg,#7c3aed,#db2777);color:#fff;text-decoration:none;font-weight:600;font-size:14px;">Go to dashboard</a>
  `)
}

export function subscriptionUpdatedHtml(params: {
  email: string
  planLabel: string
  statusLabel: string
}): string {
  const app = getPublicAppUrl()
  return emailShell(`
    <p style="margin:0 0 12px;font-size:18px;font-weight:600;color:#fff;">Subscription updated</p>
    <p style="margin:0 0 12px;color:#cbd5e1;">Hi ${escapeHtml(params.email)}, your plan is now <strong>${escapeHtml(params.planLabel)}</strong> and status is <strong>${escapeHtml(params.statusLabel)}</strong>.</p>
    <p style="margin:0 0 20px;color:#9ca3af;font-size:14px;">Credits and entitlements sync with Stripe. View invoices and manage your subscription in Billing.</p>
    <a href="${escapeHtml(app)}/dashboard/billing" style="display:inline-block;padding:12px 22px;border-radius:999px;border:1px solid rgba(167,139,250,0.45);color:#e9d5ff;text-decoration:none;font-weight:600;font-size:14px;">Open billing</a>
  `)
}

/** Wrap admin HTML with standard footer + unsubscribe (marketing only). */
export function marketingBroadcastWrapper(params: {
  innerHtml: string
  unsubscribeUrl: string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head>
<body style="margin:0;background:#0b0f19;color:#e5e7eb;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:600px;background:#111827;border-radius:16px;border:1px solid rgba(255,255,255,0.08);">
        <tr><td style="padding:28px;font-size:15px;line-height:1.6;">
          ${params.innerHtml}
          <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:28px 0;" />
          <p style="margin:0;font-size:12px;color:#9ca3af;">
            You’re subscribed to product updates from NovaPulseAI.
            <a href="${escapeHtml(params.unsubscribeUrl)}" style="color:#c4b5fd;">Unsubscribe</a> from marketing emails (transactional receipts may still be sent).
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}
