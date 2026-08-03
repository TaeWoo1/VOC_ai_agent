import { FAQ } from "../../lib/public/landingContent";
import { Band, SectionHeading } from "./SectionShell";

/**
 * Native `<details>` / `<summary>` on purpose: keyboard-operable, screen-reader-announced, and
 * open/close state handled by the browser. A hand-rolled accordion here would add JavaScript, ARIA
 * wiring, and focus bugs to solve a problem the platform already solved.
 */
export function LandingFaq() {
  return (
    <Band id="faq">
      <SectionHeading title={FAQ.heading} />
      <div className="mt-10 max-w-3xl divide-y divide-line border-y border-line">
        {FAQ.items.map((item) => (
          <details key={item.q} className="group py-5">
            {/* `list-none` hides the marker in Chrome/Firefox; the webkit variant covers Safari,
                which would otherwise show its own triangle next to the "+" indicator. */}
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 rounded text-lg font-semibold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
              <span className="break-keep">{item.q}</span>
              <span
                aria-hidden="true"
                className="mt-1 shrink-0 text-muted transition group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-3 max-w-2xl break-keep leading-relaxed text-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </Band>
  );
}
