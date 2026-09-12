import { useEffect, useState } from "react";
import { Section } from "../../ui/Section";
import { Btn } from "../../ui/Btn";
import { VocItemTriageControl } from "../../VocItemTriageControl";
import { api } from "../../../lib/apiClient";
import { DECISION_ACTION_NOTE, DECISION_DONE_LABEL, type DecisionDoneKind } from "../../../lib/reviewDecision";
import type { TriageDisposition } from "../../../lib/types";

/**
 * <b>조치 선택</b> — the sixth step, and the one the whole screen is arranged around.
 *
 * <b>It writes the decision the product already has.</b> `TriageDisposition`, through
 * `VocItemTriageControl`, through the endpoint that has owned the row lock, the idempotency key and
 * the append-only trail since it was built. This component adds a heading, a sentence and a place —
 * not a second decision store, and not a second set of words for the three values.
 *
 * <b>The address is the review.</b> Until Review Decision Workspace v1 the only ref a review-shaped
 * surface could get was `ChannelReviewDetailView.replyWork.actionRef`, which is null on every channel
 * with no reply flow — so on Coupang a seller could not record a decision at all, even though the
 * decision endpoint has never been capability-gated and `TriageDisposition` says in its own contract
 * that deciding is not replying. That was fixed with a server-minted `decisionRef`; Agent-native Core
 * Boundary v1 then removed the ref as well, because a path segment that decodes to the review id is a
 * second address for the object the route already names. The endpoint is org-scoped, so a review no
 * account acquired can be decided too.
 *
 * <b>완료 기록 offers two acts, not three.</b> 조치 불필요 exists in `TriageActionKind` and the pilot's
 * controls still write it on the record screen — but the step above already records exactly that
 * statement as `NO_ACTION`, in the decision spine, with its own trail. One press landing in two spines
 * at two evidential strengths is the thing the triage contract §5-C says must not happen.
 *
 * <b>Nothing here touches a marketplace.</b> 조치 시작 / 조치 완료 are the seller's statement about
 * something they did on their own side of the counter, stored as one.
 */
export function DecisionActionStep({
  reviewId,
  decision,
  replySupported,
  replyUnavailableReason,
  onDecided,
  onRecorded,
}: {
  reviewId: string;
  /** The decision that stands, as the last read saw it. */
  decision: TriageDisposition | null;
  /** Whether a draft can be prepared here — decides what the note under the control may promise. */
  replySupported: boolean;
  /**
   * When it cannot, the server's own reason. 「이 채널은 답변 기능이 없습니다」 and 「연결된 계정이
   * 없습니다」 are different facts and only one of them is something the seller can act on; this
   * component never infers which from the channel code.
   */
  replyUnavailableReason: "CHANNEL_HAS_NO_REPLY_FLOW" | "NO_SELLER_ACCOUNT" | null;
  onDecided: (next: TriageDisposition) => void;
  /** An act was recorded, so the log below can re-read. */
  onRecorded: () => void;
}) {
  const [done, setDone] = useState<DecisionDoneKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setDone(null);
    setFailed(false);
  }, [reviewId]);

  const record = async (kind: DecisionDoneKind) => {
    setBusy(true);
    setFailed(false);
    try {
      await api.recordReviewTriageAction(reviewId, kind);
      setDone(kind);
      onRecorded();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="무엇을 하시겠어요?" ariaLabel="조치 선택">
      <div className="space-y-3">
        <VocItemTriageControl
          key={`decide-${reviewId}`}
          reviewId={reviewId}
          disposition={decision}
          onRecorded={onDecided}
        />
        <p className="break-keep text-sm leading-relaxed text-muted">
          {replySupported
            ? DECISION_ACTION_NOTE.withReply
            : replyUnavailableReason === "NO_SELLER_ACCOUNT"
              ? DECISION_ACTION_NOTE.withoutAccount
              : DECISION_ACTION_NOTE.withoutReply}
        </p>

        {/* Only after a decision stands. Before one, 「조치 완료함」 would be a record of finishing work
            nobody has said needs doing — and on 조치 불필요 the decision itself is the conclusion, so
            there is nothing left to report. */}
        {decision === "RESPONSE_NEEDED" || decision === "MONITOR" ? (
          <div className="space-y-2 border-t border-line pt-3">
            <p className="break-keep text-sm font-semibold text-ink">직접 하신 조치가 있으면 기록해 두세요</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(DECISION_DONE_LABEL) as DecisionDoneKind[]).map((kind) => (
                <Btn
                  key={kind}
                  size="sm"
                  variant={done === kind ? "solid" : "outline"}
                  aria-pressed={done === kind}
                  disabled={busy}
                  onClick={() => void record(kind)}
                >
                  {DECISION_DONE_LABEL[kind]}
                </Btn>
              ))}
            </div>
            {failed ? <p className="text-sm text-bad">기록하지 못했습니다. 잠시 후 다시 시도해 주세요.</p> : null}
          </div>
        ) : null}
      </div>
    </Section>
  );
}
