import test from "node:test"
import assert from "node:assert/strict"

import {
  isOwnerRole,
  isAdminOrAboveRole,
  isStaffRole,
  OWNER_ROLES,
  ADMIN_OR_ABOVE_ROLES,
} from "../../lib/roles"
import {
  isStaffBillingExemptRole,
  staffFloorPlan,
  staffEffectivePlanString,
} from "../../lib/staff-plan"
import { buildEntitlementSnapshot } from "../../modules/billing/billing.access"
import {
  requireAdmin,
  requireOwner,
  requireSuperAdmin,
} from "../../modules/auth/admin.middleware"

/* ---------------------------------------------------------------------------
 * Test helpers
 * -------------------------------------------------------------------------*/

type MockResponse = {
  status(code: number): MockResponse
  json(body: unknown): MockResponse
  readonly statusCode: number | undefined
  readonly body: unknown
}

function mockRes(): MockResponse {
  let statusCode: number | undefined
  let body: unknown = undefined
  const res: MockResponse = {
    status(code: number) {
      statusCode = code
      return res
    },
    json(b: unknown) {
      body = b
      return res
    },
    get statusCode() {
      return statusCode
    },
    get body() {
      return body
    },
  }
  return res
}

type MiddlewareFn = (req: unknown, res: unknown, next: () => void) => void

function runMiddleware(
  mw: MiddlewareFn,
  role: string | null
): { status: number | undefined; called: boolean; body: unknown } {
  let called = false
  const req = { user: role === null ? undefined : { role } }
  const res = mockRes()
  mw(req, res, () => {
    called = true
  })
  return { status: res.statusCode, called, body: res.body }
}

/* ---------------------------------------------------------------------------
 * Helper predicates
 * -------------------------------------------------------------------------*/

test("OWNER_ROLES contains exactly OWNER and SUPER_ADMIN", () => {
  assert.deepEqual([...OWNER_ROLES].sort(), ["OWNER", "SUPER_ADMIN"].sort())
})

test("ADMIN_OR_ABOVE_ROLES contains ADMIN, OWNER, SUPER_ADMIN", () => {
  assert.deepEqual(
    [...ADMIN_OR_ABOVE_ROLES].sort(),
    ["ADMIN", "OWNER", "SUPER_ADMIN"].sort()
  )
})

test("isOwnerRole recognises OWNER and legacy SUPER_ADMIN, rejects others", () => {
  assert.equal(isOwnerRole("OWNER"), true)
  assert.equal(isOwnerRole("SUPER_ADMIN"), true)
  assert.equal(isOwnerRole("ADMIN"), false)
  assert.equal(isOwnerRole("CREATOR"), false)
  assert.equal(isOwnerRole("USER"), false)
  assert.equal(isOwnerRole(null), false)
  assert.equal(isOwnerRole(undefined), false)
  assert.equal(isOwnerRole(""), false)
})

test("isAdminOrAboveRole accepts ADMIN, OWNER, SUPER_ADMIN; rejects USER and CREATOR", () => {
  assert.equal(isAdminOrAboveRole("ADMIN"), true)
  assert.equal(isAdminOrAboveRole("OWNER"), true)
  assert.equal(isAdminOrAboveRole("SUPER_ADMIN"), true)
  assert.equal(isAdminOrAboveRole("CREATOR"), false)
  assert.equal(isAdminOrAboveRole("USER"), false)
  assert.equal(isAdminOrAboveRole(null), false)
})

test("isStaffRole is the same predicate as isAdminOrAboveRole", () => {
  assert.strictEqual(isStaffRole, isAdminOrAboveRole)
})

/* ---------------------------------------------------------------------------
 * Staff-floor / billing-exempt
 * -------------------------------------------------------------------------*/

test("isStaffBillingExemptRole includes OWNER and SUPER_ADMIN and ADMIN", () => {
  assert.equal(isStaffBillingExemptRole("OWNER"), true)
  assert.equal(isStaffBillingExemptRole("SUPER_ADMIN"), true)
  assert.equal(isStaffBillingExemptRole("ADMIN"), true)
  assert.equal(isStaffBillingExemptRole("CREATOR"), false)
  assert.equal(isStaffBillingExemptRole("USER"), false)
})

test("staffFloorPlan floors OWNER to ELITE regardless of dbPlan", () => {
  for (const plan of ["FREE", "STARTER", "PRO"] as const) {
    assert.equal(
      staffFloorPlan(plan as never, "OWNER"),
      "ELITE",
      `OWNER on ${plan} should floor to ELITE`
    )
  }
  assert.equal(staffFloorPlan("ELITE" as never, "OWNER"), "ELITE")
})

test("staffFloorPlan does not floor CREATOR or USER", () => {
  assert.equal(staffFloorPlan("FREE" as never, "CREATOR"), "FREE")
  assert.equal(staffFloorPlan("FREE" as never, "USER"), "FREE")
  assert.equal(staffFloorPlan("STARTER" as never, "CREATOR"), "STARTER")
})

test("staffEffectivePlanString mirrors staffFloorPlan for OWNER", () => {
  assert.equal(staffEffectivePlanString("FREE", "OWNER"), "ELITE")
  assert.equal(staffEffectivePlanString("FREE", "SUPER_ADMIN"), "ELITE")
  assert.equal(staffEffectivePlanString("FREE", "USER"), "FREE")
  assert.equal(staffEffectivePlanString("FREE", "CREATOR"), "FREE")
})

/* ---------------------------------------------------------------------------
 * Entitlement snapshot (admin-feature gate)
 * -------------------------------------------------------------------------*/

test("buildEntitlementSnapshot grants admin feature for OWNER and floors plan to ELITE", () => {
  const snap = buildEntitlementSnapshot({
    plan: "FREE",
    subscriptionStatus: "CANCELED",
    trialExpiresAt: null,
    banned: false,
    credits: 0,
    role: "OWNER",
  })
  assert.equal(snap.featureAccess.admin.allowed, true)
  assert.equal(snap.featureAccess.admin.blockedReason, null)
  assert.equal(snap.normalizedPlan, "ELITE")
  assert.equal(snap.isPaid, true)
})

test("buildEntitlementSnapshot grants admin feature for legacy SUPER_ADMIN", () => {
  const snap = buildEntitlementSnapshot({
    plan: "FREE",
    subscriptionStatus: "CANCELED",
    trialExpiresAt: null,
    banned: false,
    credits: 0,
    role: "SUPER_ADMIN",
  })
  assert.equal(snap.featureAccess.admin.allowed, true)
  assert.equal(snap.normalizedPlan, "ELITE")
})

test("buildEntitlementSnapshot denies admin feature for USER and CREATOR", () => {
  for (const role of ["USER", "CREATOR"]) {
    const snap = buildEntitlementSnapshot({
      plan: "FREE",
      subscriptionStatus: "CANCELED",
      trialExpiresAt: null,
      banned: false,
      credits: 0,
      role,
    })
    assert.equal(
      snap.featureAccess.admin.allowed,
      false,
      `admin feature should be blocked for ${role}`
    )
    assert.equal(snap.featureAccess.admin.blockedReason, "ADMIN_REQUIRED")
  }
})

test("CREATOR does not accidentally unlock paid tools (behaves identically to USER)", () => {
  const creatorSnap = buildEntitlementSnapshot({
    plan: "FREE",
    subscriptionStatus: "CANCELED",
    trialExpiresAt: null,
    banned: false,
    credits: 0,
    role: "CREATOR",
  })
  const userSnap = buildEntitlementSnapshot({
    plan: "FREE",
    subscriptionStatus: "CANCELED",
    trialExpiresAt: null,
    banned: false,
    credits: 0,
    role: "USER",
  })
  assert.equal(creatorSnap.normalizedPlan, userSnap.normalizedPlan)
  assert.equal(creatorSnap.isPaid, userSnap.isPaid)
  assert.equal(
    creatorSnap.featureAccess.clip.allowed,
    userSnap.featureAccess.clip.allowed
  )
  assert.equal(
    creatorSnap.featureAccess.storyMaker.allowed,
    userSnap.featureAccess.storyMaker.allowed
  )
  assert.equal(
    creatorSnap.featureAccess.ads.allowed,
    userSnap.featureAccess.ads.allowed
  )
})

/* ---------------------------------------------------------------------------
 * Middleware: requireAdmin
 * -------------------------------------------------------------------------*/

test("requireAdmin accepts ADMIN, OWNER, SUPER_ADMIN", () => {
  for (const role of ["ADMIN", "OWNER", "SUPER_ADMIN"]) {
    const result = runMiddleware(requireAdmin as unknown as MiddlewareFn, role)
    assert.equal(result.called, true, `next() should run for role=${role}`)
    assert.equal(result.status, undefined, `no status set for role=${role}`)
  }
})

test("requireAdmin rejects USER and CREATOR with 403", () => {
  for (const role of ["USER", "CREATOR"]) {
    const result = runMiddleware(requireAdmin as unknown as MiddlewareFn, role)
    assert.equal(result.called, false, `next() should NOT run for role=${role}`)
    assert.equal(result.status, 403, `403 expected for role=${role}`)
  }
})

test("requireAdmin returns 401 when no user is attached", () => {
  const result = runMiddleware(requireAdmin as unknown as MiddlewareFn, null)
  assert.equal(result.called, false)
  assert.equal(result.status, 401)
})

/* ---------------------------------------------------------------------------
 * Middleware: requireOwner (and its deprecated alias)
 * -------------------------------------------------------------------------*/

test("requireOwner accepts OWNER and SUPER_ADMIN", () => {
  for (const role of ["OWNER", "SUPER_ADMIN"]) {
    const result = runMiddleware(requireOwner as unknown as MiddlewareFn, role)
    assert.equal(result.called, true, `next() should run for role=${role}`)
  }
})

test("requireOwner rejects ADMIN, CREATOR, USER with 403", () => {
  for (const role of ["ADMIN", "CREATOR", "USER"]) {
    const result = runMiddleware(requireOwner as unknown as MiddlewareFn, role)
    assert.equal(result.called, false, `next() should NOT run for role=${role}`)
    assert.equal(result.status, 403, `403 expected for role=${role}`)
  }
})

test("requireOwner returns 401 when no user is attached", () => {
  const result = runMiddleware(requireOwner as unknown as MiddlewareFn, null)
  assert.equal(result.called, false)
  assert.equal(result.status, 401)
})

test("requireSuperAdmin alias is identical to requireOwner (same function reference)", () => {
  // The alias must be the exact same function so call-sites using the old name
  // get the new OWNER-inclusive behaviour without any second code path.
  assert.strictEqual(requireSuperAdmin, requireOwner)
})

test("requireSuperAdmin (alias) accepts OWNER and SUPER_ADMIN, rejects ADMIN", () => {
  assert.equal(
    runMiddleware(requireSuperAdmin as unknown as MiddlewareFn, "OWNER").called,
    true
  )
  assert.equal(
    runMiddleware(requireSuperAdmin as unknown as MiddlewareFn, "SUPER_ADMIN").called,
    true
  )
  assert.equal(
    runMiddleware(requireSuperAdmin as unknown as MiddlewareFn, "ADMIN").status,
    403
  )
})
