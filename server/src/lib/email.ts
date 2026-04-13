/**
 * Email module barrel — import from `@/lib/email` (relative to server src).
 * Resend HTTP API; queue + worker in `email-outbound`; broadcast fan-out in `email-broadcast`.
 */

export {
  getPublicAppUrl,
  getResendFromAddress,
  isEmailSystemConfigured,
} from "./email-env"
export { sendResendEmail, isResendFailure, type ResendSendResult } from "./email-resend"
export {
  queueUserEmail,
  queueWelcomeEmailForNewUser,
  queueSubscriptionChangeEmail,
  processEmailQueueTick,
  startEmailQueueWorker,
} from "./email-outbound"
export { expandAdminBroadcastAsync, type AdminBroadcastFilter } from "./email-broadcast"
