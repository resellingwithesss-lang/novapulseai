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
    outcome: "Pull high-retention moments from long-form video.",
  },
  {
    icon: Wand2,
    name: "Prompt Intelligence",
    tier: "Starter+",
    outcome: "Reusable prompts tuned to your content goals.",
  },
  {
    icon: Sparkles,
    name: "Story Maker",
    tier: "Pro+",
    outcome: "Structured story scripts with hooks and pacing.",
  },
  {
    icon: Film,
    name: "Video Script Engine",
    tier: "Free try → Pro+",
    outcome:
      "Hooks, full scripts, captions, and tags. Included on Free (4 credits); full monthly limits on Pro+.",
  },
  {
    icon: Rocket,
    name: "Story Video Generator",
    tier: "Elite",
    outcome: "Script-to-video pipeline for ads and promos.",
  },
] as const

const trustItems = [
  {
    icon: CreditCard,
    title: "Billing via Stripe",
    body: "Subscriptions, portal, and invoices—standard, transparent checkout.",
  },
  {
    icon: Layers,
    title: "Plans that match workload",
    body: "Free to try scripts, then Starter → Pro → Elite with clear credits and tool access.",
  },
  {
    icon: Link2,
    title: "One connected flow",
    body: "Outputs are built to feed the next step instead of dead-end files.",
  },
  {
    icon: Users,
    title: "Built for operators",
    body: "Creators and lean teams who publish on a schedule—not one-off gimmicks.",
  },
] as const

const benefitRows = [
  {
    title: "Less tab-hopping",
    body: "Script, prompt, clip, and video tools live together so you are not rebuilding context in five apps.",
  },
  {
    title: "Predictable usage",
    body: "Credits and plan limits are visible in-product—no surprise walls mid-task.",
  },
  {
    title: "Faster iteration",
    body: "Ship more variations per week when generation, structure, and handoffs stay in one workspace.",
  },
] as const

export default function HomePage() {
  return (
    <main className="relative z-[1] min-h-screen w-full max-w-none overflow-x-hidden bg-[#050816] text-white">
      {/* Viewport-wide layer so gradients never inherit a narrowed column width */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 min-h-full w-full min-w-0"
        aria-hidden
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_85%_60%_at_72%_56%,rgba(236,72,153,0.18),transparent_58%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_200%_90%_at_50%_102%,rgba(59,130,246,0.045),transparent_78%)]" />
      </div>

      {/* —— Hero —— */}
      <section className="relative isolate w-full max-w-none min-w-0 pb-24 pt-16 md:pb-28 md:pt-[4.75rem] lg:pb-32 lg:pt-[5.25rem]">
        <div className="mx-auto w-full max-w-5xl px-5 sm:px-8 lg:px-12">
          <div className="relative z-[1] w-full min-w-0 text-center">
            <p className="landing-fade-up mb-4 text-[11px] font-medium uppercase tracking-[0.14em] text-purple-200/72 md:mb-5 md:text-xs">
              Creator automation
            </p>
            <h1 className="landing-fade-up landing-delay-1 flex w-full flex-col items-center gap-1.5 text-4xl font-semibold leading-[1.1] tracking-[-0.028em] text-white/[0.97] sm:gap-2 md:text-5xl md:tracking-[-0.032em] lg:text-5xl xl:text-6xl xl:tracking-[-0.034em]">
              <span className="block w-full">Scripts, clips, repurposing</span>
              <span className="block w-full">One connected system.</span>
            </h1>
            <p className="landing-fade-up landing-delay-2 mx-auto mt-9 max-w-2xl text-pretty text-[0.9375rem] font-normal leading-[1.62] text-white/48 sm:mt-10 sm:text-base sm:leading-[1.65] md:mt-11 md:text-[1.0625rem] md:leading-[1.66] md:text-white/50">
              Generate scripts, pull high-retention clips, and run story-to-video
              workflows in one workspace—with plan access, credits, and limits always
              in view.
              Start free, scale when your output does.
            </p>
          </div>
          <div className="relative z-30 mt-14 w-full min-w-0 sm:mt-16 md:mt-[4.5rem]">
            <div className="pointer-events-auto flex w-full flex-col items-stretch justify-center gap-4 pt-10 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-6 sm:gap-y-3 sm:pt-11 md:pt-12 lg:justify-between lg:gap-x-8 lg:px-6">
              <a
                href="/register"
                className="np-button-glow inline-flex min-h-11 min-w-0 shrink items-center justify-center gap-2 whitespace-normal rounded-full bg-gradient-to-r from-purple-500 to-pink-600 px-6 py-3.5 text-center text-sm font-semibold tracking-[-0.01em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.18),0_0_36px_rgba(168,85,247,0.18)] outline-none transition-[opacity,box-shadow] duration-200 ease-out hover:opacity-[0.97] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.18),0_0_44px_rgba(168,85,247,0.22)] focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] active:opacity-[0.93] sm:px-8 lg:min-w-[16rem]"
              >
                Start free — 4 script credits
                <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
              </a>
              <a
                href="/pricing"
                className="inline-flex min-h-11 min-w-0 shrink items-center justify-center whitespace-normal rounded-full border border-white/[0.14] bg-white/[0.035] px-6 py-3.5 text-center text-sm font-medium tracking-[-0.01em] text-white/86 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] outline-none transition-[color,background-color,border-color,box-shadow] duration-200 ease-out hover:border-white/22 hover:bg-white/[0.065] focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] active:bg-white/[0.08] sm:px-8 lg:min-w-[16rem]"
              >
                See paid plans
              </a>
              <a
                href="/#workflow"
                className="inline-flex min-h-10 w-full max-w-full items-center justify-center rounded-lg px-3 py-2.5 text-sm font-medium tracking-[-0.01em] text-white/52 outline-none underline-offset-[0.22em] transition-colors duration-200 hover:bg-white/[0.03] hover:text-white/76 hover:underline focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] active:text-white/62 sm:ml-0 sm:h-11 sm:w-auto sm:max-w-[min(100%,20rem)] sm:justify-center sm:leading-none lg:ml-0.5 lg:border-l lg:border-white/[0.08] lg:pl-5"
              >
                Automation workflow
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* —— Trust / value strip —— */}
      <section
        className="relative overflow-hidden bg-gradient-to-b from-white/[0.018] to-black/[0.09] py-20 md:py-28"
        aria-label="Trust and product facts"
      >
        <div className="relative z-[1] mx-auto grid min-w-0 w-full max-w-7xl gap-x-12 gap-y-14 px-5 sm:grid-cols-2 sm:px-8 lg:grid-cols-4 lg:gap-x-20 lg:gap-y-16 lg:[&>*:nth-child(even)]:translate-y-1.5 lg:px-12 xl:gap-x-24 xl:px-16 2xl:gap-x-28">
          {trustItems.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex min-w-0 items-start gap-4 sm:gap-[1.125rem]">
              <div className="mt-px flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.075] bg-gradient-to-b from-white/[0.055] to-white/[0.02] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_2px_8px_rgba(0,0,0,0.12)]">
                <Icon className="h-[1.15rem] w-[1.15rem] text-purple-200/88" strokeWidth={1.6} aria-hidden />
              </div>
              <div className="min-w-0 pt-0.5">
                <h2 className="text-sm font-medium tracking-[-0.015em] text-white/95 break-words">
                  {title}
                </h2>
                <p className="mt-2 text-sm font-normal leading-[1.55] text-white/50 break-words">
                  {body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* —— Workflow / tools —— */}
      <section
        id="workflow"
        className="relative scroll-mt-20 overflow-hidden py-24 md:scroll-mt-24 md:py-28"
        aria-labelledby="workflow-heading"
      >
        <div
          className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[min(100%,48rem)] w-screen max-w-none -translate-x-1/2 bg-gradient-to-b from-purple-500/[0.045] via-transparent to-transparent"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute bottom-0 left-1/2 -z-10 h-40 w-screen max-w-none -translate-x-1/2 bg-gradient-to-t from-[#050816]/90 via-[#050816]/35 to-transparent"
          aria-hidden
        />
        <div className="relative mx-auto w-full max-w-5xl px-5 sm:px-8 lg:px-10 xl:px-12">
          <div className="max-w-2xl">
            <h2
              id="workflow-heading"
              className="text-balance text-3xl font-semibold tracking-[-0.022em] text-white/[0.97] md:text-[2.125rem] md:leading-[1.15]"
            >
              What you actually run inside NovaPulseAI
            </h2>
            <p className="mt-5 text-base font-normal leading-[1.62] text-white/48 md:mt-6 md:text-lg md:leading-[1.65] md:text-white/50">
              Each tool produces concrete assets. Higher plans unlock more of
              the pipeline—see{" "}
              <a
                href="/pricing"
                className="font-medium text-purple-200/88 underline-offset-2 outline-none transition-colors duration-200 hover:text-purple-100/95 hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816]"
              >
                pricing
              </a>{" "}
              for the exact ladder.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:mt-16 md:grid-cols-2 md:gap-x-8 md:gap-y-6 md:[&>*:nth-child(even)]:translate-y-2 lg:gap-x-10 lg:gap-y-7">
            {workflowSteps.map(({ icon: Icon, name, tier, outcome }) => (
              <div
                key={name}
                className="group np-card flex gap-5 p-6 transition-[border-color,box-shadow,transform] duration-200 ease-out hover:border-purple-400/18 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.055),0_8px_36px_rgba(0,0,0,0.16),0_0_40px_rgba(124,58,237,0.045)] md:gap-6 md:p-7"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/[0.072] bg-gradient-to-b from-white/[0.06] to-black/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition duration-200 group-hover:border-white/[0.11]">
                  <Icon className="h-[1.35rem] w-[1.35rem] text-white/76" strokeWidth={1.5} aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-medium tracking-[-0.018em] text-white/[0.97] break-words">
                      {name}
                    </h3>
                    <span className="whitespace-nowrap rounded-full border border-white/[0.065] bg-white/[0.04] px-2.5 py-px text-[10px] font-medium uppercase tracking-[0.05em] text-white/42 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      {tier}
                    </span>
                  </div>
                  <p className="mt-2.5 text-sm font-normal leading-relaxed text-white/48 md:mt-3 md:text-white/50">
                    {outcome}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* —— Outcomes —— */}
      <section
        className="relative py-24 md:py-28"
        aria-labelledby="outcomes-heading"
      >
        <div
          className="pointer-events-none absolute left-1/2 top-0 -z-10 h-48 w-screen max-w-none -translate-x-1/2 bg-gradient-to-b from-white/[0.05] via-white/[0.02] to-transparent"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute bottom-0 left-1/2 -z-10 h-32 w-screen max-w-none -translate-x-1/2 bg-gradient-to-t from-[#050816]/85 to-transparent"
          aria-hidden
        />
        <div className="relative mx-auto w-full max-w-5xl px-5 sm:px-8 lg:px-10 xl:px-12">
          <h2
            id="outcomes-heading"
            className="max-w-2xl text-balance text-3xl font-semibold tracking-[-0.022em] text-white/[0.97] md:text-[2.125rem] md:leading-[1.15]"
          >
            Why teams switch to a single content stack
          </h2>
          <p className="mt-5 max-w-2xl text-base font-normal leading-[1.62] text-white/48 md:mt-6 md:text-lg md:leading-[1.65] md:text-white/50">
            The goal is not more AI features—it is less friction between ideation
            and shipped output.
          </p>
          <ul className="mt-12 grid gap-6 md:grid-cols-3 md:gap-x-8 md:gap-y-7 md:[&>*:nth-child(2)]:translate-y-2 lg:gap-x-10 lg:gap-y-8">
            {benefitRows.map(({ title, body }) => (
              <li
                key={title}
                className="rounded-3xl border border-white/[0.075] bg-gradient-to-b from-white/[0.045] to-white/[0.02] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_4px_24px_rgba(0,0,0,0.1)] transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out hover:border-white/[0.11] hover:from-white/[0.052] hover:to-white/[0.028] md:p-7"
              >
                <CheckCircle2
                  className="mb-3 h-5 w-5 text-emerald-400/78 md:mb-3.5 md:h-[1.35rem] md:w-[1.35rem]"
                  strokeWidth={1.5}
                  aria-hidden
                />
                <h3 className="text-lg font-medium tracking-[-0.018em] text-white/[0.97] break-words">
                  {title}
                </h3>
                <p className="mt-2.5 text-sm font-normal leading-relaxed text-white/48 md:mt-3 md:text-white/50 break-words">
                  {body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* —— Pricing bridge —— */}
      <section className="relative py-24 md:py-28">
        <div
          className="pointer-events-none absolute left-1/2 top-0 -z-10 h-full w-screen max-w-none -translate-x-1/2 bg-gradient-to-b from-transparent via-white/[0.02] to-transparent"
          aria-hidden
        />
        <div className="relative mx-auto w-full max-w-5xl px-5 sm:px-8 lg:px-10 xl:px-12">
          <div className="relative overflow-hidden rounded-3xl border border-white/[0.078] bg-gradient-to-br from-purple-600/10 via-[#0a0d18] to-pink-600/7 p-9 shadow-[inset_0_1px_0_rgba(255,255,255,0.045),0_4px_32px_rgba(0,0,0,0.14)] ring-1 ring-inset ring-white/[0.03] md:p-12 lg:p-14">
            <div
              className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-purple-500/10 blur-3xl md:h-64 md:w-64"
              aria-hidden
            />
            <div className="relative max-w-2xl">
              <h2 className="text-2xl font-semibold tracking-[-0.022em] text-white/[0.97] md:text-[1.875rem] md:leading-snug">
                Simple plans. Clear limits.
              </h2>
              <p className="mt-5 text-base font-normal leading-[1.62] text-white/48 md:mt-6 md:leading-[1.65] md:text-white/52">
                Every account can try the Video Script Engine on Free (4 credits).
                Starter adds clip + prompt automation; Pro adds story + full script
                limits; Elite unlocks story-to-video. Pro includes a short paid
                trial—see pricing.
              </p>
              <div className="mt-8 flex min-w-0 flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                <a
                  href="/pricing"
                  className="inline-flex min-h-11 min-w-0 shrink items-center justify-center gap-2 whitespace-normal rounded-full bg-white px-6 py-3.5 text-center text-sm font-semibold tracking-[-0.01em] text-[#0b0f19] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),inset_0_-1px_0_rgba(0,0,0,0.06)] outline-none ring-1 ring-black/5 transition-[background-color,box-shadow] duration-200 ease-out hover:bg-white/[0.96] focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0d18] active:bg-white/[0.92] sm:px-8"
                >
                  Compare plans
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                </a>
                <a
                  href="/register"
                  className="inline-flex min-h-11 min-w-0 shrink items-center justify-center whitespace-normal rounded-full border border-white/[0.14] bg-white/[0.035] px-6 py-3.5 text-center text-sm font-medium tracking-[-0.01em] text-white/84 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] outline-none transition-[background-color,border-color] duration-200 ease-out hover:border-white/22 hover:bg-white/[0.065] focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0d18] active:bg-white/[0.08] sm:px-8"
                >
                  Create account
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* —— Final CTA —— */}
      <section className="relative pb-28 pt-24 text-center md:pb-36 md:pt-28">
        <div
          className="pointer-events-none absolute left-1/2 top-0 -z-10 h-36 w-screen max-w-none -translate-x-1/2 bg-gradient-to-b from-white/[0.03] to-transparent"
          aria-hidden
        />
        <div className="relative mx-auto w-full max-w-5xl px-5 sm:px-8 lg:px-10 xl:px-12">
          <div className="mx-auto max-w-2xl">
            <h2 className="text-balance text-2xl font-semibold tracking-[-0.022em] text-white/[0.97] md:text-[1.875rem] md:leading-snug">
              Ready to tighten your content workflow?
            </h2>
            <p className="mt-5 text-base font-normal leading-[1.62] text-white/48 md:mt-6 md:leading-[1.65] md:text-white/50">
              Create a free account to run script generation, then upgrade when you
              want the full automation stack.
            </p>
            <div className="mt-9 flex min-w-0 w-full max-w-full flex-col items-center justify-center gap-2.5 sm:mt-10 sm:flex-row sm:gap-3">
              <a
                href="/register"
                className="np-button-glow inline-flex w-full min-h-11 min-w-0 shrink items-center justify-center whitespace-normal rounded-full bg-gradient-to-r from-purple-500 to-pink-600 px-8 py-3.5 text-center text-sm font-semibold tracking-[-0.01em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.18),0_0_36px_rgba(168,85,247,0.18)] outline-none transition-[opacity,box-shadow] duration-200 ease-out hover:opacity-[0.97] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.18),0_0_44px_rgba(168,85,247,0.22)] focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] active:opacity-[0.93] sm:w-auto sm:px-10"
              >
                Get started
              </a>
              <a
                href="/login"
                className="inline-flex w-full min-h-11 min-w-0 shrink items-center justify-center whitespace-normal rounded-full border border-white/[0.14] bg-white/[0.035] px-8 py-3.5 text-center text-sm font-medium tracking-[-0.01em] text-white/84 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] outline-none transition-[background-color,border-color] duration-200 ease-out hover:border-white/22 hover:bg-white/[0.065] focus-visible:ring-2 focus-visible:ring-purple-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050816] active:bg-white/[0.08] sm:w-auto sm:px-10"
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
