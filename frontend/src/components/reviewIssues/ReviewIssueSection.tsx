import { useCallback, useMemo, useState } from "react";
import { Section } from "../Section";
import { api } from "../../lib/apiClient";
import { useApiData } from "../../lib/useApiData";
import type { ReviewIssueView } from "../../lib/types";
import {
  changedIssues,
  improvedIssues,
  issuesSummary,
  provenanceKo,
  steadyIssues,
} from "../../lib/reviewIssuesView";
import { ReviewIssueCard } from "./ReviewIssueCard";

/**
 * The persistent-issue surface: 지금 확인할 변화 first, then improvements, then the issues with
 * nothing new to say.
 *
 * <p><b>Fails closed, never to a mock.</b> This section answers "has something changed in what
 * customers are telling you", and a seeded placeholder would be a fabricated answer the operator
 * cannot distinguish from a real one. An error renders as an error.
 *
 * <p><b>Improvements are shown, not hidden.</b> Without them this is a surface that only ever raises
 * alarms, and a seller has no way to see whether their own work changed anything.
 */
export function ReviewIssueSection() {
  // `useApiData` loads once per deps change and exposes no reload, so a bumped key is how a
  // successful write refetches. Refetching (rather than patching state locally) is deliberate: a
  // lifecycle move can change which judgements fire, so only the server knows the new card.
  const [refreshKey, setRefreshKey] = useState(0);
  const issues = useApiData(() => api.getReviewIssuesStrict(), [refreshKey]);
  // The dismissed list is a second request, not a filter of the first: mixing them would put issues
  // the operator explicitly set aside back among the ones asking for attention. It is not strict —
  // failing to load an archive should not take down the working list.
  const dismissed = useApiData(
    () => api.getReviewIssuesStrict({ dismissed: true }).catch(() => [] as ReviewIssueView[]),
    [refreshKey],
  );
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const all = useMemo<ReviewIssueView[]>(() => issues.data ?? [], [issues.data]);
  const summary = useMemo(() => issuesSummary(all), [all]);
  const changed = useMemo(() => changedIssues(all), [all]);
  const improved = useMemo(() => improvedIssues(all), [all]);
  const steady = useMemo(() => steadyIssues(all), [all]);

  const run = useCallback(
    async (issue: ReviewIssueView, call: () => Promise<unknown>) => {
      setPending(issue.id);
      setActionError(null);
      try {
        await call();
        setRefreshKey((key) => key + 1);
      } catch {
        // No optimistic state: the lifecycle is server-authoritative, and a card that showed
        // 조치 중 after a failed write would misreport what SellerOps recorded.
        setActionError("상태를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      } finally {
        setPending(null);
      }
    },
    [],
  );

  const advance = useCallback(
    (issue: ReviewIssueView) =>
      run(issue, () =>
        issue.lifecycleState === "NEEDS_REVIEW"
          ? api.startReviewIssueAction(issue.id)
          : api.markReviewIssueRemediated(issue.id),
      ),
    [run],
  );

  const dismiss = useCallback(
    (issue: ReviewIssueView) => run(issue, () => api.dismissReviewIssue(issue.id)),
    [run],
  );

  const restore = useCallback(
    (issue: ReviewIssueView) => run(issue, () => api.restoreReviewIssue(issue.id)),
    [run],
  );

  const dismissedList = dismissed.data ?? [];

  if (issues.loading) {
    return <Section title="지금 확인할 변화"><p className="text-muted">불러오는 중…</p></Section>;
  }

  if (issues.error) {
    return (
      <Section title="지금 확인할 변화">
        <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">
          고객 반응 변화를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </div>
      </Section>
    );
  }

  if (all.length === 0) {
    return (
      <Section title="지금 확인할 변화">
        <div className="rounded-xl border border-dashed border-line py-10 text-center">
          <p className="text-lg font-medium text-ink">아직 반복되는 고객 문제가 모이지 않았습니다.</p>
          {/* Says what is true — reviews are needed — without implying the analysis found nothing wrong. */}
          <p className="mt-1 text-base text-muted">
            리뷰가 더 모이면 반복되는 내용과 변화를 여기에서 알려드립니다.
          </p>
        </div>
      </Section>
    );
  }

  return (
    <div className="space-y-6">
      <Section title="지금 확인할 변화">
        <p className="text-sm text-muted">
          반복 이슈 {summary.total}건 · 확인 필요 {summary.needsReview}건 · 변화 있음{" "}
          {summary.changed}건
        </p>
        <p className="mt-1 text-sm text-muted">{provenanceKo(all[0]!)}</p>

        {actionError ? (
          <div className="mt-3 rounded-xl bg-bad/10 px-4 py-3 text-bad">{actionError}</div>
        ) : null}

        {changed.length === 0 ? (
          <p className="mt-3 text-base text-muted">
            평소와 다른 변화는 확인되지 않았습니다.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {changed.map((issue) => (
              <ReviewIssueCard
                key={issue.id}
                issue={issue}
                onAdvance={advance}
                onDismiss={dismiss}
                busy={pending === issue.id}
              />
            ))}
          </ul>
        )}
      </Section>

      {improved.length > 0 ? (
        <Section title="개선된 문제">
          <ul className="space-y-3">
            {improved.map((issue) => (
              <ReviewIssueCard
                key={issue.id}
                issue={issue}
                onAdvance={advance}
                onDismiss={dismiss}
                busy={pending === issue.id}
              />
            ))}
          </ul>
        </Section>
      ) : null}

      {steady.length > 0 ? (
        <Section title="관리 중인 이슈">
          <ul className="space-y-3">
            {steady.map((issue) => (
              <ReviewIssueCard
                key={issue.id}
                issue={issue}
                onAdvance={advance}
                onDismiss={dismiss}
                busy={pending === issue.id}
              />
            ))}
          </ul>
        </Section>
      ) : null}

      {/* Dismissal has to be undoable. The row survives on purpose (so the next extraction does not
          recreate it and announce it as new), which means without this the operator could never
          reach it again — a one-way door. Collapsed, because it is an archive, not a worklist. */}
      {dismissedList.length > 0 ? (
        <details className="rounded-xl bg-canvas px-4 py-3">
          <summary className="cursor-pointer text-base font-semibold text-ink">
            중요하지 않음으로 표시한 이슈 {dismissedList.length}건
          </summary>
          <ul className="mt-3 space-y-3">
            {dismissedList.map((issue) => (
              <ReviewIssueCard
                key={issue.id}
                issue={issue}
                onAdvance={advance}
                onDismiss={dismiss}
                onRestore={restore}
                busy={pending === issue.id}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
