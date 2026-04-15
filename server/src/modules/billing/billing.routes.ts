import crypto from "crypto"
import { Router, Response } from "express"
import { asyncHandler } from "../../middlewares/global-error-handler"
import { stripe } from "../../lib/stripe"
import { staffFloorPlan } from "../../lib/staff-plan"
import { resolveFrontendBaseUrl } from "../../lib/frontend-url"
import { requireAuth, AuthRequest } from "../auth/auth.middleware"
import { prisma } from "../../lib/prisma"
import { fail, ok } from "../../lib/http"
import { SubscriptionStatus, Plan } from "@prisma/client"
import { planRank } from "../plans/plan.constants"
import { checkoutOrChangePlanBodySchema } from "./checkout-body.schema"
import { resolveApprovedStripePriceId, type PaidPlanTier } from "./stripe-price-resolve"
import { proTrialPeriodDaysForCheckout } from "./pro-trial-eligibility"
import { logBillingEvent } from "./billing-events"
import {
  classifyBillingRouteError,
  isPlausibleStripePriceId,
  isStripeSubscriptionMissingError,
} from "./stripe-billing-errors"
import {
  billingProdFailureHint,
  bodyShapeForBillingLog,
  safeRequestHostFields,
  stripePriceEnvVarForTier,
  stripePriceImportTimeVsRuntimeEnv,
  stripeSecretKeyMode,
} from "./billing-production-diagnostics"
import { classifyPlanChangeRequest } from "./plan-change-classification"
import {
  getSubscriptionPeriodBounds,
  releaseStripeSubscriptionScheduleIfPresent,
  scheduleStripeDowngradeAtPeriodEnd,
} from "./stripe-downgrade-schedule"
import { createStripeBillingPortalUrl } from "./billing-portal-session"
import { requireCsrfForCookieAuth } from "../../middlewares/csrf-protect"

const router = Router()

function logStripeErrForBilling(
  classification: ReturnType<typeof classifyBillingRouteError>
): void {
  const stripeKeyMode = stripeSecretKeyMode()
  const prodFailureHint = billingProdFailureHint({
    billingFailureCode: classification.code,
    stripeKeyMode,
  })
  logBillingEvent("stripe_error", {
    ...classification.logFields,
    stripeKeyMode,
    ...(prodFailureHint ? { prodFailureHint } : {}),
  })
}

type BillingCycle = "monthly" | "yearly"

function isStripeSubscriptionReusable(status: string): boolean {
  return (
    status === "active" ||
    status === "trialing" ||
    status === "past_due" ||
    status === "unpaid"
  )
}

function isDowngradePlan(current: Plan, target: PaidPlanTier): boolean {
  return planRank(target) < planRank(current)
}

function billingEnvironmentLabel(): string {
  return (
    process.env.BILLING_ENVIRONMENT?.trim() ||
    process.env.NODE_ENV?.trim() ||
    "development"
  )
}

async function releaseScheduleAndClearPendingDb(
  userId: string,
  scheduleId: string | null | undefined
): Promise<void> {
  await releaseStripeSubscriptionScheduleIfPresent(scheduleId)
  await prisma.user.update({
    where: { id: userId },
    data: {
      stripeSubscriptionScheduleId: null,
      scheduledPlanTarget: null,
      scheduledPlanBilling: null,
      scheduledPlanEffectiveAt: null,
    },
  })
}

async function checkoutOrChangePlan(req: AuthRequest, res: Response) {
  const requestId = req.requestId ?? "unknown"
  const routePath = req.path || ""
  const contentType = String(req.headers["content-type"] ?? "")

  logBillingEvent("billing_route_context", {
    requestId,
    routePath,
    method: req.method,
    stripeKeyMode: stripeSecretKeyMode(),
    ...safeRequestHostFields(req),
  })

  if (!req.user?.id) {
    return fail(res, 401, "Unauthorized", { code: "UNAUTHORIZED", requestId })
  }

  const parsed = checkoutOrChangePlanBodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    const shape = bodyShapeForBillingLog(req.body, contentType)
    logBillingEvent("billing_validation_failed", {
      userId: req.user.id,
      routePath,
      requestId,
      zodIssueCount: parsed.error.issues.length,
      ...shape,
      expectedShape: "json_body_plan_STARTER_PRO_ELITE_billing_monthly_yearly_optional",
    })
    return fail(res, 400, "Invalid plan or billing interval", {
      issues: parsed.error.flatten(),
      code: "INVALID_BODY",
      requestId,
    })
  }

  const targetPlan = parsed.data.plan
  const billing: BillingCycle = parsed.data.billing

  const priceId = resolveApprovedStripePriceId(targetPlan, billing)
  if (!priceId) {
    logBillingEvent("checkout_session_create_failed", {
      userId: req.user.id,
      reason: "missing_stripe_price",
      tier: targetPlan,
      interval: billing,
      routePath,
      requestId,
    })
    return fail(res, 500, `Stripe price not configured for ${targetPlan} (${billing}).`, {
      code: "MISSING_STRIPE_PRICE_ENV",
      requestId,
    })
  }

  const priceEnvVar = stripePriceEnvVarForTier(targetPlan, billing)
  const envDrift = stripePriceImportTimeVsRuntimeEnv(targetPlan, billing, priceId)
  if (envDrift.importTimeDrift) {
    logBillingEvent("billing_price_env_drift", {
      requestId,
      userId: req.user.id,
      envVar: envDrift.envVar,
      runtimeEnvPrefix: envDrift.runtimeEnvPrefix,
      resolvedPrefix: envDrift.resolvedPrefix,
      hint: "PLAN_CONFIG_env_frozen_at_import_restart_process_if_env_changed_at_runtime",
    })
  }

  if (!isPlausibleStripePriceId(priceId)) {
    logBillingEvent("checkout_session_create_failed", {
      userId: req.user.id,
      reason: "malformed_stripe_price_id",
      tier: targetPlan,
      interval: billing,
      priceIdPrefix: priceId.slice(0, 16),
      priceEnvVar,
      stripeKeyMode: stripeSecretKeyMode(),
      routePath,
      requestId,
    })
    return fail(
      res,
      500,
      "A Stripe price id in server configuration is malformed. Fix STRIPE_PRICE_* env values on the API.",
      { code: "MALFORMED_STRIPE_PRICE_ENV", requestId }
    )
  }

  logBillingEvent("billing_checkout_attempt", {
    userId: req.user.id,
    routePath,
    tier: targetPlan,
    interval: billing,
    priceIdPrefix: priceId.slice(0, 12),
    priceEnvVar,
    stripeKeyMode: stripeSecretKeyMode(),
    requestId,
  })

  try {
    let user = await prisma.user.findUnique({
      where: { id: req.user.id },
    })

    if (!user) {
      return fail(res, 404, "User not found", { code: "USER_NOT_FOUND", requestId })
    }

    const currentPlan = staffFloorPlan(user.plan, user.role) as Plan

    const shouldTrySubscriptionUpdate =
      Boolean(user.stripeSubscriptionId) &&
      (user.subscriptionStatus === SubscriptionStatus.ACTIVE ||
        user.subscriptionStatus === SubscriptionStatus.TRIALING)

    logBillingEvent("billing_user_loaded", {
      userId: user.id,
      routePath,
      plan: user.plan,
      currentPlanAfterStaffFloor: currentPlan,
      targetPlan,
      subscriptionStatus: user.subscriptionStatus,
      hasStripeCustomer: Boolean(user.stripeCustomerId),
      hasStripeSubscription: Boolean(user.stripeSubscriptionId),
      willTrySubscriptionUpdate: shouldTrySubscriptionUpdate,
      downgradeWouldBe: isDowngradePlan(currentPlan, targetPlan) ? "true" : "false",
      requestId,
    })

    const frontendBase = resolveFrontendBaseUrl()
    if (!frontendBase) {
      logBillingEvent("billing_config_error", { reason: "missing_frontend_url", requestId })
      return fail(
        res,
        500,
        "Billing is not configured: set FRONTEND_URL or CLIENT_URL on the API server.",
        { code: "MISSING_FRONTEND_URL", requestId }
      )
    }

    if (shouldTrySubscriptionUpdate) {
      logBillingEvent("billing_subscription_branch_entered", {
        requestId,
        userId: user.id,
        dbSubscriptionIdPrefix: user.stripeSubscriptionId!.slice(0, 12),
        stripeKeyMode: stripeSecretKeyMode(),
        targetTier: targetPlan,
        targetBilling: billing,
      })
      try {
        const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId!)

        const currentItem = subscription.items.data[0]
        const subscriptionUnusable =
          subscription.status === "canceled" || !currentItem

        if (subscriptionUnusable) {
          logBillingEvent("billing_stale_subscription_cleared", {
            requestId,
            userId: user.id,
            reason:
              subscription.status === "canceled"
                ? "stripe_status_canceled"
                : "stripe_subscription_line_items_empty",
            dbSubscriptionIdPrefix: user.stripeSubscriptionId!.slice(0, 12),
            stripeStatus: subscription.status,
            stripeKeyMode: stripeSecretKeyMode(),
          })
          await prisma.user.update({
            where: { id: user.id },
            data: {
              stripeSubscriptionId: null,
              subscriptionStatus: SubscriptionStatus.CANCELED,
            },
          })
          user = await prisma.user.findUnique({ where: { id: req.user.id } })
          if (!user) {
            return fail(res, 404, "User not found", { code: "USER_NOT_FOUND", requestId })
          }
        } else if (currentItem.price.id === priceId) {
          logBillingEvent("billing_no_change_same_price", {
            requestId,
            userId: user.id,
            branch: "stored_subscription",
            currentPlan,
            targetPlan,
          })
          return ok(res, {
            type: "no_change",
            classification: "no_change",
            requestId,
          })
        } else {
          const classificationResult = classifyPlanChangeRequest({
            currentPlan,
            targetPlan,
            billing,
            currentStripePriceId: currentItem.price.id,
            subscriptionStatus: user.subscriptionStatus,
          })

          logBillingEvent("plan_change_classified", {
            requestId,
            userId: user.id,
            classification: classificationResult.classification,
            currentPlan,
            targetPlan,
            targetBilling: billing,
            reason: classificationResult.reason ?? "",
          })

          if (classificationResult.classification === "invalid_change") {
            return fail(
              res,
              400,
              "This subscription cannot be changed from the app right now. Open Billing or try when the subscription is active.",
              {
                code: "PLAN_CHANGE_INVALID",
                classification: classificationResult.classification,
                reason: classificationResult.reason,
                requestId,
              }
            )
          }

          if (classificationResult.classification === "downgrade") {
            await releaseScheduleAndClearPendingDb(user.id, user.stripeSubscriptionScheduleId)

            const period = getSubscriptionPeriodBounds(subscription)
            if (!period) {
              return fail(res, 500, "Could not read the current billing period from Stripe.", {
                code: "STRIPE_PERIOD_MISSING",
                requestId,
              })
            }

            try {
              const { scheduleId } = await scheduleStripeDowngradeAtPeriodEnd({
                subscription,
                currentPriceId: currentItem.price.id,
                targetPriceId: priceId,
                period,
                userId: user.id,
                environmentLabel: billingEnvironmentLabel(),
              })
              const effectiveAt = new Date(period.end * 1000)
              await prisma.user.update({
                where: { id: user.id },
                data: {
                  stripeSubscriptionScheduleId: scheduleId,
                  scheduledPlanTarget: targetPlan,
                  scheduledPlanBilling: billing,
                  scheduledPlanEffectiveAt: effectiveAt,
                },
              })
              logBillingEvent("plan_change_stripe_schedule_created", {
                requestId,
                userId: user.id,
                scheduleIdPrefix: scheduleId.slice(0, 12),
                targetPlan,
                targetBilling: billing,
              })
              return ok(res, {
                type: "scheduled_downgrade",
                classification: "downgrade",
                effectiveAt: effectiveAt.toISOString(),
                targetPlan,
                targetBilling: billing,
                requestId,
              })
            } catch (schedErr: unknown) {
              const msg = schedErr instanceof Error ? schedErr.message : String(schedErr)
              logBillingEvent("plan_change_stripe_schedule_failed", {
                requestId,
                userId: user.id,
                messageSnippet: msg.slice(0, 200),
              })
              if (user.stripeCustomerId) {
                const portalUrl = await createStripeBillingPortalUrl({
                  customerId: user.stripeCustomerId,
                  returnUrl: `${frontendBase}/dashboard/billing`,
                })
                if (portalUrl) {
                  return ok(res, {
                    type: "redirect_to_portal",
                    classification: "downgrade",
                    url: portalUrl,
                    requestId,
                    message:
                      "We could not schedule the downgrade automatically. Use the billing portal to change your plan.",
                  })
                }
              }
              return fail(res, 503, "Unable to schedule downgrade. Try the billing portal or contact support.", {
                code: "DOWNGRADE_SCHEDULE_FAILED",
                requestId,
              })
            }
          }

          const hadStoredSchedule = Boolean(user.stripeSubscriptionScheduleId)
          await releaseScheduleAndClearPendingDb(user.id, user.stripeSubscriptionScheduleId)
          if (hadStoredSchedule) {
            logBillingEvent("plan_change_stripe_schedule_released", {
              requestId,
              userId: user.id,
              classification: classificationResult.classification,
            })
          }

          logBillingEvent("plan_change_immediate_update", {
            requestId,
            userId: user.id,
            classification: classificationResult.classification,
            targetPlan,
            targetBilling: billing,
          })

          logBillingEvent("stripe_subscription_update_started", {
            userId: user.id,
            subscriptionId: subscription.id,
            fromPriceId: currentItem.price.id?.slice(0, 12),
            toPriceIdPrefix: priceId.slice(0, 12),
            requestId,
          })

          await stripe.subscriptions.update(
            user.stripeSubscriptionId!,
            {
              proration_behavior: "create_prorations",
              items: [{ id: currentItem.id, price: priceId }],
              metadata: {
                userId: user.id,
                planTier: targetPlan,
                plan: targetPlan,
                billingInterval: billing,
                billing,
                environment: billingEnvironmentLabel(),
              },
            },
            { idempotencyKey: `sub_upd_${user.id}_${targetPlan}_${billing}_${requestId}`.slice(0, 255) }
          )

          logBillingEvent("stripe_subscription_update_succeeded", {
            userId: user.id,
            subscriptionId: subscription.id,
            requestId,
          })

          return ok(res, {
            type: "updated",
            classification: classificationResult.classification,
            requestId,
          })
        }
      } catch (firstErr: unknown) {
        if (isStripeSubscriptionMissingError(firstErr)) {
          logBillingEvent("billing_stale_subscription_cleared", {
            requestId,
            userId: user.id,
            reason: "stripe_resource_missing_subscription",
            dbSubscriptionIdPrefix: (user.stripeSubscriptionId ?? "").slice(0, 12),
            stripeKeyMode: stripeSecretKeyMode(),
          })
          await prisma.user.update({
            where: { id: user.id },
            data: {
              stripeSubscriptionId: null,
              subscriptionStatus: SubscriptionStatus.CANCELED,
            },
          })
          user = await prisma.user.findUnique({ where: { id: req.user.id } })
          if (!user) {
            return fail(res, 404, "User not found", { code: "USER_NOT_FOUND", requestId })
          }
        } else {
          const c = classifyBillingRouteError(firstErr, {
            requestId,
            operation: "subscription_update",
          })
          logStripeErrForBilling(c)
          return fail(res, c.httpStatus, c.clientMessage, {
            code: c.code,
            requestId,
          })
        }
      }
    }

    let customerId = user.stripeCustomerId
    if (!customerId) {
      logBillingEvent("stripe_customer_create_started", { userId: user.id, requestId })
      const customer = await stripe.customers.create(
        {
          email: user.email ?? undefined,
          metadata: { userId: user.id },
        },
        { idempotencyKey: `cust_${user.id}`.slice(0, 255) }
      )
      customerId = customer.id
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      })
      logBillingEvent("stripe_customer_create_succeeded", {
        userId: user.id,
        customerIdPrefix: customerId.slice(0, 12),
        requestId,
      })
    }

    const existingSubscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
    })

    const reusableSubscription = existingSubscriptions.data.find((sub) =>
      isStripeSubscriptionReusable(sub.status)
    )

    if (reusableSubscription) {
      const currentItem = reusableSubscription.items.data[0]
      if (!currentItem) {
        return fail(res, 500, "Subscription item missing", {
          code: "SUBSCRIPTION_ITEM_MISSING",
          requestId,
        })
      }

      if (currentItem.price.id === priceId) {
        logBillingEvent("billing_no_change_same_price", {
          requestId,
          userId: user.id,
          branch: "reusable_customer_subscription",
          currentPlan,
          targetPlan,
        })
        if (!user.stripeSubscriptionId) {
          await prisma.user.update({
            where: { id: user.id },
            data: { stripeSubscriptionId: reusableSubscription.id },
          })
        }
        return ok(res, {
          type: "no_change",
          classification: "no_change",
          requestId,
        })
      }

      const reuseClassification = classifyPlanChangeRequest({
        currentPlan,
        targetPlan,
        billing,
        currentStripePriceId: currentItem.price.id,
        subscriptionStatus: user.subscriptionStatus,
      })

      logBillingEvent("plan_change_classified", {
        requestId,
        userId: user.id,
        classification: reuseClassification.classification,
        branch: "reusable_customer_subscription",
        currentPlan,
        targetPlan,
        reason: reuseClassification.reason ?? "",
      })

      if (reuseClassification.classification === "invalid_change") {
        return fail(
          res,
          400,
          "This subscription cannot be changed from the app right now. Open Billing or try when the subscription is active.",
          {
            code: "PLAN_CHANGE_INVALID",
            classification: reuseClassification.classification,
            reason: reuseClassification.reason,
            requestId,
          }
        )
      }

      if (reuseClassification.classification === "downgrade") {
        await releaseScheduleAndClearPendingDb(user.id, user.stripeSubscriptionScheduleId)
        const period = getSubscriptionPeriodBounds(reusableSubscription)
        if (!period) {
          return fail(res, 500, "Could not read the current billing period from Stripe.", {
            code: "STRIPE_PERIOD_MISSING",
            requestId,
          })
        }
        try {
          const { scheduleId } = await scheduleStripeDowngradeAtPeriodEnd({
            subscription: reusableSubscription,
            currentPriceId: currentItem.price.id,
            targetPriceId: priceId,
            period,
            userId: user.id,
            environmentLabel: billingEnvironmentLabel(),
          })
          const effectiveAt = new Date(period.end * 1000)
          await prisma.user.update({
            where: { id: user.id },
            data: {
              stripeSubscriptionId: reusableSubscription.id,
              stripeSubscriptionScheduleId: scheduleId,
              scheduledPlanTarget: targetPlan,
              scheduledPlanBilling: billing,
              scheduledPlanEffectiveAt: effectiveAt,
            },
          })
          logBillingEvent("plan_change_stripe_schedule_created", {
            requestId,
            userId: user.id,
            scheduleIdPrefix: scheduleId.slice(0, 12),
            targetPlan,
            targetBilling: billing,
            branch: "reusable_customer_subscription",
          })
          return ok(res, {
            type: "scheduled_downgrade",
            classification: "downgrade",
            effectiveAt: effectiveAt.toISOString(),
            targetPlan,
            targetBilling: billing,
            requestId,
          })
        } catch (schedErr: unknown) {
          const msg = schedErr instanceof Error ? schedErr.message : String(schedErr)
          logBillingEvent("plan_change_stripe_schedule_failed", {
            requestId,
            userId: user.id,
            messageSnippet: msg.slice(0, 200),
            branch: "reusable_customer_subscription",
          })
          if (user.stripeCustomerId) {
            const portalUrl = await createStripeBillingPortalUrl({
              customerId: user.stripeCustomerId,
              returnUrl: `${frontendBase}/dashboard/billing`,
            })
            if (portalUrl) {
              return ok(res, {
                type: "redirect_to_portal",
                classification: "downgrade",
                url: portalUrl,
                requestId,
                message:
                  "We could not schedule the downgrade automatically. Use the billing portal to change your plan.",
              })
            }
          }
          return fail(res, 503, "Unable to schedule downgrade. Try the billing portal or contact support.", {
            code: "DOWNGRADE_SCHEDULE_FAILED",
            requestId,
          })
        }
      }

      const hadReuseSchedule = Boolean(user.stripeSubscriptionScheduleId)
      await releaseScheduleAndClearPendingDb(user.id, user.stripeSubscriptionScheduleId)
      if (hadReuseSchedule) {
        logBillingEvent("plan_change_stripe_schedule_released", {
          requestId,
          userId: user.id,
          classification: reuseClassification.classification,
          branch: "reusable_customer_subscription",
        })
      }

      logBillingEvent("stripe_subscription_reuse_update_started", {
        userId: user.id,
        subscriptionId: reusableSubscription.id,
        requestId,
      })

      try {
        await stripe.subscriptions.update(
          reusableSubscription.id,
          {
            proration_behavior: "create_prorations",
            items: [{ id: currentItem.id, price: priceId }],
            metadata: {
              userId: user.id,
              planTier: targetPlan,
              plan: targetPlan,
              billingInterval: billing,
              billing,
              environment: billingEnvironmentLabel(),
            },
          },
          {
            idempotencyKey: `sub_reuse_${user.id}_${reusableSubscription.id}_${targetPlan}`.slice(
              0,
              255
            ),
          }
        )
      } catch (reuseErr: unknown) {
        const c = classifyBillingRouteError(reuseErr, {
          requestId,
          operation: "subscription_reuse_update",
        })
        logStripeErrForBilling(c)
        return fail(res, c.httpStatus, c.clientMessage, { code: c.code, requestId })
      }

      if (user.stripeSubscriptionId !== reusableSubscription.id) {
        await prisma.user.update({
          where: { id: user.id },
          data: { stripeSubscriptionId: reusableSubscription.id },
        })
      }

      logBillingEvent("stripe_subscription_reuse_update_succeeded", {
        userId: user.id,
        subscriptionId: reusableSubscription.id,
        requestId,
      })

      return ok(res, {
        type: "updated",
        classification: reuseClassification.classification,
        requestId,
      })
    }

    const trialDays = proTrialPeriodDaysForCheckout(targetPlan, billing, {
      plan: user.plan,
      subscriptionStatus: user.subscriptionStatus,
      stripeSubscriptionId: user.stripeSubscriptionId,
      billingProTrialConsumedAt: user.billingProTrialConsumedAt,
    })

    const idempotencyKey = `chk_${user.id}_${targetPlan}_${billing}_${crypto.randomUUID()}`.slice(
      0,
      255
    )

    logBillingEvent("stripe_checkout_session_create_started", {
      userId: user.id,
      tier: targetPlan,
      interval: billing,
      trialApplied: trialDays != null ? "true" : "false",
      trialDays: trialDays ?? 0,
      priceEnvVar,
      priceIdPrefix: priceId.slice(0, 12),
      stripeKeyMode: stripeSecretKeyMode(),
      requestId,
    })

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        payment_method_types: ["card"],
        allow_promotion_codes: true,
        billing_address_collection: "auto",
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: user.id,
        metadata: {
          userId: user.id,
          planTier: targetPlan,
          billingInterval: billing,
          environment: billingEnvironmentLabel(),
        },
        subscription_data: {
          ...(trialDays != null ? { trial_period_days: trialDays } : {}),
          metadata: {
            userId: user.id,
            planTier: targetPlan,
            plan: targetPlan,
            billingInterval: billing,
            billing,
            environment: billingEnvironmentLabel(),
            proTrialEligible: trialDays != null ? "true" : "false",
          },
        },
        success_url: `${frontendBase}/dashboard/billing?success=true`,
        cancel_url: `${frontendBase}/dashboard/billing?canceled=true`,
      },
      { idempotencyKey }
    )

    logBillingEvent("stripe_checkout_session_create_succeeded", {
      userId: user.id,
      tier: targetPlan,
      interval: billing,
      checkoutSessionId: session.id ?? "",
      requestId,
    })

    return ok(res, {
      type: "checkout",
      url: session.url,
      requestId,
    })
  } catch (error: unknown) {
    const c = classifyBillingRouteError(error, { requestId, operation: "billing_route" })
    logStripeErrForBilling(c)
    return fail(res, c.httpStatus, c.clientMessage, { code: c.code, requestId })
  }
}

router.post("/checkout", requireAuth, requireCsrfForCookieAuth, asyncHandler(checkoutOrChangePlan))
router.post("/change-plan", requireAuth, requireCsrfForCookieAuth, asyncHandler(checkoutOrChangePlan))

export default router
