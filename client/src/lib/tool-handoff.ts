export type ToolHandoffPayload = Record<string, string | number | undefined>

export function buildToolHandoffUrl(basePath: string, payload: ToolHandoffPayload) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue
    params.set(key, String(value))
  }
  const query = params.toString()
  return query ? `${basePath}?${query}` : basePath
}
