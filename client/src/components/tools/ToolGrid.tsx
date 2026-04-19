"use client"

import Link from "next/link"
import { useState, type ComponentType } from "react"
import { useAuth } from "@/context/AuthContext"
import { tools } from "@/config/tools"
import { isFreePlan, planAllowsTool, type PlanToolId } from "@/lib/plans"
import { useEffectivePlan } from "@/hooks/useEffectivePlan"
import {
  formatBlockedReason,
  useEntitlementSnapshot,
} from "@/hooks/useEntitlementSnapshot"
import UpgradeModal from "@/components/growth/UpgradeModal"
import {
  Film,
  Wand2,
  Sparkles,
  Rocket,
  Scissors,
  Lock,
  ArrowRight,
} from "lucide-react"

type Tier = "free" | "starter" | "pro" | "elite"
type IconComponent = ComponentType<{ className?: string; size?: number | string }>

const iconMap: Record<string, IconComponent> = {
  "Video Script Engine": Film,
  "Prompt Intelligence": Wand2,
  "Story Maker": Sparkles,
  "AI Ad Generator": Rocket,
  "Ad Studio": Rocket,
  // Legacy title (older bundles / bookmarks)
  "Story Video Generator": Rocket,
  "Clipper Engine": Scissors,
}

export default function ToolGrid() {
  const { user } = useAuth()
  const uiPlan = useEffectivePlan()
  const { entitlement, loading: entitlementLoading } = useEntitlementSnapshot()
  const [upgradeModal, setUpgradeModal] = useState<{
    open: boolean
    requiredPlan?: string
    toolTitle?: string
    benefits?: string[]
  }>({ open: false })

  if (!user) return null

  const hasAccess = (toolId: PlanToolId, path: string) => {
    if (entitlement) {
      const featureMap: Record<string, boolean> = {
        "/dashboard/tools/video": entitlement.featureAccess.generation.allowed,
        "/dashboard/tools/prompt": entitlement.featureAccess.prompt.allowed,
        "/dashboard/tools/story-maker": entitlement.featureAccess.storyMaker.allowed,
        "/dashboard/tools/clipper": entitlement.featureAccess.clip.allowed,
        "/dashboard/tools/ai-ad-generator": entitlement.featureAccess.ads.allowed,
      }
      if (path in featureMap) return featureMap[path]
      return planAllowsTool(entitlement.normalizedPlan, toolId)
    }

    if (entitlementLoading) {
      return isFreePlan(uiPlan) ? planAllowsTool(uiPlan, toolId) : false
    }

    if (isFreePlan(uiPlan)) {
      return planAllowsTool(uiPlan, toolId)
    }
    const subscriptionActive =
      user.subscriptionStatus === "ACTIVE" || user.subscriptionStatus === "TRIALING"
    if (!subscriptionActive) return false
    return planAllowsTool(uiPlan, toolId)
  }

  const getBlockedMessage = (path: string): string => {
    if (!entitlement) {
      const def = tools.find((item) => item.path === path)
      const tid = def?.id as PlanToolId | undefined
      if (isFreePlan(uiPlan) && tid && planAllowsTool(uiPlan, tid)) {
        return "Loading access…"
      }
      if (isFreePlan(uiPlan)) {
        return "Upgrade to Starter to unlock this tool"
      }
      if (user.subscriptionStatus !== "ACTIVE" && user.subscriptionStatus !== "TRIALING") {
        return "Subscribe or update billing to unlock paid tools"
      }
      return "Plan upgrade required"
    }
    const messageMap: Record<string, string | null> = {
      "/dashboard/tools/video":
        formatBlockedReason(
          entitlement.featureAccess.generation.blockedReason,
          entitlement.featureAccess.generation.minimumPlan
        ),
      "/dashboard/tools/prompt":
        formatBlockedReason(
          entitlement.featureAccess.prompt.blockedReason,
          entitlement.featureAccess.prompt.minimumPlan
        ),
      "/dashboard/tools/story-maker":
        formatBlockedReason(
          entitlement.featureAccess.storyMaker.blockedReason,
          entitlement.featureAccess.storyMaker.minimumPlan
        ),
      "/dashboard/tools/clipper":
        formatBlockedReason(
          entitlement.featureAccess.clip.blockedReason,
          entitlement.featureAccess.clip.minimumPlan
        ),
      "/dashboard/tools/ai-ad-generator":
        formatBlockedReason(
          entitlement.featureAccess.ads.blockedReason,
          entitlement.featureAccess.ads.minimumPlan
        ),
    }
    if (path in messageMap) return messageMap[path] || "Access blocked"
    return "Plan upgrade required"
  }

  const getUnlockPlan = (path: string): string | null => {
    if (!entitlement) {
      const tool = tools.find((item) => item.path === path)
      if (!tool) return null
      if (tool.tier === "free") return "STARTER"
      if (tool.tier === "starter") return "STARTER"
      if (tool.tier === "pro") return "PRO"
      return "ELITE"
    }
    const planMap: Record<string, string | null> = {
      "/dashboard/tools/video": entitlement.featureAccess.generation.minimumPlan,
      "/dashboard/tools/prompt": entitlement.featureAccess.prompt.minimumPlan,
      "/dashboard/tools/story-maker": entitlement.featureAccess.storyMaker.minimumPlan,
      "/dashboard/tools/clipper": entitlement.featureAccess.clip.minimumPlan,
      "/dashboard/tools/ai-ad-generator": entitlement.featureAccess.ads.minimumPlan,
    }
    return path in planMap ? planMap[path] : null
  }

  const tierStyles: Record<Tier, string> = {
    free: "bg-sky-500/10 text-sky-300 border-sky-500/25",
    starter: "bg-green-500/10 text-green-400 border-green-500/20",
    pro: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    elite: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  }

  return (
    <>
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-10">
      {tools.map((tool, index) => {
        const locked = !hasAccess(tool.id, tool.path)
        const Icon = iconMap[tool.title] || Sparkles
        const currentTier = tool.tier.toLowerCase() as Tier
        const blockedMessage = getBlockedMessage(tool.path)
        const unlockPlan = getUnlockPlan(tool.path)
        const destination = locked ? "/pricing" : tool.path

        return (
          <div key={tool.title} data-testid={`tool-card-${tool.id}`} className="relative group">
            <Link
              href={destination}
              onClick={(e) => {
                if (!locked) return
                e.preventDefault()
                const required =
                  unlockPlan ||
                  (tool.tier === "free"
                    ? "STARTER"
                    : tool.tier === "starter"
                      ? "STARTER"
                      : tool.tier === "pro"
                        ? "PRO"
                        : "ELITE")
                const benefitsMap: Record<string, string[]> = {
                  "/dashboard/tools/prompt": [
                    "Faster prompt iteration workflow",
                    "Expanded quality controls",
                  ],
                  "/dashboard/tools/story-maker": [
                    "Narrative scripting at scale",
                    "More output capacity per cycle",
                  ],
                  "/dashboard/tools/clipper": [
                    "Access clipping workflows",
                    "High-retention repurposing pipeline",
                  ],
                  "/dashboard/tools/ai-ad-generator": [
                    "AI Ad Generator: auto video ads — script, VO, visuals, captions",
                    "Scored variants and dual renders for faster creative tests",
                  ],
                }
                setUpgradeModal({
                  open: true,
                  requiredPlan: required,
                  toolTitle: tool.title,
                  benefits: benefitsMap[tool.path] || ["Unlock this feature"],
                })
              }}
              className={`
                relative rounded-3xl border border-white/10 p-8
                bg-white/[0.04] backdrop-blur-xl
                transition-all duration-300
                hover:-translate-y-2
                hover:shadow-[0_0_60px_rgba(139,92,246,0.2)]
                block
              `}
            >
              {/* Recommended Tag */}
              {index === 0 && !locked && (
                <div className="absolute top-4 left-4 text-xs px-3 py-1 rounded-full bg-purple-500/20 text-purple-400 font-medium">
                  ✨ Recommended
                </div>
              )}

              {/* Tier Badge */}
              <div
                className={`absolute top-4 right-4 text-xs px-3 py-1 rounded-full border ${tierStyles[currentTier] || tierStyles.starter}`}
              >
                {tool.tier.toUpperCase()}
              </div>
              {currentTier === "elite" && (
                <div className="absolute top-12 right-4 rounded-full border border-pink-500/30 bg-pink-500/15 px-2 py-0.5 text-[10px] text-pink-200">
                  Elite feature
                </div>
              )}

              {/* Icon Container */}
              <div className="w-16 h-16 flex items-center justify-center rounded-2xl bg-black/40 border border-white/10 mb-6 group-hover:scale-105 transition">
                <Icon className="w-8 h-8 text-white/80 group-hover:text-white transition" />
              </div>

              {/* Text Content */}
              <h3 className="text-xl font-semibold text-white">{tool.title}</h3>
              <p className="text-sm text-white/60 mt-3 leading-relaxed">
                {tool.description}
              </p>
              <p className="mt-3 text-xs text-white/45">
                Outcome: {tool.outcome}
              </p>

              {/* Launch Action */}
              {!locked && (
                <div className="mt-8 flex items-center gap-2 text-sm font-semibold text-purple-400 group-hover:text-pink-400 transition">
                  Launch Tool
                  <ArrowRight
                    size={16}
                    className="group-hover:translate-x-1 transition-transform"
                  />
                </div>
              )}
            </Link>

            {/* Lock Overlay */}
            {locked && (
              <div data-testid={`tool-lock-${tool.id}`} className="absolute inset-0 rounded-3xl flex flex-col items-center justify-center bg-black/70 backdrop-blur-md text-center px-6 pointer-events-none">
                <Lock className="mb-4 opacity-80 text-white" />
                <p data-testid={`tool-lock-message-${tool.id}`} className="text-sm font-semibold text-white mb-2">
                  {blockedMessage}
                </p>
                {unlockPlan && (
                  <p data-testid={`tool-required-plan-${tool.id}`} className="text-xs text-white/55">
                    Current: {uiPlan} • Required: {unlockPlan}
                  </p>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setUpgradeModal({
                      open: true,
                      requiredPlan: unlockPlan || "PRO",
                      toolTitle: tool.title,
                      benefits: [
                        "Unlock this tool instantly",
                        "Increase limits and output capacity",
                      ],
                    })
                  }}
                  className="mt-2 text-xs px-4 py-2 rounded-full bg-gradient-to-r from-purple-500 to-pink-600 text-white hover:opacity-90 transition pointer-events-auto"
                >
                  Upgrade Now
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
    <UpgradeModal
      open={upgradeModal.open}
      onClose={() => setUpgradeModal({ open: false })}
      title={upgradeModal.toolTitle ? `${upgradeModal.toolTitle} requires upgrade` : "Plan upgrade required"}
      message="This tool is locked on your current plan."
      currentPlan={uiPlan}
      requiredPlan={upgradeModal.requiredPlan}
      benefits={upgradeModal.benefits}
    />
    </>
  )
}