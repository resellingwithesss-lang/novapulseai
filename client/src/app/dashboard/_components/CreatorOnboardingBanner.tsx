"use client"

import { useState } from "react"
import {
  readOnboardingProfile,
  writeOnboardingProfile,
} from "@/lib/onboardingProfile"

export default function CreatorOnboardingBanner({
  onCompleted,
}: {
  onCompleted: () => void
}) {
  const existing = readOnboardingProfile()
  const [creatorType, setCreatorType] = useState(existing?.creatorType ?? "")
  const [platform, setPlatform] = useState(existing?.primaryPlatform ?? "")
  const [goal, setGoal] = useState(existing?.goal ?? "")

  const save = () => {
    writeOnboardingProfile({
      completed: true,
      creatorType: creatorType || undefined,
      primaryPlatform: platform || undefined,
      goal: goal || undefined,
      completedAt: Date.now(),
    })
    onCompleted()
  }

  const skip = () => {
    writeOnboardingProfile({
      completed: true,
      completedAt: Date.now(),
    })
    onCompleted()
  }

  return (
    <section className="rounded-2xl border border-violet-400/22 bg-gradient-to-br from-violet-950/35 via-[#0a0d18]/90 to-black/50 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ring-1 ring-inset ring-white/[0.03]">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-purple-200/72">
            Quick setup
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.018em] text-white/[0.97]">
            Tune NovaPulseAI to how you actually ship content
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-white/50">
            Three answers help us surface the right next actions and templates. You can change this anytime
            (we&apos;ll add profile settings later).
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={skip}
            className="rounded-full border border-white/[0.14] bg-white/[0.03] px-4 py-2 text-xs font-medium text-white/62 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition-[background-color,border-color,color] hover:border-white/22 hover:bg-white/[0.06] hover:text-white/80 focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
          >
            Skip
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <label className="block text-xs font-medium text-white/48">
          Creator type
          <select
            value={creatorType}
            onChange={(e) => setCreatorType(e.target.value)}
            className="np-select mt-1.5 w-full"
          >
            <option value="">Select…</option>
            <option value="solo">Solo creator</option>
            <option value="agency">Agency / operator</option>
            <option value="brand">Brand / founder</option>
            <option value="faceless">Faceless / automation channel</option>
          </select>
        </label>
        <label className="block text-xs font-medium text-white/48">
          Primary platform
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="np-select mt-1.5 w-full"
          >
            <option value="">Select…</option>
            <option value="tiktok">TikTok</option>
            <option value="reels">Instagram Reels</option>
            <option value="shorts">YouTube Shorts</option>
            <option value="multi">Cross-posting</option>
          </select>
        </label>
        <label className="block text-xs font-medium text-white/48">
          Main goal
          <select
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="np-select mt-1.5 w-full"
          >
            <option value="">Select…</option>
            <option value="growth">Audience growth</option>
            <option value="leads">Leads / sales</option>
            <option value="authority">Authority / education</option>
            <option value="ads">Paid ads & creatives</option>
          </select>
        </label>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={save}
          className="rounded-full bg-gradient-to-r from-purple-500 to-pink-600 px-6 py-2.5 text-sm font-semibold tracking-[-0.01em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] outline-none transition-[opacity] hover:opacity-[0.97] focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19] active:opacity-[0.93]"
        >
          Save & go to dashboard
        </button>
        <a
          href="/dashboard/tools/video"
          className="inline-flex items-center rounded-full border border-white/[0.14] bg-white/[0.035] px-5 py-2.5 text-sm font-medium tracking-[-0.01em] text-white/84 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] outline-none transition-[background-color,border-color] hover:border-white/22 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f19]"
        >
          Jump straight to scripts →
        </a>
      </div>
    </section>
  )
}
