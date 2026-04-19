/**
 * Premium copy bank for the NovaPulseAI marketing-consent surfaces.
 *
 * Each block below was authored side-by-side with several rejected drafts
 * (e.g. "Join our newsletter", "Get promotional emails") so the final picks
 * intentionally avoid the cheap/spammy tone the brand rules out. Tone target:
 * modern, confident, creator-focused, benefit-led, not pushy.
 *
 * If you're tempted to reword in a PR: move the new variant into `rejected`
 * below with a one-line reason so we keep the thinking trail.
 */

export type ConsentCopy = {
  eyebrow: string
  title: string
  body: string
  optInCta: string
  dismissCta: string
  optOutCta: string
  /** Shown after a successful opt-in. */
  successTitle: string
  successBody: string
  /** Shown after an explicit opt-out. */
  declineTitle: string
  declineBody: string
}

export const DASHBOARD_BANNER_COPY: ConsentCopy = {
  eyebrow: "Creator growth updates",
  title: "Be first to new tools, member offers, and creator playbooks.",
  body: "Occasional, high-signal emails only. No inbox clutter, and never shared. You can change this any time in Settings.",
  optInCta: "Count me in",
  dismissCta: "Not right now",
  optOutCta: "No thanks",
  successTitle: "You’re in.",
  successBody:
    "We’ll only send what’s worth your inbox — feature drops, limited offers, and growth ideas from the NovaPulseAI team.",
  declineTitle: "Got it.",
  declineBody:
    "You’ll only hear from us about your account, billing, and security. Change this any time in Settings.",
}

export const BILLING_CARD_COPY: ConsentCopy = {
  eyebrow: "Member offers",
  title: "Unlock member-only offers and pricing windows.",
  body: "First access to plan discounts, new Ad Studio launches, and pricing windows we don’t post publicly. Your billing and account emails aren’t affected.",
  optInCta: "Send me offers",
  dismissCta: "Maybe later",
  optOutCta: "No thanks",
  successTitle: "You’re on the list.",
  successBody:
    "We’ll email you when a member-only pricing window or launch opens. Nothing else.",
  declineTitle: "No problem.",
  declineBody:
    "You won’t receive member-offer emails. Manage this any time in Settings → Preferences.",
}

export const SETTINGS_CARD_COPY: ConsentCopy = {
  eyebrow: "Creator growth updates",
  title: "Growth ideas, feature launches, and member-only offers.",
  body: "Transactional emails about your account, billing, and security are always sent separately and aren’t affected by this setting.",
  optInCta: "Turn on",
  dismissCta: "Not right now",
  optOutCta: "Turn off",
  successTitle: "Saved.",
  successBody: "Creator growth updates are now on.",
  declineTitle: "Saved.",
  declineBody: "Creator growth updates are off. Billing and account emails still go through.",
}

/**
 * Historical / rejected variants kept as a deliberate trail.
 * Do NOT import from product code — this is documentation.
 */
export const REJECTED_VARIANTS = [
  {
    text: "Can we store your email for marketing?",
    reason: "Framed as a data-permission prompt; feels legalistic, not premium.",
  },
  {
    text: "Join our newsletter",
    reason: "Newsletter framing signals bulk content; conversion rates collapse.",
  },
  {
    text: "Get promotional emails",
    reason: "Literally named ‘promotional’ — cheapens the brand.",
  },
  {
    text: "We may send discounts",
    reason: "Hedged, apologetic tone; sounds desperate.",
  },
  {
    text: "Don’t miss out on exclusive deals!!",
    reason: "Punctuation + FOMO = bargain-bin positioning, wrong audience.",
  },
  {
    text: "Subscribe to stay informed",
    reason: "Generic. Says nothing about value to the creator.",
  },
] as const
