import { SAFETY } from "../../lib/public/landingContent";
import { Band, InfoCard, SectionHeading } from "./SectionShell";

/**
 * The product's standing fences, published as a feature.
 *
 * These are not marketing promises invented for the page — they are the operating rules the
 * product is built to (no sending on the seller's behalf, no auth bypass, fail closed on anything
 * ambiguous, no sensitive data on screen). Stating them here is the cheapest trust the page can
 * earn, and it costs nothing because they are already true.
 */
export function LandingSafety() {
  return (
    <Band id="safety">
      <SectionHeading title={SAFETY.heading} lead={SAFETY.lead} />
      <ul className="mt-10 grid gap-4 sm:grid-cols-2">
        {SAFETY.items.map((item) => (
          <li key={item.title}>
            <InfoCard title={item.title} body={item.body} />
          </li>
        ))}
      </ul>
    </Band>
  );
}
