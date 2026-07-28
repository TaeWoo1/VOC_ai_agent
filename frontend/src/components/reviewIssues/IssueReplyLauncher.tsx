import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/apiClient";
import type { ReviewIssueReplyCandidate, ReviewIssueReplyCandidates, TriageDisposition } from "../../lib/types";
import { VocItemReplyPrep } from "../VocItemReplyPrep";
import { VocItemTriageControl } from "../VocItemTriageControl";

/**
 * The Issue → 근거 → 리뷰 선택 → 초안 승인 → Guided Reply flow, embedded under one issue on `/issues`.
 *
 * <p><b>Reuse, not rebuild.</b> The draft → approve → guided-reply machine is the existing
 * {@link VocItemReplyPrep}; the disposition gate is the existing {@link VocItemTriageControl}. This
 * component only resolves which unanswered reviews an operator may act on (server-computed
 * {@code selectable}) and mounts that pair for the one they choose. It owns no reply logic and no
 * journey state — the backend computes both.
 *
 * <p><b>The signal is a DRAFT candidate, never a confirmed problem.</b> The header labels it with the
 * extractor and the thresholds contract version, per {@code contracts/review-issue/v1/THRESHOLDS.md}.
 *
 * <p><b>Already-answered reviews are excluded from selection AND execution.</b> A non-selectable
 * candidate is shown with its reason and offers no reply control — the same rule the guided-run 409
 * enforces server-side.
 */
export function IssueReplyLauncher({ issueId }: { issueId: string }) {
  const [data, setData] = useState<ReviewIssueReplyCandidates | null>(null);
  const [failed, setFailed] = useState(false);
  const [openReviewId, setOpenReviewId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setFailed(false);
    api
      .getReviewIssueReplyCandidatesStrict(issueId)
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [issueId, reloadKey]);

  // A reported (or aborted) outcome can change who is selectable — re-read so an answered review
  // leaves selection rather than lingering as a stale actionable row.
  const onOutcome = useCallback(() => setReloadKey((k) => k + 1), []);

  if (failed) {
    return <p className="mt-2 text-sm text-bad">답변 후보를 불러오지 못했습니다. 다시 시도해 주세요.</p>;
  }
  if (!data) {
    return <p className="mt-2 text-sm text-muted">불러오는 중…</p>;
  }

  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      <div>
        <p className="text-sm font-semibold text-ink">이 리뷰에 답변하기</p>
        {/* DRAFT honesty: this is a candidate signal, not a confirmed problem. */}
        <p className="mt-0.5 text-xs text-muted">
          후보 신호 · 아직 검증되지 않았습니다 (임계값 {data.thresholdsVersion} · {data.extractorKind})
        </p>
      </div>

      {data.candidates.length === 0 ? (
        <p className="text-sm text-muted">답변할 수 있는 미답변 리뷰가 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {data.candidates.map((candidate) => (
            <li key={candidate.reviewId} className="rounded-lg bg-canvas px-3 py-2">
              <CandidateRow
                candidate={candidate}
                open={openReviewId === candidate.reviewId}
                onToggle={() =>
                  setOpenReviewId((current) =>
                    current === candidate.reviewId ? null : candidate.reviewId,
                  )
                }
                onOutcome={onOutcome}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CandidateRow({
  candidate,
  open,
  onToggle,
  onOutcome,
}: {
  candidate: ReviewIssueReplyCandidate;
  open: boolean;
  onToggle: () => void;
  onOutcome: () => void;
}) {
  const meta = [
    candidate.rating == null ? null : "★".repeat(candidate.rating),
    candidate.reviewDate,
    candidate.productName,
  ]
    .filter(Boolean)
    .join(" · ");

  // One gate for BOTH the button and the mount, so the two can never disagree — a selectable
  // candidate must also have a resolved account (the backend guarantees this; enforcing it here too
  // means a contract drift can never surface a button that expands to nothing).
  const canReply = candidate.selectable && candidate.accountId != null;

  return (
    <>
      <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          {candidate.quote ? (
            <p className="text-sm text-ink">“{candidate.quote}”</p>
          ) : (
            <p className="text-sm italic text-muted">
              표시할 수 있는 표현이 없습니다. 개인정보 보호를 위해 가려졌습니다.
            </p>
          )}
          {meta ? <p className="mt-0.5 text-xs text-muted">{meta}</p> : null}
        </div>
        <div className="shrink-0">
          {canReply ? (
            <button
              type="button"
              className="btn-ghost"
              aria-expanded={open}
              onClick={onToggle}
            >
              {open ? "닫기" : "이 리뷰에 답변하기"}
            </button>
          ) : (
            <span className="text-xs font-medium text-muted" data-testid="candidate-not-selectable">
              {notSelectableReason(candidate)}
            </span>
          )}
        </div>
      </div>

      {open && canReply && candidate.accountId ? (
        <ReplyForCandidate
          accountId={candidate.accountId}
          actionRef={candidate.actionRef}
          onOutcome={onOutcome}
        />
      ) : null}
    </>
  );
}

/** Why a candidate cannot be replied to — the channel already answered, or the account is ambiguous. */
function notSelectableReason(candidate: ReviewIssueReplyCandidate): string {
  if (candidate.channelReplyState === "ANSWERED" || candidate.reportedSubmitted) {
    return "이미 답변한 리뷰입니다";
  }
  if (candidate.accountAmbiguous) {
    return "판매 계정을 먼저 선택해야 합니다";
  }
  return "지금은 답변할 수 없습니다";
}

/**
 * The existing triage + reply-prep pair, mounted for one chosen review. The disposition is seeded
 * locally and advanced only on a server-confirmed decision — exactly as {@code VocItemCard} does it —
 * so an operator marks 대응 필요 here and the reply panel appears, without this component re-deriving
 * any capability rule.
 */
function ReplyForCandidate({
  accountId,
  actionRef,
  onOutcome,
}: {
  accountId: string;
  actionRef: string;
  onOutcome: () => void;
}) {
  const [decided, setDecided] = useState<TriageDisposition | null>(null);
  const [localWork, setLocalWork] = useState(false);
  const noteLocalWork = useCallback((has: boolean) => setLocalWork(has), []);

  return (
    <div className="mt-2 space-y-2 border-t border-line pt-2">
      <VocItemTriageControl
        accountId={accountId}
        actionRef={actionRef}
        disposition={decided}
        onRecorded={setDecided}
      />
      {decided === "RESPONSE_NEEDED" || localWork ? (
        <VocItemReplyPrep
          accountId={accountId}
          actionRef={actionRef}
          disposition={decided}
          onOutcomeRecorded={onOutcome}
          onLocalWork={noteLocalWork}
        />
      ) : (
        <p className="text-xs text-muted">
          먼저 위에서 <span className="font-medium">대응 필요</span>로 표시하면 답변 초안을 준비할 수
          있습니다.
        </p>
      )}
    </div>
  );
}
