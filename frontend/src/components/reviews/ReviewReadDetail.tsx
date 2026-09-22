import { useEffect, useRef } from "react";
import { Facts } from "../ui/ObjectRow";
import { Chip } from "../ui/Chip";
import { Btn, BtnLink } from "../ui/Btn";
import { AiMarkChip, TriageTierChip } from "./TriageTierChip";
import { ratingLabel } from "../../lib/reviewRecord";
import { plainText } from "../../lib/plainText";
import { triageDispositionLabel } from "../../lib/vocItems";
import { AI_TRIAGE_DISCLOSURE, TRIAGE_TAG_DISCLOSURE } from "../../lib/reviewTriage";
import type { ActionWindowRunView } from "../../../../contracts/action-window/v2/index";
import { locateMessage, locateUnavailableText } from "../../lib/actionWindow/locate/locateCopy";
import type { LocateUnavailable, ReviewLocateBinding } from "../../lib/actionWindow/locate/useReviewLocate";
import type {
  ChannelReviewDetailView,
  ReviewChannelCapabilityView,
  ReviewTriageNote,
  TriageBehaviorEvent,
} from "../../lib/types";
import { josa } from "./recordParts";

/*
 * The read detail of one review in the 리뷰 record — moved whole from the old per-account record screen
 * (`ChannelReviews`, retired in UI/UX v2 Phase 3) so the one 리뷰 screen keeps everything that screen could do:
 * the facts, the seller's standing answer, the door to 리뷰 처리, `[쿠팡에서 보기]` and the AI pilot's silver.
 * Nothing here writes a decision; that is still the Review Case's.
 */

export function ReviewReadDetail({
  showBody = true,
  pilotOn,
  capability,
  word,
  recordBehavior,
  detail,
  locate,
  run,
  running,
  unavailable,
}: {
  /** False when the screen already prints the customer's words as the pane's title. */
  showBody?: boolean;
  pilotOn: boolean;
  capability: ReviewChannelCapabilityView | null;
  word: string;
  recordBehavior: (events: TriageBehaviorEvent[]) => void;
  detail: ChannelReviewDetailView;
  locate: ReviewLocateBinding;
  run: ActionWindowRunView | null;
  running: boolean;
  unavailable: LocateUnavailable | null;
}) {
  const message = locateMessage(run, running);
  // Contract §1: the locate surface exists on exactly the channels the server says it does. A NAVER or
  // Cafe24 account renders no `[쿠팡에서 보기]` — the server would refuse the press, and a button that is
  // refused every time is a promise the product cannot keep.
  const canLocate = capability?.originalLocate === "LOCATE_RUN";
  // Silver worth a trace: rows something raised — the pilot's mark or a rules 확인 필요.
  const raised = detail.aiMark !== null || detail.triage.tier === "NEEDS_ATTENTION";
  // MARKETPLACE_LOCATED — contract §2.1: the run REPORTED the row found (COMPLETED), once per run, not
  // on the press. The press is ORIGINAL_OPENED; the two are different facts and are recorded as two.
  const locatedRunRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pilotOn || !raised || run === null || run.status !== "COMPLETED") return;
    const key = `${detail.id}:${run.runId}`;
    if (locatedRunRef.current === key) return;
    locatedRunRef.current = key;
    recordBehavior([{ reviewId: detail.id, kind: "MARKETPLACE_LOCATED" }]);
  }, [pilotOn, raised, run, detail.id, recordBehavior]);
  // Offered only when the RUNTIME says it is allowed. A recheck the run would refuse is a button that does
  // nothing, and on a screen whose whole job is to be honest about what was found that is the wrong button.
  const canRecheck = run?.allowedCommands.includes("REQUEST_STEP_RECHECK") ?? false;
  const canRaise = run?.allowedCommands.includes("FIND_CURRENT_STEP") ?? false;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <TriageTierChip tier={detail.triage.tier} />
        {detail.aiMark ? <AiMarkChip /> : null}
        <span className="font-semibold text-ink">{ratingLabel(detail.rating)}</span>
        <span className="text-sm text-muted">{detail.writtenOn ?? "날짜 없음"}</span>
        {detail.isNew ? <Chip tone="accent">새 {word}</Chip> : null}
        {detail.mediaCount > 0 ? <Chip>사진·영상 {detail.mediaCount}</Chip> : null}
      </div>
      <TriageReason note={detail.triage} />
      {detail.aiMark ? (
        // The one sentence that keeps the mark honest: the rule did NOT call this 확인 필요, a frozen
        // classifier did, and the seller is asked to correct it if it is wrong.
        <p className="text-sm leading-relaxed text-muted">{AI_TRIAGE_DISCLOSURE}</p>
      ) : null}
      {detail.triage.tags.length > 0 ? (
        <p className="text-sm leading-relaxed text-muted">{TRIAGE_TAG_DISCLOSURE}</p>
      ) : null}
      {detail.textless ? (
        <p className="break-keep leading-relaxed text-muted">
          별점만 남기고 내용을 쓰지 않은 {word}입니다. 별점은 그대로 집계됩니다.
        </p>
      ) : !showBody ? null : (
        <p className="whitespace-pre-wrap break-keep leading-relaxed text-ink">
          {/* NAVER sends review bodies as HTML, so a customer's quotation mark reached this pane as
              `&ldquo;`. Presentation only — the stored row is untouched (Demo UX Polish v1). */}
          {plainText(detail.body) || "표시할 수 있는 본문이 없습니다"}
        </p>
      )}
      {detail.bodyRedacted ? (
        <p className="text-sm text-muted">
          연락처·링크처럼 개인정보로 보이는 부분은 가려서 표시했습니다.
        </p>
      ) : null}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">상품</dt>
        <dd className="truncate text-ink">{detail.productName ?? "정보 없음"}</dd>
        {canLocate ? (
          // Coupang's own column words — the identifiers the locate run matches on. Other channels
          // carry no such target, and printing "정보 없음" under a Coupang label would say SellerOps
          // lost something it never had.
          <>
            <dt className="text-muted">노출상품ID</dt>
            <dd className="truncate text-ink">{detail.locateTarget.productId ?? "정보 없음"}</dd>
            <dt className="text-muted">옵션ID</dt>
            <dd className="truncate text-ink">{detail.locateTarget.vendorItemId ?? "정보 없음"}</dd>
          </>
        ) : null}
      </dl>

      {/*
        **판단과 조치는 여기서 하지 않는다 — 리뷰 처리 화면이 그 자리다.**

        This panel used to carry the whole mutation cluster: the response decision, the reply draft and
        approval, the seller's own tier, and the pilot's action buttons. All of it worked, and all of it
        was a SECOND room doing the same job as `/reviews/{account}/reply/{review}` — with one set of
        controls able to see what repeats, what else said the same and what this company has written
        down, and this one not. Two rooms for one decision is how a product ends up with two answers,
        and it is also how `ACTION_NOT_NEEDED` and `NO_ACTION` both existed for the same sentence.

        So the record stays a RECORD. It reads what stands — the system's tier, the seller's own answer,
        the decision, what the channel says — and offers one door. Nothing here writes.
      */}
      <section aria-label="판단과 조치" className="space-y-3 border-t border-line pt-4">
        <p className="text-sm font-semibold text-ink">판단과 조치</p>
        {/* WHO WRITES THE ANSWER — a capability fact of this review's channel, said once, where the door is. */}
        {capability === null ? null : capability.replySupported ? (
          <p className="text-sm text-muted">답변은 리뷰 처리에서 준비하고, 올리는 일은 판매자센터에서 직접 합니다</p>
        ) : (
          <p className="text-sm text-muted">이 채널에서는 reviewnary가 답변을 작성하지 않습니다</p>
        )}
        <Facts className="text-sm text-muted">
          <span className="inline-flex items-center gap-1.5">
            시스템 판단 <TriageTierChip tier={detail.triage.tier} />
            {detail.aiMark ? <AiMarkChip /> : null}
          </span>
          {detail.sellerCorrection ? (
            <span className="inline-flex items-center gap-1.5">
              판매자 수정 <TriageTierChip tier={detail.sellerCorrection.correctedTier} />
            </span>
          ) : null}
          {detail.replyWork ? (
            <span>처리 상태 {triageDispositionLabel(detail.replyWork.triageDisposition)}</span>
          ) : null}
          {/* The channel's own statement, as a fact on the same line. The explanatory version of it
              belongs where the controls it explains are — and they are not here any more. */}
          {detail.replyWork?.channelReplyState === "ANSWERED" ? <span>채널에 답변 등록됨</span> : null}
        </Facts>
        <BtnLink to={`/reviews/reply/${detail.id}?from=record`} size="sm">
          이 리뷰 처리하기
        </BtnLink>
        <p className="text-sm leading-relaxed text-muted">
          판단·조치·답변 준비는 리뷰 처리 화면에서 합니다. 이 목록에서는 기록된 내용을 읽기만 합니다.
        </p>
      </section>

      {/*
        **[쿠팡에서 보기] — the one thing a seller can ask SellerOps to DO with a 상품평.**

        Coupang publishes no per-review link, so this is not a hyperlink and cannot be: the review is found
        again by matching it on the screen the seller has open. That is why the button lives beside a status
        line rather than being a plain anchor — there is a run behind it, and it has things to say.

        Rendered only where the channel has a locate surface (contract §1). On the other two channels there
        is no "see the original" control at all, and the page says so once rather than offering a dead one.
      */}
      {canLocate ? (
      <div className="space-y-2 border-t border-line pt-4">
        <Btn
          size="sm"
          variant="outline"
          disabled={running}
          onClick={() => {
            // Silver: the seller asked for the original. Recorded only for rows something raised.
            if (pilotOn && raised) {
              recordBehavior([{ reviewId: detail.id, kind: "ORIGINAL_OPENED" }]);
            }
            void locate.locate(detail.id);
          }}
        >
          쿠팡에서 보기
        </Btn>
        <p className="text-sm leading-relaxed text-muted">
          쿠팡 윙의 상품평 목록 화면을 띄워 두시면, 이 상품평이 있는 줄에 테두리를 그려 드립니다. 쿠팡
          화면에서는 아무것도 눌리거나 입력되지 않습니다.
        </p>
        {unavailable ? (
          <p className="text-sm leading-relaxed text-ink">{locateUnavailableText(unavailable)}</p>
        ) : null}
        {message ? (
          <div className="space-y-2">
            <p
              className={`text-sm leading-relaxed ${
                message.tone === "done" ? "text-ink" : message.tone === "failed" ? "text-ink" : "text-muted"
              }`}
              role="status"
            >
              {message.text}
            </p>
            {canRecheck || canRaise ? (
              <div className="flex flex-wrap gap-2">
                {canRecheck ? (
                  <Btn size="sm" variant="outline" onClick={() => locate.send("REQUEST_STEP_RECHECK")}>
                    다시 확인
                  </Btn>
                ) : null}
                {canRaise ? (
                  <Btn size="sm" variant="ghost" onClick={() => locate.send("FIND_CURRENT_STEP")}>
                    쿠팡 창 앞으로
                  </Btn>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      ) : (
        <p className="border-t border-line pt-4 text-sm leading-relaxed text-muted">
          이 채널의 {josa(word, "은", "는")} reviewnary에서 원문 화면으로 바로 이동할 수 없습니다. 판매자센터에서 직접 확인해 주세요.
        </p>
      )}
    </div>
  );
}

/**
 * Why this row is where it is, and what the seller might do about it.
 *
 * The reason is rendered as the backend composed it. `recommendedAction` is null for 참고 and renders
 * as nothing — filling that slot with a reassuring sentence would make every row look equally
 * actionable, which is the opposite of what this screen is for.
 */
function TriageReason({ note }: { note: ReviewTriageNote }) {
  return (
    <span className="mt-1 block text-sm text-muted">
      <span>{note.reason}</span>
      {note.recommendedAction ? (
        <span className="mt-0.5 block break-keep text-ink">{note.recommendedAction}</span>
      ) : null}
    </span>
  );
}

