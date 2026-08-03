import { FIT } from "../../lib/public/landingContent";
import { Band, SectionHeading } from "./SectionShell";

/**
 * Qualification, including disqualification. Telling a reader plainly that this may not be for
 * them yet is the section a sceptical operator believes — and it keeps the diagnosis queue full of
 * people the diagnosis can actually help.
 */
export function LandingFit() {
  return (
    <Band id="fit" tone="canvas">
      <SectionHeading title={FIT.heading} />
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-6">
          <h3 className="text-lg font-bold text-ink">{FIT.fitTitle}</h3>
          <ul className="mt-4 space-y-3">
            {FIT.fit.map((item) => (
              <li key={item} className="flex gap-2.5 break-keep leading-relaxed text-ink">
                <span aria-hidden="true" className="select-none font-bold text-brand-700">
                  ·
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6">
          <h3 className="text-lg font-bold text-muted">{FIT.notFitTitle}</h3>
          <ul className="mt-4 space-y-3">
            {FIT.notFit.map((item) => (
              <li key={item} className="flex gap-2.5 break-keep leading-relaxed text-muted">
                <span aria-hidden="true" className="select-none">
                  ·
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Band>
  );
}
