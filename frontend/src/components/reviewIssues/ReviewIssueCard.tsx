import { useState } from "react";
import type { ReviewIssueView } from "../../lib/types";
import { IssueEvidencePanel } from "./IssueEvidencePanel";
import { IssueFeedbackControl } from "./IssueFeedbackControl";
import { IssueReplyLauncher } from "./IssueReplyLauncher";
import {
  CHANGE_EXPLANATION_KO,
  SEVERITY_LABEL_KO,
  SEVERITY_TONE,
  changeBadges,
  investigationHintKo,
  nextActionKo,
  productLineKo,
  surgeLine,
  waitingNoteKo,
  type ChangeTone,
} from "../../lib/reviewIssuesView";

const TONE_CLASS: Record<ChangeTone, string> = {
  bad: "bg-bad/10 text-bad",
  warn: "bg-warn/10 text-warn",
  neutral: "bg-ink/5 text-ink",
  good: "bg-good/10 text-good",
};

/**
 * One persistent issue. Read-mostly: the only writes are the two lifecycle moves that belong to a
 * person, plus dismissal.
 *
 * <p>There is no 해결 처리 button at any state. 해결됨 is reached by observing quiet weeks after
 * recorded remediation, so a button would let an assertion stand in for evidence — the same reason
 * the server exposes no endpoint for it.
 */
export function ReviewIssueCard({
  issue,
  onAdvance,
  onDismiss,
  onRestore,
  busy,
}: {
  issue: ReviewIssueView;
  onAdvance: (issue: ReviewIssueView) => void;
  onDismiss: (issue: ReviewIssueView) => void;
  /** Supplied only for the 중요하지 않음 list; its presence swaps 중요하지 않음 for 되돌리기. */
  onRestore?: (issue: ReviewIssueView) => void;
  busy: boolean;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const badges = changeBadges(issue.change);
  const surge = surgeLine(issue.change);
  const product = productLineKo(issue);
  const hint = investigationHintKo(issue);
  const action = nextActionKo(issue.lifecycleState);
  const waiting = waitingNoteKo(issue.lifecycleState);

  return (
    <li className="rounded-xl bg-canvas px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold text-ink">{issue.title}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-semibold ${TONE_CLASS[SEVERITY_TONE[issue.severity]]}`}
        >
          {SEVERITY_LABEL_KO[issue.severity]}
        </span>
        <span className="rounded bg-ink/5 px-1.5 py-0.5 text-xs font-semibold text-ink">
          {issue.lifecycleLabelKo}
        </span>
        <span className="text-sm text-muted">관련 리뷰 {issue.evidenceCount}건</span>
      </div>

      {badges.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {badges.map((badge) => (
            <span
              key={badge.kind}
              className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${TONE_CLASS[badge.tone]}`}
            >
              {badge.labelKo}
            </span>
          ))}
        </div>
      ) : null}

      {badges.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-sm text-muted">
          {badges.map((badge) => (
            <li key={badge.kind}>{CHANGE_EXPLANATION_KO[badge.kind]}</li>
          ))}
        </ul>
      ) : null}

      {/* Honesty: these are candidate signals from an UNMEASURED detector, never a confirmed
          diagnosis. Stated once here so no badge above reads as "문제 확정". */}
      {badges.length > 0 ? (
        <p className="mt-2 text-xs text-muted">
          미검증 후보 신호입니다 · 근거 리뷰로 직접 확인하세요 ({issue.extractorKind})
        </p>
      ) : null}

      {surge ? <p className="mt-2 text-sm font-medium text-ink">{surge}</p> : null}
      {product ? <p className="mt-1 text-sm text-muted">{product}</p> : null}

      {/* Points at what to check. Deliberately never names a cause. */}
      {hint ? <p className="mt-2 text-sm text-muted">{hint}</p> : null}
      {waiting ? <p className="mt-2 text-sm text-muted">{waiting}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {action && !onRestore ? (
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => onAdvance(issue)}
          >
            {action}
          </button>
        ) : null}
        <button
          type="button"
          className="btn-ghost"
          aria-expanded={showEvidence}
          onClick={() => setShowEvidence((open) => !open)}
        >
          {showEvidence ? "근거 리뷰 접기" : "근거 리뷰 보기"}
        </button>
        {/* Only for the working list — a dismissed issue is set aside, not something to reply to now. */}
        {onRestore ? null : (
          <button
            type="button"
            className="btn-ghost"
            aria-expanded={showReply}
            onClick={() => setShowReply((open) => !open)}
          >
            {showReply ? "답변 준비 접기" : "답변 준비"}
          </button>
        )}
        {onRestore ? (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => onRestore(issue)}>
            되돌리기
          </button>
        ) : (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => onDismiss(issue)}>
            중요하지 않음
          </button>
        )}
      </div>

      {showEvidence ? <IssueEvidencePanel issueId={issue.id} /> : null}
      {showReply && !onRestore ? <IssueReplyLauncher issueId={issue.id} /> : null}

      {/* Offline eval feedback — withheld on the dismissed list, where the operator has already
          judged the issue not worth attention. */}
      {onRestore ? null : <IssueFeedbackControl issueId={issue.id} />}
    </li>
  );
}
