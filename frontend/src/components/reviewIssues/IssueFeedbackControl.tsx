import { useId, useRef, useState } from "react";
import { api } from "../../lib/apiClient";
import { SecureRandomUnavailableError, newCommandId } from "../../lib/commandId";
import type { ReviewIssueFeedbackKind } from "../../lib/types";

const OPTIONS: { kind: ReviewIssueFeedbackKind; labelKo: string }[] = [
  { kind: "USEFUL", labelKo: "유용함" },
  { kind: "NOT_RELEVANT", labelKo: "관련 없음" },
  { kind: "LATER", labelKo: "나중에 보기" },
];

/**
 * 유용함 / 관련 없음 / 나중에 보기 — the operator's judgement about a repeated-issue CANDIDATE.
 *
 * <p><b>Offline evaluation only.</b> It records honest signal about whether an UNMEASURED detector is
 * surfacing the right issues; it moves no lifecycle, no queue, and no judgement, and the copy makes no
 * claim otherwise.
 *
 * <p><b>a11y.</b> {@code aria-pressed} marks the chosen answer; a stable {@code aria-live} region
 * announces the result or an actionable failure; buttons use {@code aria-disabled} (not native
 * {@code disabled}) so focus survives in a long list — the same conventions as the reply/triage
 * controls.
 */
export function IssueFeedbackControl({ issueId }: { issueId: string }) {
  const [submitted, setSubmitted] = useState<ReviewIssueFeedbackKind | null>(null);
  const [busy, setBusy] = useState<ReviewIssueFeedbackKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per kind, so retrying the SAME answer replays rather than appending a second
  // eval row; a different answer mints its own.
  const commandIds = useRef<Map<ReviewIssueFeedbackKind, string>>(new Map());
  const statusId = useId();

  async function choose(kind: ReviewIssueFeedbackKind) {
    if (busy != null) {
      return;
    }
    setError(null);
    setBusy(kind);
    try {
      let commandId = commandIds.current.get(kind);
      if (commandId == null) {
        commandId = newCommandId();
        commandIds.current.set(kind, commandId);
      }
      await api.recordReviewIssueFeedback(issueId, { commandId, kind });
      setSubmitted(kind);
    } catch (e) {
      setError(
        e instanceof SecureRandomUnavailableError
          ? "이 브라우저에서는 보안 난수를 사용할 수 없어 피드백을 기록할 수 없습니다."
          : "피드백을 기록하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setBusy(null);
    }
  }

  const chosenLabel = OPTIONS.find((o) => o.kind === submitted)?.labelKo;

  return (
    <div className="mt-3" role="group" aria-label="이 이슈가 유용했나요?">
      <p className="text-xs text-muted">이 이슈가 유용했나요?</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {OPTIONS.map((option) => {
          const isBusy = busy === option.kind;
          const isChosen = submitted === option.kind;
          return (
            <button
              key={option.kind}
              type="button"
              className={`rounded-lg px-2.5 py-1 text-sm font-medium focus-visible:ring-2 focus-visible:ring-brand ${
                isChosen ? "bg-brand/10 text-brand" : "bg-ink/5 text-ink"
              }`}
              aria-pressed={isChosen}
              aria-disabled={busy != null}
              aria-describedby={statusId}
              onClick={() => choose(option.kind)}
            >
              {isBusy ? "기록 중…" : option.labelKo}
            </button>
          );
        })}
      </div>
      {/* Always mounted so assistive tech registers the change; only the text toggles. */}
      <p id={statusId} className="mt-1 text-xs" aria-live="polite" role={error ? "alert" : "status"}>
        {error ? (
          <span className="text-bad">{error}</span>
        ) : chosenLabel ? (
          <span className="text-muted">“{chosenLabel}”(으)로 기록했습니다. 감사합니다.</span>
        ) : (
          ""
        )}
      </p>
    </div>
  );
}
