import {
  BookOpen,
  CalendarCheck,
  Check,
  FileAudio,
  Gauge,
  Headphones,
  LifeBuoy,
  MessageSquareText,
  Mic,
  PhoneCall,
  PhoneForwarded,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { AsciiWave } from "@/components/landing/ascii-wave";
import { LiveCallDemo } from "@/components/landing/live-call-demo";
import { SiteNav } from "@/components/landing/site-nav";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { INR_PLANS, TRIAL_SECONDS } from "@/lib/shared/plans";

const USE_CASES = [
  {
    icon: PhoneCall,
    title: "Sales Calls",
    body: "Answers inbound leads in seconds, qualifies budget and timeline, and books the demo on your reps' calendar.",
    quote: "Do you have a quick minute to chat about what you're looking for?",
  },
  {
    icon: Headphones,
    title: "AI Receptionist",
    body: "Picks up every call, answers hours and pricing from your docs, routes the urgent ones and takes messages.",
    quote: "Thanks for calling! How can I help you today?",
  },
  {
    icon: CalendarCheck,
    title: "Appointment Scheduling",
    body: "Books, moves and confirms visits for clinics, salons and service teams, and reads every detail back.",
    quote: "I have Tuesday at ten or at two. Which works better?",
  },
  {
    icon: LifeBuoy,
    title: "Customer Support",
    body: "Resolves tier-1 questions from your knowledge base and hands off to a person with a written summary.",
    quote: "Let me check that for you. What's the order number?",
  },
];

const PIPELINE = [
  { step: "01", title: "Listen", body: "The call opens straight from the browser. Voice detection marks the moment speech starts and stops." },
  { step: "02", title: "Transcribe", body: "Speech is transcribed as it streams in, so words appear while the caller is still talking." },
  { step: "03", title: "Think", body: "Your agent reasons with your instructions, tools and knowledge, and starts replying right away." },
  { step: "04", title: "Speak", body: "Each sentence is voiced the moment it's ready, so the caller hears audio before the reply is finished." },
];

const FEATURES = [
  { icon: Mic, title: "Barge-In", body: "The caller talks, the agent stops. Playback stops and the reply in flight is cancelled." },
  { icon: Wrench, title: "Tools & Webhooks", body: "Capture leads, book appointments, or call your own HTTPS endpoints mid-call." },
  { icon: BookOpen, title: "Knowledge Sources", body: "Paste FAQs, prices and policies. Agents answer from them and never invent facts." },
  { icon: MessageSquareText, title: "Transcripts & Summaries", body: "Every call is transcribed live and summarized with an outcome when it ends." },
  { icon: Gauge, title: "Latency Monitoring", body: "Speech, LLM and voice timings for every turn, with Sentry alerts on failures." },
  { icon: FileAudio, title: "Recordings With Consent", body: "Calls are recorded only when the caller agrees at the start." },
];

export default function Home() {
  return (
    <>
      <SiteNav />

      <main className="reveal-landing">
        {/* Hero: everything on screen at first paint. The headline stays out of the reveal (LCP). */}
        <section className="mx-auto grid max-w-[1200px] gap-16 px-6 pt-24 pb-24 lg:grid-cols-[1fr_520px] lg:items-center">
          <div style={{ animation: "none" }}>
            <h1 className="max-w-[560px] text-[44px] leading-[48px] font-medium tracking-[-0.3px] text-balance sm:text-[60px] sm:leading-[64px]">
              Voice agents your callers can interrupt.
            </h1>
            <p className="mt-6 max-w-[520px] text-xl leading-7 tracking-[-0.1px] text-pretty text-muted-foreground">
              Build a sales rep, receptionist or support agent in minutes. Ringlet runs the speech
              recognition, turn-taking and voice, so you don&apos;t build speech infrastructure.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Button className="h-12 px-6 text-base" asChild>
                <Link href="/signin">Build an Agent</Link>
              </Button>
              <Button variant="secondary" className="h-12 px-6 text-base" asChild>
                <a href="#how-it-works">See How It Works</a>
              </Button>
            </div>
            <p className="mt-4 font-mono text-xs text-muted-foreground">
              {TRIAL_SECONDS / 60} free minutes · no card required
            </p>
          </div>
          <LiveCallDemo />
        </section>

        <section id="use-cases" className="border-t bg-card">
          <div className="mx-auto max-w-[1200px] px-6 py-24">
            <h2 className="max-w-[640px] text-[40px] leading-[44px] font-medium tracking-[-0.4px] text-balance">
              One platform, every line your business answers.
            </h2>
            <p className="mt-4 max-w-[560px] text-base leading-6 text-muted-foreground">
              Start from a template and change anything: personality, instructions, voice, tools and knowledge.
            </p>
            <div className="mt-12 grid gap-4 md:grid-cols-2">
              {USE_CASES.map(({ icon: Icon, title, body, quote }) => (
                <article key={title} className="reveal-scroll flex flex-col rounded-xl border border-transparent bg-background p-6 shadow-surface">
                  <Icon className="size-5 text-primary" strokeWidth={1.5} />
                  <h3 className="mt-4 text-2xl leading-8 font-medium tracking-[-0.24px]">{title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-5 text-muted-foreground">{body}</p>
                  <p className="mt-6 border-l-2 border-primary/40 pl-3 font-mono text-[13px] leading-5">&ldquo;{quote}&rdquo;</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="border-t">
          <div className="mx-auto max-w-[1200px] px-6 py-24">
            <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-end">
              <div>
                <h2 className="text-[40px] leading-[44px] font-medium tracking-[-0.4px] text-balance">
                  Built for the moment someone talks over the bot.
                </h2>
                <p className="mt-4 max-w-[520px] text-base leading-6 text-muted-foreground">
                  Voice activity detection listens even while the agent speaks. When the caller starts, Ringlet stops playback,
                  cancels the reply in flight and answers what they just said.
                </p>
              </div>
              <AsciiWave
                columns={80}
                rows={9}
                className="hidden overflow-hidden font-mono text-[10px] leading-[12px] text-illustration lg:block"
              />
            </div>
            <ol className="mt-14 grid gap-px overflow-clip rounded-xl bg-border shadow-surface sm:grid-cols-2 lg:grid-cols-4">
              {PIPELINE.map((p) => (
                <li key={p.step} className="reveal-scroll bg-card p-6">
                  <div className="font-mono text-xs text-primary">{p.step}</div>
                  <h3 className="mt-3 text-xl leading-7 font-medium">{p.title}</h3>
                  <p className="mt-2 text-sm leading-5 text-muted-foreground">{p.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-t bg-card">
          <div className="mx-auto max-w-[1200px] px-6 py-24">
            <h2 className="max-w-[640px] text-[40px] leading-[44px] font-medium tracking-[-0.4px] text-balance">
              Everything after hello.
            </h2>
            <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="reveal-scroll">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-primary">
                    <Icon className="size-[18px]" strokeWidth={1.5} />
                  </div>
                  <h3 className="mt-4 text-base leading-6 font-medium">{title}</h3>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="border-t">
          <div className="mx-auto max-w-[1200px] px-6 py-24">
            <h2 className="text-[40px] leading-[44px] font-medium tracking-[-0.4px]">Monthly plans. No seats.</h2>
            <p className="mt-4 max-w-[560px] text-base leading-6 text-muted-foreground">
              UPI Autopay, cards or netbanking through Razorpay. Prices include GST. Unused minutes roll over, and you can
              cancel any time.
            </p>
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {INR_PLANS.map((p) => {
                const featured = p.id === "in_growth";
                return (
                  <div
                    key={p.id}
                    className={
                      featured
                        ? "reveal-scroll flex flex-col rounded-xl border border-primary/40 bg-card p-6 shadow-surface"
                        : "reveal-scroll flex flex-col rounded-xl border border-transparent bg-card p-6 shadow-surface"
                    }
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl leading-7 font-medium">{p.name}</h3>
                      {featured && <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-primary">Most Popular</span>}
                    </div>
                    <div className="mt-4 font-mono text-[40px] leading-[44px] font-medium tracking-[-0.4px]">
                      ₹{p.priceInr}<span className="text-sm text-muted-foreground">/month</span>
                    </div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">{p.minutes} minutes every month</div>
                    <ul className="mt-6 flex-1 space-y-2 text-sm">
                      {p.features.slice(1).map((f) => (
                        <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={1.5} /> {f}</li>
                      ))}
                    </ul>
                    <Button variant={featured ? "default" : "secondary"} className="mt-8 h-10" asChild>
                      <Link href="/signin">Start With {p.name}</Link>
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-t bg-card">
          <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-8 px-6 py-24 md:flex-row md:items-center">
            <div>
              <h2 className="text-[40px] leading-[44px] font-medium tracking-[-0.4px] text-balance">Hear your first agent in five minutes.</h2>
              <p className="mt-3 text-base leading-6 text-muted-foreground">Pick a template, press Start Call, and talk to it in your browser.</p>
            </div>
            <Button className="h-12 shrink-0 px-6 text-base" asChild>
              <Link href="/signin"><PhoneForwarded /> Build an Agent</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground">
          <Logo className="text-foreground" />
          <span className="font-mono text-xs">© {new Date().getFullYear()} Ringlet</span>
        </div>
      </footer>
    </>
  );
}
