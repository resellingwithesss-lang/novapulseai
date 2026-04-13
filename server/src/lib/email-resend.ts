import { getResendFromAddress } from "./email-env"

export type ResendSendResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string; status?: number }

export function isResendFailure(
  r: ResendSendResult
): r is { ok: false; error: string; status?: number } {
  return r.ok === false
}

/**
 * Send HTML email via Resend HTTP API (no SDK dependency).
 * https://resend.com/docs/api-reference/emails/send-email
 */
export async function sendResendEmail(params: {
  to: string
  subject: string
  html: string
}): Promise<ResendSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not set" }
  }

  const from = getResendFromAddress()

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        html: params.html,
      }),
    })

    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null

    if (!res.ok) {
      const msg =
        (body?.message as string) ||
        (body?.error as string) ||
        `Resend HTTP ${res.status}`
      return { ok: false, error: msg, status: res.status }
    }

    const id = typeof body?.id === "string" ? body.id : null
    return { ok: true, id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}
