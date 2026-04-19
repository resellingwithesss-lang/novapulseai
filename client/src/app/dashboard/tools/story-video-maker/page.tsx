import { redirect } from "next/navigation"

/**
 * Legacy URL — forwards to `/dashboard/tools/ai-ad-generator` with query string preserved.
 */
export default function LegacyStoryVideoMakerRedirect({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        q.append(key, item)
      }
    } else {
      q.set(key, value)
    }
  }
  const qs = q.toString()
  redirect(qs ? `/dashboard/tools/ai-ad-generator?${qs}` : "/dashboard/tools/ai-ad-generator")
}
