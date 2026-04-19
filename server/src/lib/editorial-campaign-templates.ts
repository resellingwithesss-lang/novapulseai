/**
 * Pre-built admin campaign templates (bulk sends). Distinct from lifecycle
 * automation templates in `marketing-templates.ts`.
 *
 * Body is inner HTML only; broadcast wrapper + unsubscribe link are added
 * by the email fan-out. Supports merge tags (see `campaign-merge-tags.ts`).
 */

export type EditorialCampaignTemplateId =
  | "editorial_upgrade_results_v1"
  | "editorial_ads_ready_v1"
  | "editorial_pro_to_elite_v1"
  | "editorial_feature_ship_v1"
  | "editorial_winback_v1"
  | "editorial_credit_urgency_v1"

export type EditorialCampaignTemplate = {
  id: EditorialCampaignTemplateId
  name: string
  description: string
  subject: string
  /** Inner HTML (no outer html/body). */
  html: string
}

const EYEBROW =
  'margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.14em;color:#a78bfa;text-transform:uppercase;'
const H = "margin:0 0 12px;font-size:22px;font-weight:600;color:#fff;line-height:1.3;"
const P = "margin:0 0 14px;color:#cbd5e1;font-size:15px;line-height:1.6;"
const CTA =
  "display:inline-block;padding:13px 26px;border-radius:999px;background:linear-gradient(90deg,#7c3aed,#db2777);color:#fff;text-decoration:none;font-weight:600;font-size:14px;"

export const EDITORIAL_CAMPAIGN_TEMPLATES: EditorialCampaignTemplate[] = [
  {
    id: "editorial_upgrade_results_v1",
    name: "You're leaving performance on the table",
    description: "Upgrade push — creators who have momentum but not the right plan.",
    subject: "{{name}}, you're leaving performance on the table",
    html: `
<p style="${EYEBROW}">NovaPulseAI</p>
<p style="${H}">Hi {{name}} — quick reality check.</p>
<p style="${P}">
  Most creators don't lose because of talent. They lose because testing is too slow —
  fewer hooks, fewer angles, fewer shots on goal. A higher plan means more credits, more
  tools, and faster iteration without touching a camera.
</p>
<p style="${P}">
  You're on <strong style="color:#fff;">{{plan}}</strong> today. If growth is the goal,
  the next tier is usually cheaper than another week of stalled output.
</p>
<p style="margin:24px 0 8px;">
  <a href="{{app_url}}/dashboard/billing?utm_source=campaign&amp;utm_medium=email&amp;utm_campaign=upgrade_results" style="${CTA}">Compare plans</a>
</p>
<p style="margin:16px 0 0;font-size:13px;color:#94a3b8;">Credits remaining: {{credits}}</p>
`.trim(),
  },
  {
    id: "editorial_ads_ready_v1",
    name: "Your ads are ready",
    description: "Re-engagement — nudge back to AI Ad Generator.",
    subject: "{{name}}, your next ad is waiting",
    html: `
<p style="${EYEBROW}">AI Ad Generator</p>
<p style="${H}">{{name}}, want a fresh ad without filming?</p>
<p style="${P}">
  Paste a product URL — NovaPulseAI writes the script, voiceover, visuals, and captions.
  Elite members ship platform-ready MP4s in minutes, not days.
</p>
<p style="${P}">
  If you've been meaning to test a new hook or landing page, this is the lowest-friction
  way to get a real asset in your Ads Manager.
</p>
<p style="margin:24px 0 8px;">
  <a href="{{app_url}}/dashboard/tools/ai-ad-generator?utm_source=campaign&amp;utm_medium=email&amp;utm_campaign=ads_ready" style="${CTA}">Open AI Ad Generator</a>
</p>
`.trim(),
  },
  {
    id: "editorial_pro_to_elite_v1",
    name: "Unlock better-performing ads",
    description: "Pro → Elite — emphasize variants and AI ads.",
    subject: "{{name}}, generate better-performing ads with Elite",
    html: `
<p style="${EYEBROW}">Upgrade path</p>
<p style="${H}">More variants = better performance.</p>
<p style="${P}">
  Elite isn't "more of the same." It's the tier where AI Ad Generator opens up — more
  creative angles scored per run, and website-to-video ads you can actually ship.
</p>
<p style="${P}">
  You're currently on <strong style="color:#fff;">{{plan}}</strong>. If ads are part of
  your growth model, Elite is built for people who test weekly, not monthly.
</p>
<p style="margin:24px 0 8px;">
  <a href="{{app_url}}/dashboard/billing?utm_source=campaign&amp;utm_medium=email&amp;utm_campaign=pro_to_elite" style="${CTA}">View Elite benefits</a>
</p>
`.trim(),
  },
  {
    id: "editorial_feature_ship_v1",
    name: "We built this for you",
    description: "New capability / feature announcement.",
    subject: "{{name}}, we built this for you",
    html: `
<p style="${EYEBROW}">Something new</p>
<p style="${H}">We shipped an upgrade worth your time.</p>
<p style="${P}">
  NovaPulseAI keeps tightening the loop: faster scripts, smarter clips, and AI-generated
  video ads from a single product link. Less manual work, more assets you can publish.
</p>
<p style="${P}">
  Sign in and run your next idea through the dashboard — the newest workflows are live
  for your plan today.
</p>
<p style="margin:24px 0 8px;">
  <a href="{{app_url}}/dashboard?utm_source=campaign&amp;utm_medium=email&amp;utm_campaign=feature_ship" style="${CTA}">Open your dashboard</a>
</p>
`.trim(),
  },
  {
    id: "editorial_winback_v1",
    name: "Come back and generate more ads",
    description: "Inactive users — soft win-back.",
    subject: "{{name}}, your next ad is waiting",
    html: `
<p style="${EYEBROW}">We miss you</p>
<p style="${H}">Your workspace is waiting.</p>
<p style="${P}">
  It's been quiet on your account. If life got busy, no guilt — jump back in whenever
  you're ready. Your credits and tools are still here.
</p>
<p style="${P}">
  Try the AI Ad Generator with a fresh product URL, or spin up a new script in the
  Video engine. Small experiments compound.
</p>
<p style="margin:24px 0 8px;">
  <a href="{{app_url}}/dashboard/tools/ai-ad-generator?utm_source=campaign&amp;utm_medium=email&amp;utm_campaign=winback" style="${CTA}">Generate an ad</a>
</p>
<p style="margin:16px 0 0;font-size:13px;color:#94a3b8;">Plan: {{plan}} · Credits: {{credits}}</p>
`.trim(),
  },
  {
    id: "editorial_credit_urgency_v1",
    name: "Credit urgency — keep generating",
    description: "Low credits — emphasize ROI of staying in market with more variants.",
    subject: "{{name}}, you're running low — keep generating",
    html: `
<p style="${EYEBROW}">Credits</p>
<p style="${H}">You're close to empty — don't pause tests now.</p>
<p style="${P}">
  Performance comes from volume: more hooks, more angles, more edits. When credits dip,
  the teams that win top up before the algorithm goes quiet — not after.
</p>
<p style="${P}">
  You have <strong style="color:#fff;">{{credits}}</strong> credits left on
  <strong style="color:#fff;">{{plan}}</strong>. Refill or upgrade and keep your next
  batch of ads shipping.
</p>
<p style="margin:24px 0 8px;">
  <a href="{{app_url}}/dashboard/billing?utm_source=campaign&amp;utm_medium=email&amp;utm_campaign=credit_urgency" style="${CTA}">Top up &amp; compare plans</a>
</p>
`.trim(),
  },
]

export function getEditorialTemplate(
  id: EditorialCampaignTemplateId
): EditorialCampaignTemplate | undefined {
  return EDITORIAL_CAMPAIGN_TEMPLATES.find((t) => t.id === id)
}
