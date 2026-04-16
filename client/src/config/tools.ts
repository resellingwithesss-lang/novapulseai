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
    description: "Generate scroll-stopping hooks, structured scripts, captions, and tags.",
    outcome: "3 ready-to-publish script variations",
    path: "/dashboard/tools/video",
    tier: "free",
    category: "content",
  },
  {
    id: "prompt",
    title: "Prompt Intelligence",
    description: "Build reusable prompt templates locally for your content workflow.",
    outcome: "Structured prompt template ready to use in downstream tools",
    path: "/dashboard/tools/prompt",
    tier: "starter",
    category: "content",
  },
  {
    id: "story-maker",
    title: "Story Maker",
    description: "Turn raw ideas into structured story scripts with retention pacing.",
    outcome: "Narrative-ready scripts with hooks and breakdown",
    path: "/dashboard/tools/story-maker",
    tier: "pro",
    category: "story",
  },
  {
    id: "story-video-maker",
    title: "Story Video Generator",
    description: "Generate conversion-focused ad videos from your website and offer.",
    outcome: "Rendered ad video with downloadable output",
    path: "/dashboard/tools/story-video-maker",
    tier: "elite",
    category: "production",
  },
  {
    id: "clipper",
    title: "Clipper Engine",
    description: "Extract and rank high-retention moments from long-form source videos.",
    outcome: "Ranked short clips ready for repurposing",
    path: "/dashboard/tools/clipper",
    tier: "starter",
    category: "content",
  },
]
