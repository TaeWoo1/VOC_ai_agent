import { useCallback, useEffect, useState } from "react";
import { VocItemCard } from "./VocItemCard";
import { api } from "../lib/apiClient";
import { attentionUncertaintyCopy } from "../lib/attention";
import type { AttentionCoverage, OperatorVocItem } from "../lib/types";

// "제외한 작업" — the recovery home for reviews the operator set aside (작업에서 제외). It exists so a
// set-aside review is never a one-way trapdoor: it can be found here and put back (복원), at any age.
//
// Collapsed by default and LAZY: the read only fires once the seller opens it, so the common load
// pays nothing. Paged with 더 보기 rather than a hard cap, so an aged-out set-aside review is never
// hidden. 복원 writes nothing about the reply — no draft change, no outcome, no completion — it only
// moves the review back onto 내 답변 작업, where onRestored refetches it in.

/** One page's worth — small, because this is a recovery aid, not a list to live in. */
const PAGE_SIZE = 10;

type Status = "idle" | "loading" | "error" | "loaded";

export function DismissedReplyWork({
  accountId,
  refreshSignal,
  onRestored,
}: {
  accountId: string;
  /** Bumped by the parent when it sets a review aside, so an open recovery list picks it up. */
  refreshSignal: number;
  /** Fired after a successful 복원, so the parent refetches its to-do and the review reappears there. */
  onRestored: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<OperatorVocItem[]>([]);
  const [coverage, setCoverage] = useState<AttentionCoverage | null>(null);
  const [nextPage, setNextPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [restoring, setRestoring] = useState<string | null>(null);

  const loadPage = useCallback(
    async (page: number, replace: boolean) => {
      setStatus("loading");
      try {
        const view = await api.getDismissedReplyWork(accountId, { page, size: PAGE_SIZE });
        setCoverage(view.coverage);
        setItems((prev) => (replace ? view.items : [...prev, ...view.items]));
        setHasMore(view.hasMore);
        setNextPage(page + 1);
        setStatus("loaded");
      } catch {
        setStatus("error");
      }
    },
    [accountId],
  );

  // Open → first page. Also reset to page 0 when the account changes or the parent signals a change
  // (a review set aside elsewhere), but only while open — collapsed stays lazy.
  useEffect(() => {
    if (!expanded) return;
    void loadPage(0, true);
  }, [expanded, accountId, refreshSignal, loadPage]);

  const restore = useCallback(
    async (actionRef: string) => {
      if (restoring) return;
      setRestoring(actionRef);
      try {
        // A fresh idempotency key per intent, like dismissal — a retried click is the same restore.
        await api.restoreReplyWork(accountId, actionRef, { commandId: crypto.randomUUID() });
        // It is back on the to-do now: drop it here for immediate feedback, and tell the parent to
        // refetch so it reappears in 내 답변 작업 (which also re-signals this list).
        setItems((prev) => prev.filter((i) => i.actionRef !== actionRef));
        onRestored();
      } finally {
        setRestoring(null);
      }
    },
    [accountId, restoring, onRestored],
  );

  const uncertainty = coverage ? attentionUncertaintyCopy(coverage) : null;

  return (
    <div className="mt-6 border-t border-line pt-4">
      <button
        type="button"
        className="flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        data-testid="dismissed-work-toggle"
      >
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
        제외한 작업
      </button>

      {expanded ? (
        <div className="mt-3" data-testid="dismissed-work-panel">
          {status === "error" ? (
            <p className="rounded-xl bg-bad/5 px-4 py-3 text-sm text-bad">
              제외한 작업을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
            </p>
          ) : uncertainty ? (
            <div
              className="rounded-xl bg-warn/5 px-4 py-3"
              role="status"
              data-testid="dismissed-work-coverage-uncertain"
            >
              <p className="text-base font-semibold text-ink">{uncertainty.headline}</p>
              <p className="mt-1 text-sm text-muted">{uncertainty.detail}</p>
            </div>
          ) : status === "loading" && items.length === 0 ? (
            <p className="text-sm text-muted">불러오는 중…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted" data-testid="dismissed-work-empty">
              제외한 리뷰가 없습니다.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">
                작업에서 제외한 리뷰예요. '복원'하면 '내 답변 작업'에 다시 나타납니다. 저장한 초안과
                기록은 그대로예요.
              </p>
              <ul className="divide-y divide-line" data-testid="dismissed-work-list">
                {items.map((item) => (
                  <li key={item.actionRef} className="py-3">
                    {/* Read-only triage, like the to-do rows — this is a place to recover from, not a
                        second place to re-decide. */}
                    <VocItemCard item={item} accountId={accountId} triageMode="readonly" />
                    {item.actionRef ? (
                      <div className="mt-2">
                        <button
                          type="button"
                          className="rounded-lg bg-canvas px-2.5 py-1 text-sm font-semibold text-ink ring-1 ring-line disabled:opacity-50"
                          onClick={() => void restore(item.actionRef!)}
                          disabled={restoring === item.actionRef}
                          data-testid="dismissed-work-restore"
                        >
                          {restoring === item.actionRef ? "복원하는 중…" : "복원"}
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {hasMore ? (
                <button
                  type="button"
                  className="mt-3 rounded-lg px-2.5 py-1 text-sm text-muted underline underline-offset-2 hover:text-ink disabled:opacity-50"
                  onClick={() => void loadPage(nextPage, false)}
                  disabled={status === "loading"}
                  data-testid="dismissed-work-more"
                >
                  {status === "loading" ? "불러오는 중…" : "더 보기"}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
