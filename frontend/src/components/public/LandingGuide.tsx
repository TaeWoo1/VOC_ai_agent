import { GUIDE } from "../../lib/public/landingContent";
import { Band, SectionHeading } from "./SectionShell";

/**
 * The guide takes its position. This is also where the product's boundary is stated out loud —
 * naming what SellerOps is NOT does more for a sceptical operator than another benefit list.
 */
export function LandingGuide() {
  return (
    <Band id="guide" tone="canvas">
      <SectionHeading title={GUIDE.heading} lead={GUIDE.body} />

      <p className="mt-8 max-w-2xl break-keep border-l-2 border-brand-700 pl-5 text-lg font-semibold leading-relaxed text-ink">
        {GUIDE.principle}
      </p>

      <div className="mt-12 max-w-2xl rounded-2xl border border-line bg-surface p-6">
        <h3 className="text-base font-bold text-ink">{GUIDE.notHeading}</h3>
        <ul className="mt-3 space-y-2">
          {GUIDE.notItems.map((item) => (
            <li key={item} className="flex gap-2.5 break-keep leading-relaxed text-muted">
              <span aria-hidden="true" className="select-none text-line">
                —
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </Band>
  );
}
