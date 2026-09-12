import { useEffect, useState } from "react";
import { Btn } from "../ui/Btn";
import { AiMarkChip, TriageTierChip } from "./TriageTierChip";
import { api } from "../../lib/apiClient";
import {
  TRIAGE_CORRECTION_COPY,
  TRIAGE_CORRECTION_LABEL,
  TRIAGE_TIERS,
} from "../../lib/reviewTriage";
import type { ReviewTriageTier, TriageCorrectionView } from "../../lib/types";

/**
 * The seller's own judgment for one review — T-07, and now on both surfaces that show a review.
 *
 * <b>Why it moved out of the record screen.</b> It was written as a local function inside
 * `ChannelReviews.tsx`, which made the record the only place a seller could disagree with the system.
 * The Decision Workspace asks the same question one step before the action choice — 「판매자님 판단은
 * 어떠신가요?」 is what the 조치 선택 stands on — so the control is one component with two callers
 * rather than two components that agree today.
 *
 * <b>Addressed by the review alone.</b> A judgment is what this org thinks about its own record; it is
 * not from an account and it is not sent anywhere. Taking the account out of the signature is what
 * lets a seller judge a review they uploaded rather than connected.
 *
 * <b>Available whether or not the AI pilot is on.</b> The pilot decides what the SYSTEM says about a
 * review, not whether the seller may disagree with it.
 *
 * <b>Three choices, the same three words the chips use.</b> It was two, and 필요 없음 was stored as
 * whatever the rule would have said — so a seller who meant 참고 had 지켜보기 recorded under their name.
 *
 * <b>What this does: record.</b> It changes no tier, moves no row, hides nothing and trains nothing.
 * The copy says so once, because a seller who corrects a review and watches the list stay put deserves
 * to know that is the design.
 */
export function SellerCorrectionControls({
  reviewId,
  word,
  systemTier,
  aiMarked,
  correction,
  onCorrected,
  headingLevel = 3,
}: {
  reviewId: string;
  /** What this channel calls one review — 리뷰 / 상품평. */
  word: string;
  /** What the system says NOW, recomputed at read time. Never replaced by the seller's answer. */
  systemTier: ReviewTriageTier;
  /** Whether the pilot raised this review. Shown beside the tier, never merged into it. */
  aiMarked: boolean;
  /** The seller's standing judgment as the last read saw it, or null when none stands. */
  correction: TriageCorrectionView | null;
  onCorrected: () => void;
  headingLevel?: 2 | 3;
}) {
  // Seeded from the READ, not from a press — the whole of T-07 requirement 4. Before it this was
  // `useState<boolean | null>(null)` reset on every review change, so a refresh showed nothing pressed
  // on a review the database knew had been corrected.
  const [answer, setAnswer] = useState<ReviewTriageTier | null>(correction?.correctedTier ?? null);
  const [changes, setChanges] = useState(correction?.changeCount ?? 0);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAnswer(correction?.correctedTier ?? null);
    setChanges(correction?.changeCount ?? 0);
    setFailed(false);
  }, [reviewId, correction]);

  const Heading = headingLevel === 2 ? "h2" : "h3";

  const correct = async (tier: ReviewTriageTier) => {
    setBusy(true);
    setFailed(false);
    try {
      const view = await api.correctReviewTriage(reviewId, { tier, reasonCode: null });
      setAnswer(view.correctedTier);
      setChanges(view.changeCount);
      onCorrected();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await api.withdrawReviewTriageCorrection(reviewId);
      setAnswer(null);
      onCorrected();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" aria-label="판매자 판단">
      <Heading className="break-keep text-sm font-semibold text-ink">
        이 {word}, {TRIAGE_CORRECTION_COPY.prompt}
      </Heading>
      {/* The two judgments, named. Without this the seller sees three buttons and cannot tell which of
          them is the machine's answer and which is their own. */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span>{TRIAGE_CORRECTION_COPY.systemPrefix}</span>
        <TriageTierChip tier={systemTier} />
        {aiMarked ? <AiMarkChip /> : null}
        {answer ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{TRIAGE_CORRECTION_COPY.sellerPrefix}</span>
            <TriageTierChip tier={answer} />
            {changes > 1 ? <span className="text-xs">{changes}번 수정</span> : null}
          </>
        ) : null}
      </p>
      <div className="flex flex-wrap gap-2">
        {TRIAGE_TIERS.map((tier) => (
          <Btn
            key={tier}
            size="sm"
            variant={answer === tier ? "solid" : "outline"}
            aria-pressed={answer === tier}
            disabled={busy}
            onClick={() => void correct(tier)}
          >
            {TRIAGE_CORRECTION_LABEL[tier]}
          </Btn>
        ))}
        {answer ? (
          <Btn size="sm" variant="ghost" disabled={busy} onClick={() => void withdraw()}>
            {TRIAGE_CORRECTION_COPY.withdraw}
          </Btn>
        ) : null}
      </div>
      <p className="text-sm leading-relaxed text-muted">{TRIAGE_CORRECTION_COPY.disclosure}</p>
      {failed ? <p className="text-sm text-bad">기록하지 못했습니다. 잠시 후 다시 시도해 주세요.</p> : null}
    </div>
  );
}
