import { test, expect, type Page } from "@playwright/test"

type Plan = "FREE" | "STARTER" | "PRO" | "ELITE"
type SubscriptionStatus = "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED"

type Persona = {
  name: string
  plan: Plan
  creditCap: number
  userCredits: number
  subscriptionStatus: SubscriptionStatus
  trialExpiresAt: string | null
  expectTrialBanner: boolean
  expectTrialBadgeOnBilling: boolean
  lockedTools: Array<{
    id: "video-script" | "story-maker" | "story-video-maker" | "prompt" | "clipper"
    requiredPlan?: Plan
    message?: string
  }>
  expectedBillingStatusLabel: string
  upgradeClick?: {
    buttonText: string
    endpoint: "/billing/change-plan" | "/billing/checkout"
    targetPlan: Plan
  }
}

const now = Date.now()
const in7Days = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString()
const in2Days = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString()
const in30Days = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString()

const personas: Persona[] = [
  {
    name: "FREE canceled",
    plan: "FREE",
    creditCap: 4,
    userCredits: 3,
    subscriptionStatus: "CANCELED",
    trialExpiresAt: null,
    expectTrialBanner: false,
    expectTrialBadgeOnBilling: false,
    expectedBillingStatusLabel: "Canceled",
    lockedTools: [
      { id: "clipper", requiredPlan: "STARTER" },
      { id: "prompt", requiredPlan: "STARTER" },
      { id: "story-maker", requiredPlan: "PRO" },
      { id: "story-video-maker", requiredPlan: "ELITE" },
    ],
    upgradeClick: {
      buttonText: "Upgrade to Pro",
      endpoint: "/billing/checkout",
      targetPlan: "PRO",
    },
  },
  {
    name: "STARTER active",
    plan: "STARTER",
    creditCap: 200,
    userCredits: 140,
    subscriptionStatus: "ACTIVE",
    trialExpiresAt: null,
    expectTrialBanner: false,
    expectTrialBadgeOnBilling: false,
    expectedBillingStatusLabel: "Active",
    lockedTools: [
      { id: "video-script", requiredPlan: "PRO" },
      { id: "story-maker", requiredPlan: "PRO" },
      { id: "story-video-maker", requiredPlan: "ELITE" },
    ],
    upgradeClick: {
      buttonText: "Upgrade to Pro",
      endpoint: "/billing/change-plan",
      targetPlan: "PRO",
    },
  },
  {
    name: "PRO trialing",
    plan: "PRO",
    creditCap: 1000,
    userCredits: 800,
    subscriptionStatus: "TRIALING",
    trialExpiresAt: in2Days,
    expectTrialBanner: true,
    expectTrialBadgeOnBilling: true,
    expectedBillingStatusLabel: "Trialing",
    lockedTools: [{ id: "story-video-maker", requiredPlan: "ELITE" }],
    upgradeClick: {
      buttonText: "Upgrade to Elite",
      endpoint: "/billing/change-plan",
      targetPlan: "ELITE",
    },
  },
  {
    name: "PRO active",
    plan: "PRO",
    creditCap: 1000,
    userCredits: 750,
    subscriptionStatus: "ACTIVE",
    trialExpiresAt: null,
    expectTrialBanner: false,
    expectTrialBadgeOnBilling: false,
    expectedBillingStatusLabel: "Active",
    lockedTools: [{ id: "story-video-maker", requiredPlan: "ELITE" }],
    upgradeClick: {
      buttonText: "Upgrade to Elite",
      endpoint: "/billing/change-plan",
      targetPlan: "ELITE",
    },
  },
  {
    name: "ELITE active",
    plan: "ELITE",
    creditCap: 5000,
    userCredits: 4800,
    subscriptionStatus: "ACTIVE",
    trialExpiresAt: null,
    expectTrialBanner: false,
    expectTrialBadgeOnBilling: false,
    expectedBillingStatusLabel: "Active",
    lockedTools: [],
  },
  {
    name: "PAST_DUE fallback",
    plan: "PRO",
    creditCap: 1000,
    userCredits: 920,
    subscriptionStatus: "PAST_DUE",
    trialExpiresAt: null,
    expectTrialBanner: false,
    expectTrialBadgeOnBilling: false,
    expectedBillingStatusLabel: "Past Due",
    lockedTools: [
      {
        id: "clipper",
        message: "Subscribe or update billing to unlock paid tools",
      },
      {
        id: "prompt",
        message: "Subscribe or update billing to unlock paid tools",
      },
      {
        id: "video-script",
        message: "Subscribe or update billing to unlock paid tools",
      },
      {
        id: "story-maker",
        message: "Subscribe or update billing to unlock paid tools",
      },
      {
        id: "story-video-maker",
        message: "Subscribe or update billing to unlock paid tools",
      },
    ],
    upgradeClick: {
      buttonText: "Upgrade to Pro",
      endpoint: "/billing/checkout",
      targetPlan: "PRO",
    },
  },
]

async function setupPersonaApiMocks(page: Page, persona: Persona) {
  let lastPlanMutation:
    | { endpoint: string; payload: Record<string, unknown> | null }
    | null = null

  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (path.endsWith("/api/auth/me")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "smoke-user",
            email: "smoke@example.com",
            role: "USER",
            plan: persona.plan,
            subscriptionStatus: persona.subscriptionStatus,
            credits: persona.userCredits,
            trialExpiresAt: persona.trialExpiresAt,
            createdAt: in7Days,
            updatedAt: in7Days,
          },
        }),
      })
      return
    }

    if (path.endsWith("/api/billing/subscription")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          subscription: {
            plan: persona.plan,
            subscriptionStatus: persona.subscriptionStatus,
            subscriptionStartedAt: in7Days,
            subscriptionEndsAt: in30Days,
            trialExpiresAt: persona.trialExpiresAt,
            cancelAtPeriodEnd: false,
          },
        }),
      })
      return
    }

    if (path.endsWith("/api/billing/entitlement")) {
      const freeTools = {
        generation: { allowed: true, blockedReason: null, minimumPlan: null, upgradeRequired: false },
        prompt: { allowed: false, blockedReason: "PLAN_UPGRADE_REQUIRED", minimumPlan: "STARTER", upgradeRequired: true },
        storyMaker: { allowed: false, blockedReason: "PLAN_UPGRADE_REQUIRED", minimumPlan: "PRO", upgradeRequired: true },
        clip: { allowed: false, blockedReason: "PLAN_UPGRADE_REQUIRED", minimumPlan: "STARTER", upgradeRequired: true },
        ads: { allowed: false, blockedReason: "PLAN_UPGRADE_REQUIRED", minimumPlan: "ELITE", upgradeRequired: true },
        admin: { allowed: false, blockedReason: "ADMIN_REQUIRED", minimumPlan: null, upgradeRequired: false },
      }
      const starterTools = {
        generation: { allowed: false, blockedReason: "PLAN_UPGRADE_REQUIRED", minimumPlan: "PRO", upgradeRequired: true },
        prompt: { allowed: true, blockedReason: null, minimumPlan: null, upgradeRequired: false },
        storyMaker: { allowed: false, blockedReason: "PLAN_UPGRADE_REQUIRED", minimumPlan: "PRO", upgradeRequired: true },
        clip: { allowed: true, blockedReason: null, minimumPlan: null, upgradeRequired: false },
        ads: { allowed: false, blockedReason: "PLAN_UPGRADE_REQUIRED", minimumPlan: "ELITE", upgradeRequired: true },
        admin: { allowed: false, blockedReason: "ADMIN_REQUIRED", minimumPlan: null, upgradeRequired: false },
      }
      const proTools = {
        generation: { allowed: true, blockedReason: null, minimumPlan: null, upgradeRequired: false },
        prompt: { allowed: true, blockedReason: null, minimumPlan: null, upgradeRequired: false },
        storyMaker: { allowed: true, blockedReason: null, minimumPlan: null, upgradeRequired: false },
        clip: { allowed: true, blockedReason: null, minimumPlan: null, upgradeRequired: false },
        ads: { allowed: false, blockedReason: "PLAN_UPGRADE_REQUIRED", minimumPlan: "ELITE", upgradeRequired: true },
        admin: { allowed: false, blockedReason: "ADMIN_REQUIRED", minimumPlan: null, upgradeRequired: false },
      }
      const eliteTools = {
        generation: { allowed: true, blockedReason: null, minimumPlan: null, upgradeRequired: false },
        prompt: { allowed: true, blockedReason: null, minimumPlan: null, upgradeRequired: false },
        storyMaker: { allowed: true, blockedReason: null, minimumPlan: null, upgradeRequired: false },
        clip: { allowed: true, blockedReason: null, minimumPlan: null, upgradeRequired: false },
        ads: { allowed: true, blockedReason: null, minimumPlan: null, upgradeRequired: false },
        admin: { allowed: false, blockedReason: "ADMIN_REQUIRED", minimumPlan: null, upgradeRequired: false },
      }
      const inactiveTools = {
        generation: { allowed: false, blockedReason: "SUBSCRIPTION_INACTIVE", minimumPlan: null, upgradeRequired: false },
        prompt: { allowed: false, blockedReason: "SUBSCRIPTION_INACTIVE", minimumPlan: null, upgradeRequired: false },
        storyMaker: { allowed: false, blockedReason: "SUBSCRIPTION_INACTIVE", minimumPlan: null, upgradeRequired: false },
        clip: { allowed: false, blockedReason: "SUBSCRIPTION_INACTIVE", minimumPlan: null, upgradeRequired: false },
        ads: { allowed: false, blockedReason: "SUBSCRIPTION_INACTIVE", minimumPlan: null, upgradeRequired: false },
        admin: { allowed: false, blockedReason: "ADMIN_REQUIRED", minimumPlan: null, upgradeRequired: false },
      }
      const isPaidTier = persona.plan !== "FREE"
      const isInactive =
        isPaidTier &&
        (persona.subscriptionStatus === "PAST_DUE" ||
          persona.subscriptionStatus === "CANCELED")
      const featureAccess = isInactive
        ? inactiveTools
        : persona.plan === "FREE"
          ? freeTools
          : persona.plan === "ELITE"
            ? eliteTools
            : persona.plan === "PRO"
              ? proTools
              : starterTools

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          entitlement: {
            plan: persona.plan,
            normalizedPlan: persona.plan,
            subscriptionStatus: persona.subscriptionStatus,
            isTrialActive:
              persona.subscriptionStatus === "TRIALING" && persona.plan === "PRO",
            trialExpiresAt: persona.trialExpiresAt,
            isPaid:
              persona.plan !== "FREE" &&
              (persona.subscriptionStatus === "ACTIVE" ||
                persona.subscriptionStatus === "TRIALING"),
            isUnlimited: false,
            creditsRemaining: persona.userCredits,
            blockedReason: isInactive ? "SUBSCRIPTION_INACTIVE" : null,
            upgradeRequired: false,
            minimumPlan: null,
            featureAccess,
          },
        }),
      })
      return
    }

    if (path.endsWith("/api/billing/invoices")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ invoices: [] }),
      })
      return
    }

    if (path.endsWith("/api/billing/change-plan") || path.endsWith("/api/billing/checkout")) {
      lastPlanMutation = {
        endpoint: path.replace(/^.*\/api/, ""),
        payload: request.postDataJSON() as Record<string, unknown> | null,
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      })
      return
    }

    if (path.endsWith("/api/billing/portal")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: null }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    })
  })

  return {
    getLastPlanMutation: () => lastPlanMutation,
  }
}

for (const persona of personas) {
  test(`monetization smoke - ${persona.name}`, async ({ page }) => {
    const mockState = await setupPersonaApiMocks(page, persona)

    await page.goto("/dashboard")
    if (persona.expectTrialBanner) {
      await expect(page.getByTestId("trial-banner")).toBeVisible()
      await expect(page.getByTestId("trial-countdown")).toContainText("Your PRO trial ends in")
      await expect(page.getByTestId("usage-bar")).toHaveCount(0)
    } else {
      await expect(page.getByTestId("usage-bar")).toBeVisible()
      const usageHeading =
        persona.plan === "FREE" ? "Free usage" : `${persona.plan} usage`
      await expect(page.getByTestId("usage-summary")).toContainText(usageHeading)
      await expect(page.getByTestId("usage-summary")).toContainText(`/${persona.creditCap} credits`)
      await expect(page.getByTestId("trial-banner")).toHaveCount(0)
    }

    await page.goto("/tools")
    for (const lock of persona.lockedTools) {
      await expect(page.getByTestId(`tool-lock-${lock.id}`)).toBeVisible()
      if (lock.requiredPlan) {
        await expect(page.getByTestId(`tool-required-plan-${lock.id}`)).toContainText(`Required: ${lock.requiredPlan}`)
      }
      if (lock.message) {
        await expect(page.getByTestId(`tool-lock-message-${lock.id}`)).toContainText(lock.message)
      }
    }

    const unlockedTools = ["clipper", "prompt", "video-script", "story-maker", "story-video-maker"]
      .filter((toolId) => !persona.lockedTools.some((lockedTool) => lockedTool.id === toolId))
    for (const toolId of unlockedTools) {
      await expect(page.getByTestId(`tool-lock-${toolId}`)).toHaveCount(0)
    }

    await page.goto("/dashboard/billing")
    await expect(page.getByTestId("billing-current-plan")).toContainText(
      new RegExp(`^${persona.plan}$`, "i")
    )
    await expect(page.getByTestId("billing-status")).toContainText(persona.expectedBillingStatusLabel)
    await expect(page.getByTestId("billing-monthly-limit")).toContainText(String(persona.creditCap))

    if (persona.expectTrialBadgeOnBilling) {
      await expect(page.getByText("Pro trial:", { exact: false })).toBeVisible()
    } else {
      await expect(page.getByText("Pro trial:", { exact: false })).toHaveCount(0)
    }

    if (persona.upgradeClick) {
      await page.getByRole("button", { name: persona.upgradeClick.buttonText }).click()
      await expect.poll(() => mockState.getLastPlanMutation()).not.toBeNull()
      const request = mockState.getLastPlanMutation()
      expect(request?.endpoint).toBe(persona.upgradeClick.endpoint)
      expect(request?.payload?.plan).toBe(persona.upgradeClick.targetPlan)
    }
  })
}
