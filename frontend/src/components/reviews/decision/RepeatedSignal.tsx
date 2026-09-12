import { Link } from "react-router-dom";
import { Section, ListBox } from "../../ui/Section";
import { SEVERITY_LABEL_KO } from "../../../lib/reviewIssuesView";
import { ratingLabel } from "../../../lib/reviewRecord";
import type { IssueSeverity, ReviewDecisionProblem } from "../../../lib/types";

/**
 * <b>반복 신호</b> — the third question: has anyone said this before, and who.
 *
 * <b>The similarity is the extractor's, not this screen's.</b> Every review listed here is one the
 * issue pipeline already recorded as evidence for the same problem this review backs. There is no
 * "looks alike" judgement anywhere in this component, and there must not be one: this repository has
 * exactly one similarity mechanism (the aspect+problem signature), and a second one invented for a
 * workspace would be an unmeasured classifier deciding what a seller reads first.
 *
 * <b>An empty list is a statement about our records.</b> 「아직 반복 문제의 근거로 기록되지 않았습니다」
 * — not 「반복된 적 없습니다」, which would be a claim about the world made from one table. A failed
 * read renders nothing at all, because a screen that could not see the issue memory has nothing to say
 * about it.
 *
 * <b>No count is invented.</b> `evidenceCount` is org-wide and all-time, exactly as the 고객운영 메모리
 * list means it, and the per-problem 근거 전체 보기 link is where the whole set is measured.
 */
export function RepeatedSignal({
  problems,
  failed,
}: {
  problems: ReviewDecisionProblem[];
  /** The context read did not return. Renders nothing — see above. */
  failed: boolean;
}) {
  if (failed) return null;

  if (problems.length === 0) {
    return (
      <Section title="반복 신호">
        <p className="break-keep text-sm leading-relaxed text-muted">
          이 리뷰는 아직 반복 문제의 근거로 기록되지 않았습니다. 같은 이야기가 쌓이면 고객운영 메모리에 문제로 모입니다.
        </p>
      </Section>
    );
  }

  return (
    <Section title="반복 신호" count={problems.length}>
      <ListBox>
        {problems.map((problem) => {
          const severity =
            problem.severity && problem.severity in SEVERITY_LABEL_KO
              ? SEVERITY_LABEL_KO[problem.severity as IssueSeverity]
              : null;
          return (
            <div key={problem.issueId} className="space-y-2 border-b border-line p-4 last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <Link
                  to={`/memory/${problem.issueId}`}
                  className="break-keep text-sm font-semibold text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
                >
                  {problem.title}
                  <span className="ml-1 text-brand-700" aria-hidden="true">›</span>
                </Link>
                {severity ? <span className="text-sm text-muted">심각도 {severity}</span> : null}
                <span className="text-sm tabular-nums text-muted">근거 {problem.evidenceCount}건</span>
                {problem.dismissed ? <span className="text-sm text-muted">보지 않기로 한 문제</span> : null}
              </div>

              {problem.similar.length > 0 ? (
                <ul className="space-y-1.5">
                  {problem.similar.map((similar) => (
                    <li key={`${similar.reviewId}-${similar.occurredOn ?? ""}`} className="space-y-0.5">
                      {/* The quote is masked at read time and is null when masking suppressed it — then
                          the row says only when and how it was rated, rather than showing an empty
                          bubble that reads as "the customer wrote nothing". */}
                      {similar.quote ? (
                        <p className="break-keep text-sm leading-relaxed text-ink">「{similar.quote}」</p>
                      ) : null}
                      <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                        <span className="tabular-nums">{similar.occurredOn ?? "날짜 없음"}</span>
                        <span className="tabular-nums">{ratingLabel(similar.rating)}</span>
                        {/* The product is named only when it is a DIFFERENT one: on this screen every
                            row shares the product being decided, and repeating it once per line is the
                            shape this product states once. A different product is new information. */}
                        {!similar.sameProduct && similar.productName ? (
                          <span className="break-keep">{similar.productName}</span>
                        ) : null}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="break-keep text-sm text-muted">이 문제의 근거는 지금 보고 계신 리뷰뿐입니다.</p>
              )}
            </div>
          );
        })}
      </ListBox>
    </Section>
  );
}
