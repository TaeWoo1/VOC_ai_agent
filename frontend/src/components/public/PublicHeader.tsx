import { Link } from "react-router-dom";
import { CTA_DEMO_LABEL, CTA_DIAGNOSIS_LABEL, DEMO_ENTRY_PATH, PRODUCT_PATH, diagnosisFormUrl } from "../../lib/public/publicCta";

/**
 * Public-surface header. Deliberately thin: brand mark, sign-in, one action.
 *
 * Carries NO app state — no auth, no alert counts, no API. The public surface must render for a
 * visitor who has never signed in, so a dependency on `useAuth`/`useOpenAlerts` here would be a
 * defect, not a convenience.
 *
 * The action is the diagnosis CTA when a form URL is configured. When it is not, the header falls
 * back to the demo CTA rather than rendering a dead button (see `diagnosisFormUrl`).
 */
export function PublicHeader() {
  const formUrl = diagnosisFormUrl();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 md:px-8">
        <Link
          to={PRODUCT_PATH}
          className="rounded-lg text-lg font-bold tracking-tight text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
        >
          SellerOps
        </Link>

        <nav aria-label="공개 페이지" className="flex items-center gap-2 sm:gap-3">
          <Link
            to="/login"
            className="rounded-xl px-3 py-2 text-base font-medium text-muted transition hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
          >
            로그인
          </Link>
          {formUrl ? (
            <a
              href={formUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-xl bg-brand-700 px-4 py-2.5 text-base font-semibold text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
            >
              {CTA_DIAGNOSIS_LABEL}
              <span className="sr-only"> (새 창에서 열림)</span>
            </a>
          ) : (
            <Link
              to={DEMO_ENTRY_PATH}
              className="inline-flex items-center justify-center rounded-xl bg-brand-700 px-4 py-2.5 text-base font-semibold text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
            >
              {CTA_DEMO_LABEL}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
