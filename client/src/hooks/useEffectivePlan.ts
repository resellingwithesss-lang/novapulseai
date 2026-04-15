"use client"

import { useMemo } from "react"
import { useAuth } from "@/context/AuthContext"
import { displayPlanForUser, type UiPlan } from "@/lib/plans"

/** Session plan tier with ADMIN / SUPER_ADMIN floor (matches server `staffFloorPlan`). */
export function useEffectivePlan(): UiPlan {
  const { user } = useAuth()
  return useMemo(
    () => displayPlanForUser(user?.plan, user?.role),
    [user?.plan, user?.role]
  )
}
