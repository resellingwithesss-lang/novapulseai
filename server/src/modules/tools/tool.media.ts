export type ToolMediaOutput = {
  publicPath: string
  durationSec?: number
  preset?: string
  qualityScore?: number
}

export function buildMediaOutput(
  input: ToolMediaOutput
): ToolMediaOutput {
  return {
    publicPath: input.publicPath,
    durationSec: input.durationSec,
    preset: input.preset,
    qualityScore: input.qualityScore,
  }
}
