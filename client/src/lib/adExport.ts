/** Filenames for ad render exports (human-readable, filesystem-safe). */

export function buildAdVideoFilename(jobId: string, rank?: number): string {
  const raw = jobId.trim() || "render"
  const compact = raw.replace(/[^a-zA-Z0-9]/g, "").slice(0, 14) || "ad"
  const r = typeof rank === "number" ? `-r${rank}` : ""
  return `NovaPulseAI-Ad-${compact}${r}.mp4`
}
