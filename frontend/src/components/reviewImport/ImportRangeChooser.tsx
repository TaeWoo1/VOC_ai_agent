import { useEffect, useState } from "react";
import { api } from "../../lib/apiClient";
import { monthOptions, rangeChoiceSummary, RANGE_CHOICE_COPY } from "../../lib/reviewImport";
import type { ReviewImportPlanDetailView, ReviewImportRangeSelectionView } from "../../lib/types";

/**
 * **How far back to import — the seller's decision, made once, before anything opens.**
 *
 * ## What this replaced, and why
 *
 * Until 2026-07-26 the first thing the seller's click did was open their seller center and walk them through
 * NAVER's date pickers to find the earliest date the marketplace would let them reach. The 2026-07-25 live run
 * established that NAVER's review calendar restricts nothing: there was no limit to find, so the tutorial was
 * asking about a constraint that does not exist (proof record, finding 16). The real question was never "what
 * does NAVER allow" — it is "how much of your history do you want", and only the seller can answer it.
 *
 * ## Two rules the product owner set for this screen
 *
 *  1. **A month, ending today.** They pick the start month; the end is today. Segments are calendar months, so
 *     offering a day would imply a precision the plan does not have.
 *  2. **Confirm the consequence, not just the period.** The count of monthly exports is shown BEFORE the plan
 *     exists, because three years reads like one click and is 37 exports the seller performs by hand. Agreeing
 *     to a period without seeing that is agreeing to work they were not told about.
 *
 * Both numbers come from the server: "today" is its clock, and the count is the one the planner will really
 * produce. This component computes neither.
 */
export interface ImportRangeChooserProps {
  accountId: string;
  /** Called with the created plan, so the page can move straight on to the first guided segment. */
  onCreated: (plan: ReviewImportPlanDetailView) => void;
  /** Test seam: the month the list counts back from. Defaults to the browser's current month. */
  today?: string;
}

/** Only ever used to POPULATE the list. The period that gets created is always the server's. */
function browserMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function ImportRangeChooser({ accountId, onCreated, today }: ImportRangeChooserProps) {
  const options = monthOptions(today ?? `${browserMonth()}-01`.slice(0, 7));
  // Default a year back where possible: far enough to be worth doing, short enough not to look punishing.
  const [startMonth, setStartMonth] = useState(options[Math.min(12, options.length - 1)]?.value ?? options[0]?.value ?? "");
  const [preview, setPreview] = useState<ReviewImportRangeSelectionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-preview on every change of month. The seller is choosing by consequence, so the consequence has to keep
  // up with the choice rather than appear only after they commit.
  useEffect(() => {
    if (!startMonth) return;
    let live = true;
    setError(null);
    api
      .previewReviewImportRange(accountId, startMonth)
      .then((next) => {
        if (live) setPreview(next);
      })
      .catch(() => {
        if (live) {
          setPreview(null);
          setError(RANGE_CHOICE_COPY.previewFailed);
        }
      });
    return () => {
      live = false;
    };
  }, [accountId, startMonth]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const plan = await api.selectReviewImportRange(accountId, startMonth);
      onCreated(plan);
    } catch {
      setError(RANGE_CHOICE_COPY.createFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-canvas px-4 py-4" data-testid="range-chooser">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-ink break-keep">{RANGE_CHOICE_COPY.title}</p>
        <p className="text-sm text-muted break-keep">{RANGE_CHOICE_COPY.body}</p>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        {RANGE_CHOICE_COPY.monthLabel}
        <select
          value={startMonth}
          onChange={(e) => setStartMonth(e.target.value)}
          data-testid="range-start-month"
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {/* The period AND its cost. Never one without the other. */}
      {preview ? (
        <p className="text-sm font-medium text-ink break-keep" data-testid="range-preview">
          {rangeChoiceSummary(preview)}
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-bad break-keep" role="alert" data-testid="range-error">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={confirm}
        // Nothing is created until a preview has come back: the seller confirms a period they have actually seen.
        disabled={busy || preview === null}
        data-testid="range-confirm"
        className="self-start rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {busy ? RANGE_CHOICE_COPY.confirming : RANGE_CHOICE_COPY.confirm}
      </button>
    </div>
  );
}
