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
      "From one brief: multiple hook-led scripts, captions, and tags tuned for short-form.",
    outcome: "Post-ready script variations you can record or hand to an editor today",
    path: "/dashboard/tools/video",
    tier: "free",
    category: "content",
  },
  {
    id: "prompt",
    title: "Prompt Intelligence",
    description:
      "Preset-driven prompt packs — same structure every time, tuned for platform and style.",
    outcome: "Four strategic prompt variants + improve passes — paste into any AI or Video Script",
    path: "/dashboard/tools/prompt",
    tier: "starter",
    category: "content",
  },
  {
    id: "story-maker",
    title: "Story Maker",
    description:
      "Narrative arcs with hook, build, payoff, and CTA — plus caption and hashtags.",
    outcome: "A story script you can shoot or adapt without restructuring in your head",
    path: "/dashboard/tools/story-maker",
    tier: "pro",
    category: "story",
  },
  {
    id: "story-video-maker",
    title: "AI Ad Generator",
    description:
      "URL in — finished vertical ad out: script, VO, visuals, captions, scored variants.",
    outcome: "A ready-to-post MP4 plus creative angles to test in ads",
    path: "/dashboard/tools/ai-ad-generator",
    tier: "elite",
    category: "production",
  },
  {
    id: "clipper",
    title: "Clipper Engine",
    description:
      "Long video in — best moments out: ranked, trimmed, with titles and captions.",
    outcome: "A prioritized clip list so you edit the winners first",
    path: "/dashboard/tools/clipper",
    tier: "starter",
    category: "content",
  },
]
