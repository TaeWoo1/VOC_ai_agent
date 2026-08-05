import { Link } from "react-router-dom";
import { CTA_DEMO_LABEL, CTA_DIAGNOSIS_LABEL, DEMO_ENTRY_PATH, diagnosisFormUrl } from "../../lib/public/publicCta";

/**
 * The page's call to action, in one component so the wording and the fallback behaviour cannot
 * drift between the hero and the closing band.
 *
 * When no external form is configured the diagnosis CTA is not rendered at all and the demo entry
 * becomes the primary action — a dead primary button is worse than one fewer button.
 *
 * `onAccent` inverts the pair for the brand-coloured closing band.
 */
export function LandingCtaButtons({ onAccent = false }: { onAccent?: boolean }) {
  const formUrl = diagnosisFormUrl();

  const base =
    "inline-flex min-h-[52px] items-center justify-center rounded-xl px-6 py-3.5 text-lg font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
  const ring = onAccent ? "focus-visible:ring-white" : "focus-visible:ring-brand-700";
  const primary = onAccent
    ? "bg-surface text-brand-700 hover:bg-white"
    : "bg-brand-700 text-white hover:bg-brand-600";
  // white/70 border on brand-700 measures 3.48:1 — the 3:1 minimum for a control boundary.
  // white/50 measures 2.48:1 and leaves the secondary button's edge effectively invisible.
  const secondary = onAccent
    ? "border border-white/70 text-white hover:bg-white/10"
    : "border border-line text-ink hover:bg-canvas";

  if (!formUrl) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link to={DEMO_ENTRY_PATH} className={`${base} ${ring} ${primary}`}>
          {CTA_DEMO_LABEL}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <a
        href={formUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} ${ring} ${primary}`}
      >
        {CTA_DIAGNOSIS_LABEL}
        <span className="sr-only"> (새 창에서 열림)</span>
      </a>
      <Link to={DEMO_ENTRY_PATH} className={`${base} ${ring} ${secondary}`}>
        {CTA_DEMO_LABEL}
      </Link>
    </div>
  );
}
