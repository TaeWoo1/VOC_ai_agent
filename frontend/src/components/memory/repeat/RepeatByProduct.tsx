import { Link } from "react-router-dom";
import { productSpanLine, repeatLine, unattributedLine } from "../../../lib/repeatedIssue";
import type { IssueEvidenceSummaryView } from "../../../lib/types";

/**
 * <b>어디서 얼마나 반복되나</b> — the question a repeated problem exists to raise.
 *
 * <b>Every row shows both numbers and no ratio.</b> 「리뷰 1,761건 중 16건」 is what the read
 * measured; 0.9% is a rate over a population nobody examined. The component cannot compute one
 * because it never sees the two numbers apart from the sentence that pairs them.
 *
 * <b>A failed read renders nothing.</b> A screen that could not see where a problem repeats has
 * nothing to say about where it repeats — and 「0개 상품」 would be that screen saying it anyway.
 */
export function RepeatByProduct({
  evidence,
  failed,
}: {
  evidence: IssueEvidenceSummaryView | null;
  failed: boolean;
}) {
  if (failed || !evidence) return null;

  const unattributed = unattributedLine(evidence.unattributedEvidence);

  return (
    <section aria-label="어디서 반복되나">
      <h3 className="text-base font-bold text-ink">어디서 반복되나</h3>
      {evidence.byProduct.length === 0 ? (
        <p className="mt-2 break-keep leading-relaxed text-muted">
          이 문제의 근거가 어느 상품에도 연결되어 있지 않습니다.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
          {evidence.byProduct.map((row) => {
            const span = productSpanLine(row);
            return (
              <li key={row.productId} className="space-y-1 p-4">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  {/* The product page is the other place this problem is already counted, so the
                      name is the door to it rather than plain text beside a door. */}
                  <Link
                    to={`/products/${row.productId}`}
                    className="break-keep font-semibold text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
                  >
                    {row.productName ?? "이름이 확인되지 않은 상품"}
                    <span className="ml-1 text-brand-700" aria-hidden="true">›</span>
                  </Link>
                </div>
                <p className="break-keep text-sm tabular-nums text-muted">{repeatLine(row)}</p>
                {span ? (
                  <p className="text-sm tabular-nums text-muted">이 상품의 근거 기간 {span}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {unattributed ? (
        <p className="mt-3 break-keep text-sm leading-relaxed text-muted">{unattributed}</p>
      ) : null}
    </section>
  );
}
