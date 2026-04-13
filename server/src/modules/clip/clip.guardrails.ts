type DurationGuardrailInput = {
  durationSec: number
  requestedClips: number
  minClipDurationSec: number
}

export function validateClipDurationGuardrail(input: DurationGuardrailInput) {
  const minimumSourceDuration = Math.max(
    input.minClipDurationSec + 2,
    Math.round(input.requestedClips * (input.minClipDurationSec * 0.72))
  )
  const allowed = input.durationSec >= minimumSourceDuration
  return {
    allowed,
    minimumSourceDuration,
  }
}

export function validateClipCountGuardrail(
  requestedClips: number,
  selectedClips: number
) {
  return {
    allowed: selectedClips >= requestedClips,
  }
}
