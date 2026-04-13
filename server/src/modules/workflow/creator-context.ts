import type { BrandVoice, Workspace } from "@prisma/client"
import type { PrismaClient } from "@prisma/client"

export type CreatorContextLoadResult =
  | { ok: true; workspace: Workspace | null; brandVoice: BrandVoice | null }
  | { ok: false; code: "NOT_FOUND" | "BRAND_VOICE_WORKSPACE_MISMATCH" }

function bannedPhrasesToLines(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean)
      .slice(0, 40)
  }
  return []
}

export function formatCreatorContextForPrompt(
  workspace: Workspace | null,
  brandVoice: BrandVoice | null
): string {
  const blocks: string[] = []
  if (workspace) {
    const lines = [
      workspace.niche && `Niche / vertical: ${workspace.niche}`,
      workspace.targetAudience && `Target audience: ${workspace.targetAudience}`,
      workspace.primaryPlatforms?.length &&
        `Primary platforms: ${workspace.primaryPlatforms.join(", ")}`,
      workspace.contentGoals?.length &&
        `Content goals: ${workspace.contentGoals.join(", ")}`,
      workspace.defaultCtaStyle && `Default CTA style: ${workspace.defaultCtaStyle}`,
    ].filter(Boolean) as string[]
    if (lines.length) {
      blocks.push(`Workspace context:\n${lines.join("\n")}`)
    }
  }
  if (brandVoice) {
    const banned = bannedPhrasesToLines(brandVoice.bannedPhrases)
    const lines = [
      brandVoice.tone && `Brand tone: ${brandVoice.tone}`,
      brandVoice.pacing && `Pacing: ${brandVoice.pacing}`,
      brandVoice.slangLevel && `Slang / informality: ${brandVoice.slangLevel}`,
      brandVoice.ctaStyle && `CTA style: ${brandVoice.ctaStyle}`,
      brandVoice.audienceSophistication &&
        `Audience sophistication: ${brandVoice.audienceSophistication}`,
      brandVoice.notes && `Brand notes: ${brandVoice.notes}`,
      banned.length && `Banned phrases (never use): ${banned.join("; ")}`,
    ].filter(Boolean) as string[]
    if (lines.length) {
      blocks.push(`Brand voice:\n${lines.join("\n")}`)
    }
  }
  return blocks.join("\n\n")
}

export async function loadCreatorContextAttachments(
  prisma: PrismaClient,
  userId: string,
  opts: { workspaceId?: string | null; brandVoiceId?: string | null }
): Promise<CreatorContextLoadResult> {
  let workspace: Workspace | null = null
  let brandVoice: BrandVoice | null = null

  if (opts.workspaceId) {
    workspace = await prisma.workspace.findFirst({
      where: { id: opts.workspaceId, userId },
    })
    if (!workspace) return { ok: false, code: "NOT_FOUND" }
  }

  if (opts.brandVoiceId) {
    brandVoice = await prisma.brandVoice.findFirst({
      where: { id: opts.brandVoiceId, userId },
    })
    if (!brandVoice) return { ok: false, code: "NOT_FOUND" }
    if (
      workspace &&
      brandVoice.workspaceId &&
      brandVoice.workspaceId !== workspace.id
    ) {
      return { ok: false, code: "BRAND_VOICE_WORKSPACE_MISMATCH" }
    }
  }

  return { ok: true, workspace, brandVoice }
}
