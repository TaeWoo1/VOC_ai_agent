import { CLOSING } from "../../lib/public/landingContent";
import { Band, SectionHeading } from "./SectionShell";
import { LandingCtaButtons } from "./LandingCtaButtons";

/**
 * The one saturated surface on the page. Everything above it is white or canvas, so the accent
 * band reads as arrival rather than decoration — which is also why the accent is not spent
 * anywhere else at full strength.
 *
 * The offer is stated as what it is: a person reads the seller's material and writes up what they
 * find. Nothing here implies an automated diagnosis, because there isn't one.
 */
export function LandingClosingCta() {
  return (
    <Band id="closing" tone="accent">
      <SectionHeading title={CLOSING.heading} lead={CLOSING.body} onAccent />

      <div className="mt-10 max-w-xl rounded-2xl bg-white/10 p-6">
        <h3 className="text-base font-bold text-white">{CLOSING.deliverablesTitle}</h3>
        <ul className="mt-3 space-y-2">
          {CLOSING.deliverables.map((item) => (
            <li key={item} className="flex gap-2.5 break-keep leading-relaxed text-white/90">
              <span aria-hidden="true" className="select-none">
                ·
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-10">
        <LandingCtaButtons onAccent />
      </div>

      {/* white/80 measures 4.06:1 on brand-700 — below AA for this size. /90 measures 4.70:1. */}
      <p className="mt-5 text-base text-white/90">{CLOSING.note}</p>
    </Band>
  );
}
