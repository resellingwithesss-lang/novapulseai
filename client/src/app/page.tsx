import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Film,
  Layers,
  Link2,
  Rocket,
  Scissors,
  Sparkles,
  Users,
  Wand2,
} from "lucide-react"

const workflowSteps = [
  {
    icon: Scissors,
    name: "Clipper Engine",
    tier: "Starter+",
    outcome:
      "Mine long-form for the moments that actually retain—ranked clips you can post this week.",
  },
  {
    icon: Wand2,
    name: "Prompt Intelligence",
    tier: "Starter+",
    outcome:
      "Turn winning angles into reusable prompt systems—not one-off ChatGPT threads you lose.",
  },
  {
    icon: Sparkles,
    name: "Story Maker",
    tier: "Pro+",
    outcome:
      "Beat-by-beat story scripts built for watch-time: hook, tension, payoff, CTA.",
  },
  {
    icon: Film,
    name: "Video Script Engine",
    tier: "Free try → Pro+",
    outcome:
      "Packs of hooks, scripts, captions, and tags—structured for short-form, not generic paragraphs.",
  },
  {
    icon: Rocket,
    name: "AI Ad Generator",
    tier: "Elite",
    outcome:
      "URL in → full auto video ad out: AI script, voiceover, visuals, subtitles — no filming or editing.",
  },
] as const

const trustItems = [
  {
    icon: CreditCard,
    title: "Stripe-native billing",
    body: "Subscriptions, customer portal, and invoices—upgrade paths that match real SaaS expectations.",
  },
  {
    icon: Layers,
    title: "Tiers that scale with output",
    body: "Free to prove value, then Starter → Pro → Elite as your weekly shipping volume grows.",
  },
  {
    icon: Link2,
    title: "One pipeline, not five tabs",
    body: "Scripts, clips, stories, and ads hand off inside NovaPulseAI instead of dying in downloads folders.",
  },
  {
    icon: Users,
    title: "Built for publishing teams",
    body: "Creators and lean marketing squads who ship on a calendar—not hobby experiments.",
  },
] as const

const benefitRows = [
  {
    title: "A growth operating system",
    body: "Positioning, packaging, and generation stay in one workspace so every tool reinforces the same brand story.",
  },
  {
    title: "Usage you can plan around",
    body: "Credits and gates are visible before you commit—fewer mid-flow surprises when you are on deadline.",
  },
  {
    title: "More shots on goal",
    body: "When structure and iteration live together, you ship more testable creative per week—not more busywork.",
  },
] as const

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="np-container relative py-3 md:py-4" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-white/[0.12] to-transparent" />
      <div className="relative mx-auto w-fit rounded-full border border-white/[0.08] bg-[#070b16]/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/54 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        {label}
      </div>
    </div>
  )
}

export default function HomePage() {
  return (
    <main className="relative z-[1] min-h-screen w-full max-w-none overflow-x-hidden bg-[#050816] text-white">
      {/* Viewport-wide layer so gradients never inherit a narrowed column width */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 min-h-full w-full min-w-0"
        aria-hidden
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_150%_95%_at_68%_12%,rgba(139,92,246,0.08),transparent_72%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(5,8,22,0)_0%,rgba(5,8,22,0.08)_48%,rgba(5,8,22,0.12)_100%)]" />
      </div>

      {/* —— Hero —— */}
      <section className="relative isolate w-full max-w-none min-w-0 pb-20 pt-16 md:pb-24 md:pt-[4.5rem] lg:pb-28 lg:pt-20">
        <div className="np-container">
          <div className="relative z-[1] w-full min-w-0 text-center">
            <p className="np-eyebrow landing-fade-up mb-4 md:mb-5 md:text-xs">
              Creator growth OS
            </p>
            <h1 className="np-title-hero landing-fade-up landing-delay-1 mx-auto flex w-full max-w-4xl flex-col items-center gap-1.5 text-4xl sm:gap-2 md:text-5xl lg:text-5xl xl:text-6xl">
              <span className="block w-full text-balance">Content and ads that convert.</span>
              <span className="block w-full text-balance">One high-performance engine.</span>
            </h1>
            <p className="np-text-body landing-fade-up landing-delay-2 mx-auto mt-8 max-w-2xl text-pretty sm:mt-10 sm:text-base sm:leading-[1.65] md:mt-10 md:text-[1.0625rem] md:leading-[1.66] md:text-white/58">
              NovaPulseAI connects scripts, clips, stories, and Elite Ad Studio renders in a
              single workflow—so you move from idea to shipped creative without re-building context
              in a pile of disconnected AI tools. Plans, credits, and gates stay visible from day one.
            </p>
          </div>
          <div className="relative z-30 mt-12 w-full min-w-0 sm:mt-14 md:mt-16">
            <div className="pointer-events-auto mx-auto flex w-full max-w-5xl flex-col items-stretch justify-center gap-3.5 rounded-2xl border border-white/[0.05] bg-white/[0.015] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_20px_48px_-32px_rgba(0,0,0,0.75)] sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-5 sm:gap-y-3 sm:px-5 sm:py-5 lg:justify-between lg:gap-x-7 lg:px-6">
              <a
                href="/register"
                className="np-btn np-btn-primary np-button-glow inline-flex min-w-0 shrink whitespace-normal px-6 py-3.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] active:opacity-[0.93] sm:px-8 lg:min-w-[16rem]"
              >
                Start free — 4 script credits
                <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
              </a>
              <a
                href="/pricing"
                className="np-btn np-btn-secondary inline-flex min-w-0 shrink whitespace-normal px-6 py-3.5 text-center font-medium outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] active:bg-white/[0.08] sm:px-8 lg:min-w-[16rem]"
              >
                See paid plans
              </a>
              <a
                href="/#workflow"
                className="np-btn-tertiary inline-flex min-h-10 w-full max-w-full items-center justify-center rounded-lg px-3 py-2.5 text-sm font-medium tracking-[-0.01em] outline-none underline-offset-[0.22em] transition-colors duration-200 hover:underline focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] active:text-white/66 sm:ml-0 sm:h-11 sm:w-auto sm:max-w-[min(100%,20rem)] sm:justify-center sm:leading-none lg:ml-0.5 lg:border-l lg:border-white/[0.06] lg:pl-5"
              >
                See the stack
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* —— Trust / value strip —— */}
      <section
        className="relative py-16 md:py-20"
        aria-label="Trust and product facts"
      >
        <div className="np-container relative z-[1] grid min-w-0 w-full gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-x-12 lg:gap-y-12 lg:[&>*:nth-child(even)]:translate-y-1.5">
          {trustItems.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex min-w-0 items-start gap-4 sm:gap-[1.125rem]">
              <div className="mt-px flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_20px_-16px_rgba(0,0,0,0.7)]">
                <Icon className="h-[1.15rem] w-[1.15rem] text-purple-200/88" strokeWidth={1.6} aria-hidden />
              </div>
              <div className="min-w-0 pt-0.5">
                <h2 className="text-sm font-medium tracking-[-0.015em] text-white/95 break-words">
                  {title}
                </h2>
                <p className="mt-2 text-sm font-normal leading-[1.55] text-white/58 break-words">
                  {body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <SectionDivider label="The engine" />

      {/* —— Workflow / tools —— */}
      <section
        id="workflow"
        className="relative scroll-mt-20 py-20 md:scroll-mt-24 md:py-24"
        aria-labelledby="workflow-heading"
      >
        <div className="np-container relative">
          <div className="max-w-2xl">
            <h2
              id="workflow-heading"
              className="text-balance text-3xl font-semibold tracking-[-0.022em] text-white/[0.97] md:text-[2.05rem] md:leading-[1.15]"
            >
              The tools behind a serious publishing cadence
            </h2>
            <p className="mt-5 max-w-[42rem] text-base font-normal leading-[1.62] text-white/56 md:mt-6 md:text-lg md:leading-[1.65] md:text-white/58">
              Every module ships tangible creative—structured scripts, ranked clips, story arcs, and
              Elite-grade ad renders. Higher tiers unlock more of the pipeline; see{" "}
              <a
                href="/pricing"
                className="font-medium text-purple-200/88 underline-offset-2 outline-none transition-colors duration-200 hover:text-purple-100/95 hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816]"
              >
                pricing
              </a>{" "}
              for the exact ladder.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:mt-14 md:grid-cols-2 md:gap-x-7 md:gap-y-6 md:[&>*:nth-child(even)]:translate-y-1.5 lg:gap-x-8 lg:gap-y-6">
            {workflowSteps.map(({ icon: Icon, name, tier, outcome }) => (
              <div
                key={name}
                className="group np-card flex gap-5 p-6 transition-[border-color,box-shadow,transform,background-color] duration-200 ease-out hover:border-white/[0.11] hover:bg-white/[0.03] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.055),0_16px_28px_rgba(0,0,0,0.24)] md:gap-6 md:p-7"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition duration-200 group-hover:border-white/[0.1]">
                  <Icon className="h-[1.35rem] w-[1.35rem] text-white/76" strokeWidth={1.5} aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-medium tracking-[-0.018em] text-white/[0.97] break-words">
                      {name}
                    </h3>
                    <span className="whitespace-nowrap rounded-full border border-white/[0.055] bg-white/[0.03] px-2.5 py-px text-[10px] font-medium uppercase tracking-[0.05em] text-white/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                      {tier}
                    </span>
                  </div>
                  <p className="mt-2.5 text-sm font-normal leading-relaxed text-white/56 md:mt-3 md:text-white/58">
                    {outcome}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <SectionDivider label="Why operators stay" />

      {/* —— Outcomes —— */}
      <section
        className="relative py-20 md:py-24"
        aria-labelledby="outcomes-heading"
      >
        <div className="np-container relative">
          <h2
            id="outcomes-heading"
            className="max-w-2xl text-balance text-3xl font-semibold tracking-[-0.022em] text-white/[0.97] md:text-[2.05rem] md:leading-[1.15]"
          >
            Why growth teams consolidate here
          </h2>
          <p className="mt-5 max-w-2xl text-base font-normal leading-[1.62] text-white/56 md:mt-6 md:text-lg md:leading-[1.65] md:text-white/58">
            The point is not another chat window—it is a repeatable path from brief to asset,
            with monetization and limits that match how you actually ship.
          </p>
          <ul className="mt-12 grid gap-5 md:grid-cols-3 md:gap-x-6 md:gap-y-6 md:[&>*:nth-child(2)]:translate-y-1.5 lg:gap-x-7 lg:gap-y-7">
            {benefitRows.map(({ title, body }) => (
              <li
                key={title}
                className="np-card p-6 transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out hover:border-white/[0.1] hover:bg-white/[0.03] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_14px_26px_rgba(0,0,0,0.22)] md:p-7"
              >
                <CheckCircle2
                  className="mb-3 h-5 w-5 text-emerald-400/78 md:mb-3.5 md:h-[1.35rem] md:w-[1.35rem]"
                  strokeWidth={1.5}
                  aria-hidden
                />
                <h3 className="text-lg font-medium tracking-[-0.018em] text-white/[0.97] break-words">
                  {title}
                </h3>
                <p className="mt-2.5 text-sm font-normal leading-relaxed text-white/56 md:mt-3 md:text-white/58 break-words">
                  {body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <SectionDivider label="Plans & limits" />

      {/* —— Pricing bridge —— */}
      <section className="relative py-20 md:py-24">
        <div className="np-container relative">
          <div className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-purple-500/8 via-[#0a0d18] to-fuchsia-500/5 p-9 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_18px_40px_-24px_rgba(0,0,0,0.72)] md:p-12 lg:p-14">
            <div
              className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-purple-500/8 blur-3xl md:h-64 md:w-64"
              aria-hidden
            />
            <div className="relative max-w-2xl">
              <h2 className="text-2xl font-semibold tracking-[-0.022em] text-white/[0.97] md:text-[1.875rem] md:leading-snug">
                Plans that match how hard you ship
              </h2>
              <p className="mt-5 text-base font-normal leading-[1.62] text-white/56 md:mt-6 md:leading-[1.65] md:text-white/58">
                Free proves the script engine (4 credits). Starter adds Clipper + Prompt Intelligence.
                Pro unlocks Story Maker and full script volume. Elite adds Ad Studio—multi-variant,
                scored creative and rendered vertical ads. Pro includes a short paid trial; details on pricing.
              </p>
              <div className="mt-8 flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                <a
                  href="/pricing"
                  className="np-btn inline-flex min-h-11 min-w-0 shrink items-center justify-center gap-2 whitespace-normal rounded-full bg-white px-6 py-3.5 text-center text-sm font-semibold tracking-[-0.01em] text-[#0b0f19] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),inset_0_-1px_0_rgba(0,0,0,0.06)] outline-none ring-1 ring-black/5 transition-[background-color,box-shadow] duration-200 ease-out hover:bg-white/[0.96] focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0d18] active:bg-white/[0.92] sm:px-8"
                >
                  Compare plans
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                </a>
                <a
                  href="/register"
                  className="np-btn np-btn-secondary inline-flex min-h-11 min-w-0 shrink items-center justify-center whitespace-normal px-6 py-3.5 text-center text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0d18] active:bg-white/[0.08] sm:px-8"
                >
                  Create account
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SectionDivider label="Ready to start" />

      {/* —— Final CTA —— */}
      <section className="relative pb-24 pt-20 text-center md:pb-28 md:pt-24">
        <div className="np-container relative">
          <div className="mx-auto max-w-2xl">
            <h2 className="text-balance text-2xl font-semibold tracking-[-0.022em] text-white/[0.97] md:text-[1.875rem] md:leading-snug">
              Ready to run a tighter growth stack?
            </h2>
            <p className="mt-5 text-base font-normal leading-[1.62] text-white/56 md:mt-6 md:leading-[1.65] md:text-white/58">
              Start free on the Video Script Engine, then graduate into clips, stories, and Elite Ad Studio
              when your output—and revenue—depend on it.
            </p>
            <div className="mt-9 flex min-w-0 w-full max-w-full flex-col items-center justify-center gap-3 sm:mt-10 sm:flex-row sm:gap-3">
              <a
                href="/register"
                className="np-btn np-btn-primary np-button-glow inline-flex w-full min-h-11 min-w-0 shrink items-center justify-center whitespace-normal px-8 py-3.5 text-center text-sm outline-none focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] active:opacity-[0.93] sm:w-auto sm:px-10"
              >
                Get started
              </a>
              <a
                href="/login"
                className="np-btn np-btn-secondary inline-flex w-full min-h-11 min-w-0 shrink items-center justify-center whitespace-normal px-8 py-3.5 text-center text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] active:bg-white/[0.08] sm:w-auto sm:px-10"
              >
                Log in
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
