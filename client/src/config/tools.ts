export type ToolTier = "free" | "starter" | "pro" | "elite"
export type ToolId =
  | "video-script"
  | "prompt"
  | "story-maker"
  | "story-video-maker"
  | "clipper"

export interface ToolDefinition {
  id: ToolId
  title: string
  description: string
  outcome: string
  path: string
  tier: ToolTier
  category: "content" | "story" | "production"
}

export const tools: ToolDefinition[] = [
  {
    id: "video-script",
    title: "Video Script Engine",
    description:
      "Turn a brief into hooks, full short-form scripts, captions, and tags—built to post, not to reread.",
    outcome: "Pack of on-brand script variations ready for your next posts",
    path: "/dashboard/tools/video",
    tier: "free",
    category: "content",
  },
  {
    id: "prompt",
    title: "Prompt Intelligence",
    description:
      "Encode what works: reusable prompt frameworks you can hand to scripts, clips, and packs.",
    outcome: "A prompt system you can reuse across the stack",
    path: "/dashboard/tools/prompt",
    tier: "starter",
    category: "content",
  },
  {
    id: "story-maker",
    title: "Story Maker",
    description:
      "Shape ideas into retention-aware story scripts—hook, build, payoff, CTA—before you hit record.",
    outcome: "Story-ready script with pacing notes you can shoot or adapt",
    path: "/dashboard/tools/story-maker",
    tier: "pro",
    category: "story",
  },
  {
    id: "story-video-maker",
    title: "AI Ad Generator",
    description:
      "Elite: auto video ads from your URL — AI script, voiceover, visuals, subtitles, scored variants. No filming.",
    outcome: "Ready-to-post MP4 plus angles you can iterate",
    path: "/dashboard/tools/story-video-maker",
    tier: "elite",
    category: "production",
  },
  {
    id: "clipper",
    title: "Clipper Engine",
    description:
      "Pull the highest-retention moments from long-form—ranked, titled, ready to cut and post.",
    outcome: "Shortlist of clips worth your edit time",
    path: "/dashboard/tools/clipper",
    tier: "starter",
    category: "content",
  },
]
