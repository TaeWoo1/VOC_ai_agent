import { hasRatingEvidence, ratingBands } from "../../../lib/repeatedIssue";
import type { IssueRatingDistributionView } from "../../../lib/types";

/**
 * <b>어떤 별점에서 나왔나</b> — the star bands this problem was raised in, as counts.
 *
 * <b>Why a seller needs it.</b> A repeated problem spoken about entirely inside 4–5★ reviews is
 * invisible to every screen that sorts by rating, and it is a different kind of problem from one
 * that arrives with 1★ anger: nobody is complaining, and it still keeps happening. On this org
 * 접착 부족 is exactly that — 5★ 10건, 1–2★ 0건.
 *
 * <b>Counts only.</b> No share, no average, no ranking. The bar widths below are drawn relative to
 * the largest band and carry no number of their own; they are a reading aid for the counts beside
 * them, which is why every row also states its figure.
 */
export function RatingSpread({
  distribution,
  failed,
}: {
  distribution: IssueRatingDistributionView | null;
  failed: boolean;
}) {
  if (failed || !distribution || !hasRatingEvidence(distribution)) return null;

  const bands = ratingBands(distribution);
  const largest = Math.max(...bands.map((band) => band.count), 1);

  return (
    <section aria-label="어떤 별점에서 나왔나">
      <h3 className="text-base font-bold text-ink">어떤 별점에서 나왔나</h3>
      <ul className="mt-2 space-y-1.5">
        {bands.map((band) => (
          <li key={band.key} className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-sm text-muted">{band.labelKo}</span>
            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-canvas">
              {/* Decorative: the count beside it is the fact. Hidden from assistive tech so a
                  screen reader hears the number once, not a width it cannot check. */}
              <span
                aria-hidden="true"
                className="block h-full rounded-full bg-brand-700"
                style={{ width: `${(band.count / largest) * 100}%` }}
              />
            </span>
            <span className="w-16 shrink-0 text-right text-sm tabular-nums text-ink">
              근거 {band.count}건
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
