import { useEffect, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { Empty } from "../../components/ui/Empty";
import { Facts } from "../../components/ui/ObjectRow";
import { Btn, BtnLink } from "../../components/ui/Btn";
import { Disclosure } from "../../components/ui/Disclosure";
import { ReplyWorkControls } from "../../components/ReplyWorkControls";
import { api } from "../../lib/apiClient";
import { reviewRecordPath, ratingLabel } from "../../lib/reviewRecord";
import { TRIAGE_TIER_LABEL } from "../../lib/reviewTriage";
import type { ChannelReviewDetailView, ReviewDetailResponse } from "../../lib/types";

/**
 * 답변 작업 — ONE review's reply preparation, and nothing else on the screen.
 *
 * <b>Why a route of its own.</b> The reply panel already existed and already worked; what did not exist
 * was a way to reach it. A seller told "이 리뷰를 승인해 주세요" arrived at `/reviews/{account}`, which
 * opens the channel's whole record — 4,455 rows on the live NAVER account — ordered by a triage tier
 * that has nothing to do with whether they owe anyone an answer. Measured on 2026-09-03: 내 답변 작업
 * sat at y=3,420 and the first 승인 button at y=5,425 of a 5,587px document, six screens below the
 * fold, and the target review was not in the first page of the list because its tier is 참고. There was
 * no path from "I know which review" to "here is its approve button" that did not go through scrolling
 * and counting cards.
 *
 * <b>The address is the pair every reply endpoint already takes</b> — the account and the review — so
 * this page mints no identifier and parses no `actionRef`. It costs ONE read
 * (`GET /api/channel-reviews/{account}/{review}`), the same exact read the record's detail panel makes,
 * and it hands the ref straight to the same {@link ReplyWorkControls} cluster the record and the
 * worklist mount. There is no second reply flow here, and there is no write on this page that the
 * panel did not already own: the approval boundary, the draft's append-only versions and its
 * fingerprint are untouched.
 *
 * <b>What is first is what the seller came to do.</b> The customer's sentence, the draft, and 승인 —
 * in that order, in one panel. The tier, the keyword classification and the AI mark are real and are
 * kept, folded, below: they explain how the review was sorted, which is not the question being asked
 * on this screen. Nothing is hidden that changes the decision; what is folded is the reason the review
 * was ranked, not the reason the answer says what it says.
 */
export function ReviewReplyTask() {
  const { accountId = "", reviewId = "" } = useParams();
  const [params] = useSearchParams();
  const cameFromConversation = params.get("from") === "chat";
  const [detail, setDetail] = useState<ChannelReviewDetailView | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  // Bumped by the panel's own writes so the identity line re-reads with them. The panel refreshes
  // itself; this exists so a decision recorded here is not described by a header read before it.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!accountId || !reviewId) return;
    let live = true;
    setLoading(true);
    api
      .getChannelReviewStrict(accountId, reviewId)
      .then((view) => {
        if (!live) return;
        setDetail(view);
        setFailed(false);
      })
      .catch(() => {
        if (!live) return;
        setDetail(null);
        setFailed(true);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [accountId, reviewId, version]);

  const back = (
    <div className="flex flex-wrap items-center gap-3">
      <Link to={reviewRecordPath(accountId)} className="text-sm font-semibold text-muted hover:text-ink hover:underline">
        ← 리뷰 기록으로
      </Link>
      {/* The conversation that sent the seller here is still the one at `/` — the pointer is stored per
          org and restored on mount, so this link returns to the same thread rather than starting one.
          Rendered only when a conversation actually sent them: on a page reached from the record it
          would offer a way back to somewhere they were not. */}
      {cameFromConversation ? (
        <Link to="/" className="text-sm font-semibold text-muted hover:text-ink hover:underline">
          대화로 돌아가기
        </Link>
      ) : null}
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {back}
        <PageHead title="답변 작업" compact />
        <p className="text-sm text-muted">불러오는 중…</p>
      </div>
    );
  }

  if (failed || !detail) {
    return (
      <div className="space-y-4">
        {back}
        <PageHead title="답변 작업" compact />
        <Empty
          title="이 리뷰를 불러오지 못했습니다"
          body="연결 상태를 확인한 뒤 다시 시도해 주세요. 불러오지 못한 리뷰를 임의로 채우지는 않습니다."
          action={<Btn size="sm" onClick={() => setVersion((v) => v + 1)}>다시 시도</Btn>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {back}
      <PageHead
        title="답변 작업"
        compact
        meta={
          <Facts className="text-sm text-muted">
            {detail.productName ? <span className="break-keep text-ink">{detail.productName}</span> : null}
            <span className="tabular-nums">{ratingLabel(detail.rating)}</span>
            <span className="tabular-nums">{detail.writtenOn ?? "날짜 없음"}</span>
          </Facts>
        }
        action={<BtnLink to={`${reviewRecordPath(accountId)}?review=${detail.id}`} variant="ghost" size="sm">리뷰 기록에서 보기</BtnLink>}
      />

      {/* No card around the panel: the panel IS the card, and a border drawn around a border says
          nothing a seller can use (docs/reviewnary_design.md — containment carries information). The
          page is the container here; there is one review on it. */}
      {detail.replyWork ? (
        <div className="flex flex-col gap-3">
          {/* The one cluster the product has — the same one the record's detail panel and the 내 답변 작업
              rows mount. Read-only triage: the decision that put this review on the worklist was made
              where reviews are triaged, and a toggle group above the draft is what pushed 승인 down the
              screen in the first place. Changing it is one link away, in the record. */}
          <ReplyWorkControls
            key={detail.id}
            accountId={accountId}
            actionRef={detail.replyWork.actionRef}
            disposition={detail.replyWork.triageDisposition}
            hasReplyPreparation={detail.replyWork.hasReplyPreparation}
            triageMode={
              detail.replyWork.triageDisposition === "RESPONSE_NEEDED" || detail.replyWork.hasReplyPreparation
                ? "readonly"
                : "edit"
            }
            headingLevel={2}
            onDecided={() => setVersion((v) => v + 1)}
            onOutcomeRecorded={() => setVersion((v) => v + 1)}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-surface p-5">
          <p className="break-keep text-sm leading-relaxed text-muted">
            이 채널에서는 reviewnary가 답변을 작성하지 않습니다. 리뷰 내용은 리뷰 기록에서 읽을 수 있습니다.
          </p>
        </div>
      )}

      {/* Secondary, and folded: how this review was sorted. It is kept because it is true and a seller
          may want it; it is folded because it is not what decides the answer, and putting it above the draft
          is what this page exists to undo. */}
      <Disclosure label="이 리뷰의 자동 분류" note={TRIAGE_TIER_LABEL[detail.triage.tier]}>
        <div className="space-y-1.5 px-2 pb-2 text-sm leading-relaxed text-muted">
          <p>{detail.triage.reason}</p>
          {detail.triage.recommendedAction ? <p className="text-ink">{detail.triage.recommendedAction}</p> : null}
          {detail.triage.tags.length > 0 ? <p>분류: {detail.triage.tags.join(" · ")}</p> : null}
        </div>
      </Disclosure>
    </div>
  );
}

/**
 * `/reviews/reply/:reviewId` — the same task, addressed by the review ALONE.
 *
 * The conversation knows a review by its id and nothing else; the account is ours, not the seller's,
 * and asking a chat artifact to carry it would put a second identifier in the wire contract to save
 * one org-scoped read. So the id resolves here, through the exact read the review anchor already
 * stands on (`GET /api/reviews/{reviewId}`), and the page redirects to the account-scoped address.
 * Another org's id is a 404 there, so it lands on the same honest failure as a deleted review.
 */
export function ReviewReplyTaskEntry() {
  const { reviewId = "" } = useParams();
  const [params] = useSearchParams();
  const [resolved, setResolved] = useState<ReviewDetailResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!reviewId) return;
    let live = true;
    api
      .getReviewDetailStrict(reviewId)
      .then((view) => {
        if (live) setResolved(view);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [reviewId]);

  if (failed) {
    return (
      <div className="space-y-4">
        <PageHead title="답변 작업" compact />
        <Empty
          title="이 리뷰를 찾지 못했습니다"
          body="리뷰가 삭제되었거나 이 계정에서 볼 수 없는 리뷰입니다."
          action={<BtnLink to="/reviews" size="sm">리뷰 기록 열기</BtnLink>}
        />
      </div>
    );
  }
  if (!resolved) {
    return (
      <div className="space-y-4">
        <PageHead title="답변 작업" compact />
        <p className="text-sm text-muted">불러오는 중…</p>
      </div>
    );
  }
  if (!resolved.sellerAccountId) {
    // A review with no account binding has no reply surface to open — the reply endpoints are
    // addressed by the account. Say that, rather than routing to a path that cannot resolve.
    return (
      <div className="space-y-4">
        <PageHead title="답변 작업" compact />
        <Empty
          title="이 리뷰의 판매 계정을 확인하지 못했습니다"
          body="답변 준비는 계정 단위로 열립니다. 리뷰 기록에서 채널을 고른 뒤 다시 시도해 주세요."
          action={<BtnLink to="/reviews" size="sm">리뷰 기록 열기</BtnLink>}
        />
      </div>
    );
  }
  const search = params.toString();
  return (
    <Navigate
      replace
      to={`${reviewRecordPath(resolved.sellerAccountId)}/reply/${resolved.id}${search ? `?${search}` : ""}`}
    />
  );
}
