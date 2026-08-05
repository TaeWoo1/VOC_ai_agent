import { CHANGE } from "../../lib/public/landingContent";
import { Band, SectionHeading } from "./SectionShell";

/**
 * Before / after. The contrast is carried by weight and colour VALUE (muted vs ink + one accent
 * rule), not by a second hue — this page has one accent and spends it on actions.
 */
export function LandingChange() {
  return (
    <Band id="change" tone="canvas">
      <SectionHeading title={CHANGE.heading} />
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-6">
          <h3 className="text-base font-bold text-muted">{CHANGE.beforeTitle}</h3>
          <ul className="mt-4 space-y-3">
            {CHANGE.before.map((item) => (
              <li key={item} className="break-keep leading-relaxed text-muted">
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
          <h3 className="text-base font-bold text-brand-700">{CHANGE.afterTitle}</h3>
          <ul className="mt-4 space-y-3">
            {CHANGE.after.map((item) => (
              <li key={item} className="break-keep font-medium leading-relaxed text-ink">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Band>
  );
}
