import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/apiClient";
import {
  CHANGE_EXPLANATION_KO,
  SEVERITY_LABEL_KO,
  changeBadges,
  investigationHintKo,
  nextActionKo,
  provenanceKo,
  renderableQuotes,
  suppressedQuoteCount,
  surgeLine,
} from "../../lib/reviewIssuesView";
import { kstDate } from "../../lib/format";
import type {
  IssueLifecycleState,
  RepeatedIssueContext,
  ReviewIssueDetailView,
  ReviewIssueView,
} from "../../lib/types";
import { OpportunityList } from "../opportunity/OpportunityList";
import { Facts } from "../ui/ObjectRow";
import { CaseBlock, CaseLayout, DecisionCard } from "../workspace/CaseLayout";
import { IssueDecision } from "./repeat/IssueDecision";
import { IssueGrounding } from "./repeat/IssueGrounding";
import { RatingSpread } from "./repeat/RatingSpread";
import { RepeatByProduct } from "./repeat/RepeatByProduct";

/**
 * <b>Repeated Issue workspace</b> — judging one repeated problem end to end, without leaving it.
 *
 * <p>The order is the seller's reading order, and each block answers one question:
 * 무슨 문제인가 → 왜 지금 보는가 → 어디서 얼마나 반복되는가 → 누가 무슨 말을 했나 →
 * 우리가 이미 써 둔 것이 있나 → 무엇을 할 수 있나 → 무엇을 하기로 했나 → 무엇을 했나.
 *
 * <p><b>Two reads, and they fail apart.</b> The detail read carries the problem, its evidence and its
 * record; the repeat-context read carries where it repeats and what the library says. A screen that
 * could not reach one still shows the other, and neither renders a placeholder number in the other's
 * place — the way a workspace like this goes wrong is a plausible figure nobody measured.
 *
 * <p><b>No count is derived here.</b> Every number on this screen came from a read that measured it.
 * In particular the per-product line prints a pair and never a percentage: see
 * {@code lib/repeatedIssue.ts}.
 *
 * <p><b>The decision is the issue lifecycle, unchanged.</b> There is no second decision vocabulary
 * for a repeated problem — {@code IssueLifecycleState} has been that vocabulary since the lifecycle
 * existed, with a state machine that refuses the transitions only evidence may make. What this
 * package added is the seller's own sentence beside the transition, which the API has always
 * accepted and no screen had ever sent. There is still no 해결 처리 control at any state.
 */
/**
 * The states a seller may START remediation from — the client's half of
 * `IssueLifecycleState.sellerMayStartActing()`, which refuses anything this set does not allow. Kept
 * as a set beside the call that branches on it so widening one state cannot silently turn a start
 * into a completion.
 */
const ACTING_STATES = new Set<IssueLifecycleState>(["OBSERVING", "NEEDS_REVIEW"]);

export function IssueDetailPanel({
  issue,
  onIssueChanged,
}: {
  issue: ReviewIssueView;
  onIssueChanged: (next: ReviewIssueView) => void;
}) {
  const [detail, setDetail] = useState<ReviewIssueDetailView | null>(null);
  const [context, setContext] = useState<RepeatedIssueContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [contextFailed, setContextFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    setContextFailed(false);
    // Issued together and settled independently: neither block may be held back by the other's
    // latency, and neither may be blanked by the other's failure.
    const [detailResult, contextResult] = await Promise.allSettled([
      api.getReviewIssueDetailStrict(issue.id),
      api.getRepeatedIssueContextStrict(issue.id),
    ]);
    if (detailResult.status === "fulfilled") {
      setDetail(detailResult.value);
    } else {
      setDetail(null);
      setFailed(true);
    }
    if (contextResult.status === "fulfilled") {
      setContext(contextResult.value);
    } else {
      setContext(null);
      setContextFailed(true);
    }
    setLoading(false);
  }, [issue.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const surge = surgeLine(issue.change);
  const hint = investigationHintKo(issue);
  const badges = changeBadges(issue.change);

  async function runAction(note: string) {
    setBusy(true);
    setActionError(null);
    try {
      const trimmed = note.trim();
      // Which transition this is, asked of the STATE rather than compared to one constant. It used
      // to test `=== "NEEDS_REVIEW"` and fall through to 조치 완료 for everything else, which was
      // correct only while NEEDS_REVIEW was the single state a seller could start from: the moment
      // OBSERVING joined it, an observed problem's 조치 시작 button called 조치 완료로 기록 — the
      // screen recording that work had FINISHED because it had not been told work could begin here.
      const next = ACTING_STATES.has(issue.lifecycleState)
        ? await api.startReviewIssueAction(issue.id, trimmed || undefined)
        : await api.markReviewIssueRemediated(issue.id, trimmed || undefined);
      onIssueChanged(next);
      await load();
    } catch {
      setActionError("상태를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  const quotes = detail ? renderableQuotes(detail.evidence) : [];
  const suppressed = detail ? suppressedQuoteCount(detail.evidence) : 0;

  return (
    <CaseLayout
      variant="pane"
      label="선택한 이슈"
      decisionLabel="판매자의 결정"
      meta={
        <Facts>
          <span className="font-semibold text-ink">{issue.lifecycleLabelKo}</span>
          <span>심각도 {SEVERITY_LABEL_KO[issue.severity]}</span>
        </Facts>
      }
      title={issue.title}
      subject={
        <CaseBlock title="왜 올라왔나요" tone="subject">
          <ul className="space-y-1.5">
            {badges.map((badge) => (
              <li key={badge.kind} className="break-keep leading-relaxed text-muted">
                <span className="font-semibold text-ink">{badge.labelKo}</span> — {CHANGE_EXPLANATION_KO[badge.kind]}
              </li>
            ))}
            {badges.length === 0 ? (
              <li className="break-keep leading-relaxed text-muted">최근 판단된 변화는 없지만 관련 리뷰가 기록되어 있습니다.</li>
            ) : null}
          </ul>
          {surge ? <p className="mt-3 text-sm tabular-nums text-muted">{surge}</p> : null}
          {hint ? <p className="mt-3 break-keep leading-relaxed text-ink">{hint}</p> : null}
        </CaseBlock>
      }
      decision={
        // The one thing a seller does here, straight after why it is here — it used to be the eighth block, four
        // screens down, under the evidence and the opportunities.
        <DecisionCard primary={nextActionKo(issue.lifecycleState) !== null}>
          <IssueDecision state={issue.lifecycleState} busy={busy} error={actionError} onSubmit={runAction} />
        </DecisionCard>
      }
      context={
        <>
          {/* Where it repeats, and against how many reviews. */}
          <RepeatByProduct evidence={context?.evidence ?? null} failed={contextFailed} />

          {/* In what kind of review — the shape of the evidence before three examples of it. */}
          <RatingSpread distribution={context?.evidence.ratingDistribution ?? null} failed={contextFailed} />

          <section aria-label="근거" className="border-t border-line pt-4">
            <h3 className="text-base font-bold text-ink">근거</h3>
            {loading ? (
              <p className="mt-2 text-muted">근거를 불러오는 중…</p>
            ) : failed ? (
              <p className="mt-2 text-muted">근거를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
            ) : (
              <>
                {quotes.length > 0 ? (
                  <ul className="mt-2 space-y-3">
                    {(detail?.evidence ?? [])
                      .filter((row) => row.quote && row.quote.trim().length > 0)
                      .slice(0, 3)
                      .map((row) => (
                        <li key={`${row.reviewId}-${row.unitOrdinal}`} className="rounded-xl bg-canvas p-4">
                          <p className="break-keep leading-relaxed text-ink">“{row.quote}”</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                            <span>{row.occurredOn}</span>
                            {row.productName ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{row.productName}</span>
                              </>
                            ) : null}
                            {/* Back to the review that produced this evidence — the ONE surface where a review is
                                judged and answered. Needs nothing but the review id. */}
                            <Link
                              to={`/reviews/reply/${row.reviewId}`}
                              className="ml-auto rounded font-semibold text-brand-700 transition hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
                            >
                              이 리뷰 처리하기
                            </Link>
                          </div>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-muted">표시할 수 있는 인용이 없습니다.</p>
                )}
                {suppressed > 0 ? (
                  <p className="mt-3 text-sm text-muted">인용을 표시할 수 없는 근거가 {suppressed}건 더 있습니다.</p>
                ) : null}
              </>
            )}
          </section>
        </>
      }
      more={
        <>
          <IssueGrounding knowledge={context?.knowledge ?? null} failed={contextFailed} />

          {/* Opportunity Engine v1 — what can be done about this. The heading is always drawn so the seller learns
              the product HAS this layer even on an issue that yields nothing. */}
          <section aria-label="개선 기회" className="border-t border-line pt-4">
            <h3 className="text-base font-bold text-ink">개선 기회</h3>
            <OpportunityList issueId={issue.id} />
          </section>

          {detail && detail.history.length > 0 ? (
            <section aria-label="기록" className="border-t border-line pt-4">
              <h3 className="text-base font-bold text-ink">기록</h3>
              <ul className="mt-2 space-y-2">
                {detail.history.map((event) => (
                  <li key={`${event.at}-${event.toState}`} className="text-sm text-muted">
                    <span className="font-medium text-ink">{event.toStateLabelKo}</span>
                    {" · "}
                    {event.actor === "OPERATOR" ? "운영자" : "reviewnary"}
                    {" · "}
                    {kstDate(event.at)}
                    {event.note ? <span className="block break-keep text-ink">{event.note}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="break-keep text-sm leading-relaxed text-muted">{provenanceKo(issue)}</p>
        </>
      }
    />
  );
}
