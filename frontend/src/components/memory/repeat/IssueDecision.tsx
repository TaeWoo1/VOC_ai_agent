import { useState } from "react";
import { Btn } from "../../ui/Btn";
import { nextActionKo, waitingNoteKo } from "../../../lib/reviewIssuesView";
import type { IssueLifecycleState } from "../../../lib/types";

/**
 * <b>판단과 조치</b> — the seller's decision about the repeated problem, in their own words.
 *
 * <b>The note is the point of this section.</b> `startActing` and `markRemediated` have taken an
 * operator note since the lifecycle existed, and the screen passed none — so every transition a
 * seller made was recorded as a state change by a person who said nothing about it. The record then
 * answered 「when did this move」 and not 「what did we do」, which is the question a 조치 기록 exists
 * for. The field is optional: a decision without a sentence is still a decision, and demanding prose
 * before a state change would make the trail worse by making people skip it.
 *
 * <b>No 해결 처리 control at any state, unchanged.</b> 해결됨 is reached by observing quiet weeks
 * after recorded remediation; a button would let an assertion stand in for that evidence.
 *
 * <b>Where there is no action, the screen says what it is waiting for rather than nothing.</b>
 * `nextActionKo` returns null in three states, and in those the honest report is what SellerOps is
 * doing — silence reads as a screen that has forgotten the problem.
 */
export function IssueDecision({
  state,
  busy,
  error,
  onSubmit,
}: {
  state: IssueLifecycleState;
  busy: boolean;
  error: string | null;
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const actionLabel = nextActionKo(state);
  const waiting = waitingNoteKo(state);

  return (
    <section aria-label="판단과 조치" className="border-t border-line pt-5">
      <h3 className="text-base font-bold text-ink">판단과 조치</h3>

      {waiting ? (
        <p className="mt-2 break-keep leading-relaxed text-muted">{waiting}</p>
      ) : null}

      {actionLabel ? (
        <div className="mt-3 space-y-2">
          <label htmlFor="issue-decision-note" className="block text-sm font-semibold text-muted">
            무엇을 하기로 하셨나요 (선택)
          </label>
          <textarea
            id="issue-decision-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="예) 접착 테이프 공급처를 바꾸고 8월 출고분부터 적용합니다."
            className="w-full break-keep rounded-xl border border-line bg-surface p-3 text-sm leading-relaxed text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
          />
          <p className="break-keep text-sm leading-relaxed text-muted">
            남기신 내용은 아래 기록에 그대로 남습니다.
          </p>
          <Btn size="sm" onClick={() => onSubmit(note)} disabled={busy}>
            {busy ? "기록 중…" : actionLabel}
          </Btn>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm text-bad">{error}</p> : null}
    </section>
  );
}
