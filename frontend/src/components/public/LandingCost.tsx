import { COST } from "../../lib/public/landingContent";
import { Band, SectionHeading } from "./SectionShell";

/**
 * Stakes. Deliberately unquantified — a number here would have to be invented, and an invented
 * number is the fastest way to lose a reader who runs the operation themselves.
 */
export function LandingCost() {
  return (
    <Band id="cost">
      <SectionHeading title={COST.heading} />
      <ul className="mt-10 space-y-6 border-l-2 border-line pl-6">
        {COST.items.map((item) => (
          <li key={item.title}>
            <h3 className="break-keep text-lg font-bold text-ink">{item.title}</h3>
            <p className="mt-1.5 max-w-2xl break-keep leading-relaxed text-muted">{item.body}</p>
          </li>
        ))}
      </ul>
      <p className="mt-10 max-w-2xl break-keep text-lg font-medium leading-relaxed text-ink">
        {COST.closing}
      </p>
    </Band>
  );
}
