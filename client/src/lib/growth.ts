"use client"

export type ToolKey = "video" | "story-maker" | "clipper" | "story-video-maker" | "prompt"

export type OutputHistoryItem = {
  id: string
  tool: ToolKey
  title: string
  summary?: string
  createdAt: number
  continuePath?: string
  nextAction?: string
  /** Pinned items surface at top of local “Continue” list */
  pinned?: boolean
}

export type EmailReadyEvent = {
  id: string
  type: "TRIAL_ENDING_SOON" | "CREDITS_LOW" | "OUTPUT_CREATED"
  createdAt: number
  payload: Record<string, unknown>
}

const USAGE_KEY = "vf:growth:usage"
const OUTPUT_KEY = "vf:growth:outputs"
const EMAIL_EVENT_KEY = "vf:growth:email-events"
const EMAIL_EVENT_INDEX_KEY = "vf:growth:email-events:index"

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage failures in growth helpers.
  }
}

export function getTrialCountdown(trialExpiresAt?: string | null) {
  if (!trialExpiresAt) return null
  const msLeft = new Date(trialExpiresAt).getTime() - Date.now()
  if (msLeft <= 0) return { msLeft: 0, days: 0, hours: 0 }
  const days = Math.floor(msLeft / (1000 * 60 * 60 * 24))
  const hours = Math.floor((msLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  return { msLeft, days, hours }
}

export function getTrialUrgency(
  trialExpiresAt?: string | null
): "soft" | "strong" | "critical" | null {
  const countdown = getTrialCountdown(trialExpiresAt)
  if (!countdown) return null
  if (countdown.msLeft <= 1000 * 60 * 60 * 24) return "critical"
  if (countdown.msLeft <= 1000 * 60 * 60 * 24 * 2) return "strong"
  return "soft"
}

export function incrementToolUsage(tool: ToolKey): number {
  const state = readJson<Record<string, number>>(USAGE_KEY, {})
  state[tool] = (state[tool] || 0) + 1
  writeJson(USAGE_KEY, state)
  return state[tool]
}

export function getToolUsage(tool: ToolKey): number {
  const state = readJson<Record<string, number>>(USAGE_KEY, {})
  return state[tool] || 0
}

export function pushOutputHistory(item: Omit<OutputHistoryItem, "id" | "createdAt">) {
  const history = readJson<OutputHistoryItem[]>(OUTPUT_KEY, [])
  const next: OutputHistoryItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    ...item,
  }
  const updated = [next, ...history].slice(0, 40)
  writeJson(OUTPUT_KEY, updated)
}

export function getOutputHistory(): OutputHistoryItem[] {
  return readJson<OutputHistoryItem[]>(OUTPUT_KEY, [])
}

export function setOutputHistoryPinned(id: string, pinned: boolean) {
  const history = getOutputHistory().map((h) =>
    h.id === id ? { ...h, pinned } : h
  )
  writeJson(OUTPUT_KEY, history)
}

export function removeOutputFromHistory(id: string) {
  writeJson(
    OUTPUT_KEY,
    getOutputHistory().filter((h) => h.id !== id)
  )
}

/** Local outputs sorted: pinned first, then newest */
export function getSortedOutputHistory(): OutputHistoryItem[] {
  const list = getOutputHistory()
  return [...list].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
    return b.createdAt - a.createdAt
  })
}

export function recordEmailReadyEvent(
  type: EmailReadyEvent["type"],
  dedupeKey: string,
  payload: Record<string, unknown>
) {
  const index = readJson<Record<string, number>>(EMAIL_EVENT_INDEX_KEY, {})
  if (index[dedupeKey]) return
  const events = readJson<EmailReadyEvent[]>(EMAIL_EVENT_KEY, [])
  events.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    createdAt: Date.now(),
  })
  index[dedupeKey] = Date.now()
  writeJson(EMAIL_EVENT_KEY, events.slice(0, 200))
  writeJson(EMAIL_EVENT_INDEX_KEY, index)
}
