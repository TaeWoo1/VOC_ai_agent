import { useCallback, useState } from "react";
import { Section } from "./Section";
import { VocItemCard } from "./VocItemCard";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { attentionUncertaintyCopy } from "../lib/attention";

// "내 답변 작업" — the operator's OWN committed reply work, and a bounded record of what they
// reported posting.
//
// WHY THIS EXISTS. Everything a seller committed to — a 대응 필요 decision, a saved draft — used to be
// reachable only by re-entering the exact arrival-signal drill-down that raised the row, which is
// window-, signal- and page-scoped and resets on any window or account change. An interrupted draft
// had no home. This is that home: it is deliberately NOT window-scoped, so a commitment survives a
// reload, a window change and a new session.
//
// It reuses VocItemCard (and through it the existing reply-preparation panel) unchanged — this slice
// adds a place to stand, not a second way to reply. No auto-drafting, no dispatching, no completion
// claim: every reported row is UNVERIFIED and is labelled as such.

/** Bounded — a record of recent work, not a history to page through. */
const RECENT_LIMIT = 5;

export function MyReplyWork({ accountId }: { accountId: string }) {
  // Bumped when an operator records an outcome OR sets a review aside, so a row leaves the to-do
  // without a manual reload.
  const [reloadKey, setReloadKey] = useState(0);
  const noteOutcomeRecorded = useCallback(() => setReloadKey((k) => k + 1), []);
  // The row currently being set aside, so its control can show progress and never fire twice.
  const [dismissing, setDismissing] = useState<string | null>(null);

  const { data, loading, error } = useApiData(
    () => api.getReplyWork(accountId, { recentLimit: RECENT_LIMIT }),
    [accountId, reloadKey],
  );

  const dismiss = useCallback(
    async (actionRef: string) => {
      if (dismissing) return;
      setDismissing(actionRef);
      try {
        // A fresh idempotency key PER intent — a retried click is the same dismissal, a new click
        // (after re-entry) is a new one.
        await api.dismissReplyWork(accountId, actionRef, { commandId: crypto.randomUUID() });
        setReloadKey((k) => k + 1);
      } finally {
        setDismissing(null);
      }
    },
    [accountId, dismissing],
  );

  // The same false-calm guard the attention surface carries: a scope we cannot attribute must never
  // render as "no work".
  const uncertainty = data ? attentionUncertaintyCopy(data.coverage) : null;

  return (
    <Section title="내 답변 작업">
      {loading ? (
        <p className="text-base text-muted">불러오는 중…</p>
      ) : error || !data ? (
        <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">
          답변 작업을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : uncertainty ? (
        <div
          className="rounded-xl bg-warn/5 px-4 py-3"
          role="status"
          data-testid="reply-work-coverage-uncertain"
        >
          <p className="text-base font-semibold text-ink">{uncertainty.headline}</p>
          <p className="mt-1 text-sm text-muted">{uncertainty.detail}</p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            대응 필요로 표시했거나 답변 초안을 저장한 리뷰예요. 화면을 새로 열어도 그대로 남아 있습니다.
          </p>

          {data.todo.length === 0 ? (
            <p className="text-base text-muted" data-testid="reply-work-todo-empty">
              아직 답변을 준비하기로 한 리뷰가 없습니다.
            </p>
          ) : (
            <ul className="divide-y divide-line" data-testid="reply-work-todo">
              {data.todo.map((item) => (
                <li key={item.actionRef} className="py-3">
                  <VocItemCard
                    item={item}
                    accountId={accountId}
                    onOutcomeRecorded={noteOutcomeRecorded}
                  />
                  {item.actionRef ? (
                    <div className="mt-2">
                      {/* Sets the review aside from THIS list only — it does not delete the draft,
                          does not record a reply, and does not claim completion. The review returns
                          on its own when the operator re-marks 대응 필요 or saves a new draft. */}
                      <button
                        type="button"
                        className="text-sm text-muted underline underline-offset-2 hover:text-ink disabled:opacity-50"
                        onClick={() => dismiss(item.actionRef!)}
                        disabled={dismissing === item.actionRef}
                        data-testid="reply-work-dismiss"
                      >
                        {dismissing === item.actionRef ? "제외하는 중…" : "작업에서 제외"}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {data.recentlyReported.length > 0 ? (
            <div className="mt-6" data-testid="reply-work-recent">
              <h3 className="text-base font-semibold text-ink">최근에 기록한 답변</h3>
              {/* Two facts, always paired: the operator reported it, and SellerOps did not verify it.
                  Never "완료" — a public reply has no read-back oracle. */}
              <p className="mb-3 mt-1 text-sm text-muted">
                답변했다고 기록한 리뷰예요. SellerOps는 채널에 실제로 등록됐는지 확인하지 않습니다
                (확인 안 함).
              </p>
              <ul className="divide-y divide-line">
                {data.recentlyReported.map((item) => (
                  <li key={item.actionRef} className="py-3">
                    <VocItemCard
                      item={item}
                      accountId={accountId}
                      onOutcomeRecorded={noteOutcomeRecorded}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}
