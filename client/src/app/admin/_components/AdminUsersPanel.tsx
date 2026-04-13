"use client"

import { getPlanCredits, normalizePlan, type UiPlan } from "@/lib/plans"

type User = {
  id: string
  email: string
  plan: string
  subscriptionStatus: string
  credits: number
  banned: boolean
  createdAt: string
}

type AdminUsersPanelProps = {
  users: User[]
  actionLoading: string | null
  powerMode: boolean
  onUpdatePlan: (id: string, plan: UiPlan) => void
  onAdjustCredits: (id: string, amount: number) => void
  onToggleBan: (id: string, banned: boolean) => void
  onDeleteUser: (id: string) => void
}

export default function AdminUsersPanel({
  users,
  actionLoading,
  powerMode,
  onUpdatePlan,
  onAdjustCredits,
  onToggleBan,
  onDeleteUser,
}: AdminUsersPanelProps) {
  return (
    <div className="space-y-5">
      {users.map((user) => {
        const plan = normalizePlan(user.plan)
        const accountAgeDays = Math.floor(
          (Date.now() - new Date(user.createdAt).getTime()) / 86400000
        )

        const overLimit = user.credits > getPlanCredits(plan) * 2
        const riskScore =
          (user.banned ? 40 : 0) +
          (overLimit ? 30 : 0) +
          (accountAgeDays < 2 ? 20 : 0)

        return (
          <div
            key={user.id}
            className={`border rounded-2xl p-6 backdrop-blur-xl flex flex-col md:flex-row md:justify-between gap-6 ${
              riskScore > 40
                ? "bg-red-900/10 border-red-500/40"
                : "bg-white/[0.04] border-white/10"
            }`}
          >
            <div>
              <div className="font-semibold text-lg flex items-center gap-3">
                {user.email}
                {riskScore > 40 && (
                  <span className="text-xs bg-red-600 px-2 py-1 rounded-full">
                    High Risk
                  </span>
                )}
              </div>

              <div className="mt-3 text-sm text-white/60">
                Plan: {plan} | Status: {user.subscriptionStatus} | Credits: {user.credits.toLocaleString()} |{" "}
                {accountAgeDays} days old
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <select
                value={plan}
                onChange={(e) =>
                  onUpdatePlan(user.id, e.target.value as UiPlan)
                }
                disabled={actionLoading === user.id}
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm"
              >
                <option value="FREE">FREE</option>
                <option value="STARTER">STARTER</option>
                <option value="PRO">PRO</option>
                <option value="ELITE">ELITE</option>
              </select>

              <button
                onClick={() => onAdjustCredits(user.id, 10)}
                disabled={actionLoading === user.id}
                className="px-3 py-2 bg-purple-600 rounded-lg text-sm"
              >
                +10
              </button>

              <button
                onClick={() => onAdjustCredits(user.id, -10)}
                disabled={actionLoading === user.id}
                className="px-3 py-2 bg-yellow-600 rounded-lg text-sm"
              >
                -10
              </button>

              <button
                onClick={() => onToggleBan(user.id, user.banned)}
                disabled={actionLoading === user.id}
                className="px-3 py-2 bg-orange-600 rounded-lg text-sm"
              >
                {user.banned ? "Unban" : "Ban"}
              </button>

              {powerMode && (
                <button
                  onClick={() => onDeleteUser(user.id)}
                  disabled={actionLoading === user.id}
                  className="px-3 py-2 bg-red-600 rounded-lg text-sm"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
