import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/apiClient";
import {
  CHANGE_EXPLANATION_KO,
  SEVERITY_LABEL_KO,
  changeBadges,
  investigationHintKo,
  nextActionKo,
  productLineKo,
  provenanceKo,
  renderableQuotes,
  suppressedQuoteCount,
  surgeLine,
  waitingNoteKo,
} from "../../lib/reviewIssuesView";
import { evidenceInboxRef } from "../../lib/memoryView";
import type { ReviewIssueDetailView, ReviewIssueView } from "../../lib/types";
import { Btn } from "../ui/Btn";

/**
 * Evidence, trend, history and the one action the lifecycle actually allows.
 *
 * The action comes from `nextActionKo`, which returns null wherever the only legitimate next move
 * belongs to SellerOps — so no button is invented for a state that has none. There is deliberately
 * no 해결 처리 control anywhere: 해결됨 is reached by observing quiet weeks after recorded
 * remediation, and a button would let an assertion stand in for that evidence.
 */
export function IssueDetailPanel({
  issue,
  loadedInboxIds,
  onIssueChanged,
}: {
  issue: ReviewIssueView;
  loadedInboxIds: ReadonlySet<string>;
  onIssueChanged: (next: ReviewIssueView) => void;
}) {
  const [detail, setDetail] = useState<ReviewIssueDetailView | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setDetail(await api.getReviewIssueDetailStrict(issue.id));
    } catch {
      setDetail(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [issue.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const actionLabel = nextActionKo(issue.lifecycleState);
  const waiting = waitingNoteKo(issue.lifecycleState);
  const surge = surgeLine(issue.change);
  const product = productLineKo(issue);
  const hint = investigationHintKo(issue);
  const badges = changeBadges(issue.change);

  async function runAction() {
    setBusy(true);
    setActionError(null);
    try {
      const next =
        issue.lifecycleState === "NEEDS_REVIEW"
          ? await api.startReviewIssueAction(issue.id)
          : await api.markReviewIssueRemediated(issue.id);
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
    <article aria-label="선택한 이슈" className="space-y-6">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-canvas px-2.5 py-0.5 text-xs font-semibold text-muted">
            {issue.lifecycleLabelKo}
          </span>
          <span className="text-sm text-muted">심각도 {SEVERITY_LABEL_KO[issue.severity]}</span>
        </div>
        <h2 className="mt-3 break-keep text-xl font-bold text-ink">{issue.title}</h2>
        {product ? <p className="mt-1.5 break-keep text-muted">{product}</p> : null}
      </header>

      <section>
        <h3 className="text-base font-bold text-ink">왜 올라왔나요</h3>
        <ul className="mt-2 space-y-1.5">
          {badges.map((badge) => (
            <li key={badge.kind} className="break-keep leading-relaxed text-muted">
              <span className="font-semibold text-ink">{badge.labelKo}</span> —{" "}
              {CHANGE_EXPLANATION_KO[badge.kind]}
            </li>
          ))}
          {badges.length === 0 ? (
            <li className="break-keep leading-relaxed text-muted">
              최근 판단된 변화는 없지만 관련 리뷰가 기록되어 있습니다.
            </li>
          ) : null}
        </ul>
        {surge ? <p className="mt-3 text-sm tabular-nums text-muted">{surge}</p> : null}
        {hint ? <p className="mt-3 break-keep leading-relaxed text-ink">{hint}</p> : null}
      </section>

      <section>
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
                  .map((row) => {
                    const to = evidenceInboxRef(row.reviewId, loadedInboxIds);
                    return (
                      <li
                        key={`${row.reviewId}-${row.unitOrdinal}`}
                        className="rounded-xl bg-canvas p-4"
                      >
                        <p className="break-keep leading-relaxed text-ink">“{row.quote}”</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                          <span>{row.occurredOn}</span>
                          {row.productName ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{row.productName}</span>
                            </>
                          ) : null}
                          {/* Linked only when that row is actually in the loaded inbox. */}
                          {to ? (
                            <Link
                              to={to}
                              className="ml-auto rounded font-semibold text-brand-700 transition hover:text-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
                            >
                              인박스에서 보기
                            </Link>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
              </ul>
            ) : (
              <p className="mt-2 text-muted">표시할 수 있는 인용이 없습니다.</p>
            )}
            {suppressed > 0 ? (
              <p className="mt-3 text-sm text-muted">
                인용을 표시할 수 없는 근거가 {suppressed}건 더 있습니다.
              </p>
            ) : null}
          </>
        )}
      </section>

      {detail && detail.history.length > 0 ? (
        <section>
          <h3 className="text-base font-bold text-ink">기록</h3>
          <ul className="mt-2 space-y-2">
            {detail.history.map((event) => (
              <li key={`${event.at}-${event.toState}`} className="text-sm text-muted">
                <span className="font-medium text-ink">{event.toStateLabelKo}</span>
                {" · "}
                {event.actor === "OPERATOR" ? "운영자" : "SellerOps"}
                {" · "}
                {event.at.slice(0, 10)}
                {event.note ? <span className="block break-keep">{event.note}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="border-t border-line pt-5">
        {waiting ? <p className="break-keep leading-relaxed text-muted">{waiting}</p> : null}
        {actionLabel ? (
          <div className="mt-3">
            <Btn size="sm" onClick={runAction} disabled={busy}>
              {busy ? "처리 중…" : actionLabel}
            </Btn>
          </div>
        ) : null}
        {actionError ? <p className="mt-2 text-sm text-bad">{actionError}</p> : null}
        <p className="mt-4 break-keep text-xs leading-relaxed text-muted">{provenanceKo(issue)}</p>
      </section>
    </article>
  );
}
