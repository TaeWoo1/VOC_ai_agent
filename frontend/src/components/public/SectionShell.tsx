import type { ReactNode } from "react";

/**
 * Layout primitives for the public product page.
 *
 * Scroll rhythm here comes from ONE device: alternating white / canvas bands at a fixed vertical
 * measure. No scroll-triggered motion, no parallax, no reveal animations — the audience includes
 * operators reading this on a work PC, and the motion guidance is explicit that decorative motion
 * is a cost, not a feature. Nothing on this page moves except focus and hover.
 */

type BandTone = "surface" | "canvas" | "accent";

const BAND_TONE: Record<BandTone, string> = {
  surface: "bg-surface",
  canvas: "bg-canvas",
  accent: "bg-brand-700",
};

export function Band({
  id,
  tone = "surface",
  children,
}: {
  id: string;
  tone?: BandTone;
  children: ReactNode;
}) {
  return (
    // scroll-mt clears the sticky public header when a section is linked directly.
    <section id={id} className={`scroll-mt-20 ${BAND_TONE[tone]}`}>
      <div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">{children}</div>
    </section>
  );
}

/** Section heading block. One `<h2>` per band keeps the document outline linear. */
export function SectionHeading({
  title,
  lead,
  onAccent = false,
}: {
  title: string;
  lead?: string;
  onAccent?: boolean;
}) {
  return (
    <div className="max-w-3xl">
      <h2
        className={`break-keep text-[clamp(1.625rem,3.4vw,2.25rem)] font-bold leading-snug tracking-tight ${
          onAccent ? "text-white" : "text-ink"
        }`}
      >
        {title}
      </h2>
      {lead ? (
        <p
          // white/90 on brand-700 measures 4.70:1; white/85 measures 4.37:1 and would miss AA for
          // body-size text. jsdom cannot compute contrast, so axe will not catch a regression here.
          className={`mt-4 break-keep text-lg leading-relaxed ${
            onAccent ? "text-white/90" : "text-muted"
          }`}
        >
          {lead}
        </p>
      ) : null}
    </div>
  );
}

/** Plain bordered card. Used sparingly — a page of cards reads as a dashboard, not an argument. */
export function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <h3 className="break-keep text-lg font-bold text-ink">{title}</h3>
      <p className="mt-2 break-keep leading-relaxed text-muted">{body}</p>
    </div>
  );
}

/**
 * Ordered steps with visible numbers. The numerals are deliberate: a scannable "1 → 5" is the
 * cheapest way to make a process legible to a reader who is skimming, which the primary audience
 * (owner-operators reading between tasks) is doing.
 */
export function StepList({ steps }: { steps: readonly { title: string; body: string }[] }) {
  return (
    <ol className="mt-10 space-y-8">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-5">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-base font-bold tabular-nums text-brand-700"
          >
            {index + 1}
          </span>
          <div className="min-w-0">
            <h3 className="break-keep text-lg font-bold text-ink">{step.title}</h3>
            <p className="mt-1.5 break-keep leading-relaxed text-muted">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
