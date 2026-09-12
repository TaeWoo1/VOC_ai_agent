import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { Empty } from "../../components/ui/Empty";
import { Facts } from "../../components/ui/ObjectRow";
import { Section } from "../../components/ui/Section";
import { Btn, BtnLink } from "../../components/ui/Btn";
import { VocItemReplyPrep } from "../../components/VocItemReplyPrep";
import { SellerCorrectionControls } from "../../components/reviews/SellerCorrectionControls";
import { ChannelAnsweredState } from "../../components/reviews/ChannelAnsweredState";
import { ReviewProblemCard } from "../../components/reviews/decision/ReviewProblemCard";
import { RepeatedSignal } from "../../components/reviews/decision/RepeatedSignal";
import { GroundingOnHand } from "../../components/reviews/decision/GroundingOnHand";
import { DecisionActionStep } from "../../components/reviews/decision/DecisionActionStep";
import { DecisionLog } from "../../components/reviews/decision/DecisionLog";
import { api } from "../../lib/apiClient";
import { reviewRecordPath, ratingLabel } from "../../lib/reviewRecord";
import { reviewWord } from "../../lib/channelVocabulary";
import type {
  ChannelReviewDetailView,
  ReviewDecisionContext,
  ReviewDecisionLogEntry,
  ReviewDetailResponse,
  TriageDisposition,
} from "../../lib/types";

/**
 * <b>리뷰 처리 — the Review Decision Workspace.</b>
 *
 * <p>One review, and everything needed to decide it, in the order a person decides:
 * <ol>
 *   <li>what the customer said, and</li>
 *   <li>why it is in front of them ({@link ReviewProblemCard});</li>
 *   <li>whether anyone has said it before ({@link RepeatedSignal});</li>
 *   <li>what a reply would stand on ({@link GroundingOnHand});</li>
 *   <li>what the SELLER thinks ({@link SellerCorrectionControls});</li>
 *   <li>what they will DO ({@link DecisionActionStep});</li>
 *   <li>the draft that follows from that choice, and only from 대응 필요;</li>
 *   <li>what has already been decided ({@link DecisionLog}).</li>
 * </ol>
 *
 * <p><b>What this screen was before.</b> Review Approval Path v1 built it as 답변 작업 — an address for
 * one review's approve button, which was the right fix for the problem it had (the button sat at
 * y=5,425 of a 5,587px record). But it opened on a draft: the customer's sentence and the reason the
 * review was ranked were folded away under 「이 리뷰의 자동 분류」, the seller's own judgment lived on a
 * different screen, the repeated problems were one muted line with no examples, and what the company
 * had written down was not mentioned at all. A seller could approve here; they could not DECIDE here.
 * Everything this page now shows already existed — on five screens, none of them this one.
 *
 * <p><b>Reuse, not replacement.</b> The reply lane is untouched: the same {@link VocItemReplyPrep}
 * panel, the same append-only draft versions, the same approval boundary and fingerprint, the same
 * copy-then-post handoff. The decision is the same `TriageDisposition` through the same endpoint with
 * the same idempotency key and audit trail. The seller's judgment is T-07's correction, unchanged. The
 * log invents no store: it reads trails that were already being written.
 *
 * <p><b>Three reads open it</b> — the review, the decision context, the decision log — and the last two
 * are deliberately separate from the first: neither is needed to answer a customer, so neither may
 * delay or fail the panel that does. A failed context or log renders nothing rather than an absence
 * claim about something the screen never saw.
 *
 * <p><b>Nothing on this page posts to a marketplace.</b> The only writes are the ones the product
 * already had, and every one of them lands in reviewnary's own database.
 */
export function ReviewReplyTask() {
  const { accountId = "", reviewId = "" } = useParams();
  const [params] = useSearchParams();
  const cameFromConversation = params.get("from") === "chat";

  const [detail, setDetail] = useState<ChannelReviewDetailView | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  // Bumped by this page's own writes so the reads that describe them run again. The panel refreshes
  // itself; this exists so a decision recorded here is not described by a read taken before it.
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // The context and the log: SECOND and THIRD reads, and deliberately separate ones. Null covers both
  // "not read yet" and "read failed", and the two are the same on screen on purpose — a screen that
  // could not see the issue memory has nothing to say about it, and 「반복된 적 없습니다」 from a read
  // that never returned would be an invention.
  const [context, setContext] = useState<ReviewDecisionContext | null>(null);
  const [contextFailed, setContextFailed] = useState(false);
  const [log, setLog] = useState<ReviewDecisionLogEntry[] | null>(null);
  const [logFailed, setLogFailed] = useState(false);

  // The live decision. `context.currentDecision` is a snapshot from the last read; a choice made in
  // this session must open the draft step immediately rather than after a reload.
  const [decision, setDecision] = useState<TriageDisposition | null>(null);
  // Whether the review carries reply work that must stay reachable whatever the decision now says.
  // Monotonic within a session: a draft written while the review was 대응 필요 must stay readable — and
  // any approval withdrawable — after the seller moves it to 지켜보기.
  const [prepared, setPrepared] = useState(false);
  const [localWork, setLocalWork] = useState(false);

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
        setPrepared((was) => was || (view.replyWork?.hasReplyPreparation ?? false));
        if (view.replyWork?.triageDisposition) setDecision(view.replyWork.triageDisposition);
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

  useEffect(() => {
    if (!accountId || !reviewId) return;
    let live = true;
    api
      .getReviewDecisionContext(accountId, reviewId)
      .then((view) => {
        if (!live) return;
        setContext(view);
        setContextFailed(false);
        // The server's answer wins over a decision this session has not made. It does not overwrite a
        // choice made here: `version` bumps on every write, so by the time this lands it has read it.
        setDecision(view.currentDecision);
      })
      .catch(() => {
        if (!live) return;
        setContext(null);
        setContextFailed(true);
      });
    return () => {
      live = false;
    };
  }, [accountId, reviewId, version]);

  useEffect(() => {
    if (!accountId || !reviewId) return;
    let live = true;
    api
      .getReviewDecisionLog(accountId, reviewId)
      .then((rows) => {
        if (!live) return;
        setLog(rows);
        setLogFailed(false);
      })
      .catch(() => {
        if (!live) return;
        setLog(null);
        setLogFailed(true);
      });
    return () => {
      live = false;
    };
  }, [accountId, reviewId, version]);

  const word = reviewWord(context?.channelCode ?? null);

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
        <PageHead title="리뷰 처리" compact />
        <p className="text-sm text-muted">불러오는 중…</p>
      </div>
    );
  }

  if (failed || !detail) {
    return (
      <div className="space-y-4">
        {back}
        <PageHead title="리뷰 처리" compact />
        <Empty
          title="이 리뷰를 불러오지 못했습니다"
          body="연결 상태를 확인한 뒤 다시 시도해 주세요. 불러오지 못한 리뷰를 임의로 채우지는 않습니다."
          action={<Btn size="sm" onClick={bump}>다시 시도</Btn>}
        />
      </div>
    );
  }

  const replyWork = detail.replyWork;
  // The draft belongs to the chosen action: it opens on 대응 필요, and it stays open for work that
  // already exists so an approved reply can never be stranded where the seller can neither read nor
  // withdraw it. Both operands are free — the decision is local and `prepared` starts from a flag this
  // page already read — so the rule costs no request of its own.
  const showDraft = replyWork !== null && (decision === "RESPONSE_NEEDED" || prepared || localWork);
  // The decision's address: the context read's, or the reply lane's, which is the same address minted
  // by the same server for the same review. Neither is composed here.
  const decisionRef = context?.decisionRef ?? replyWork?.actionRef ?? null;

  return (
    <div className="space-y-6">
      {back}
      <PageHead
        title="리뷰 처리"
        compact
        meta={
          <Facts className="text-sm text-muted">
            {detail.productName ? (
              context?.productId ? (
                <Link to={`/products/${context.productId}`} className="break-keep font-medium text-ink hover:underline">
                  {detail.productName}
                </Link>
              ) : (
                <span className="break-keep text-ink">{detail.productName}</span>
              )
            ) : null}
            <span className="tabular-nums">{ratingLabel(detail.rating)}</span>
            <span className="tabular-nums">{detail.writtenOn ?? "날짜 없음"}</span>
          </Facts>
        }
        action={<BtnLink to={`${reviewRecordPath(accountId)}?review=${detail.id}`} variant="ghost" size="sm">리뷰 기록에서 보기</BtnLink>}
      />

      {/* 1 · 2 — what the problem is, and why it is here. */}
      <ReviewProblemCard detail={detail} word={word} />

      {/* The channel's own statement, said BEFORE anyone decides anything. The panel that has always
          known this does not mount until after the decision, so the fact was invisible at the one
          moment it changes what a person would do. It is not the seller's decision and makes none. */}
      <ChannelAnsweredState state={replyWork?.channelReplyState ?? null} />

      {/* 3 — has anyone said this before. */}
      <RepeatedSignal problems={context?.repeatedProblems ?? []} failed={contextFailed || context === null} />

      {/* 4 — what a reply would stand on. */}
      {context ? <GroundingOnHand context={context} /> : null}

      {/* 5 — the seller's own judgment, which does not replace the system's. */}
      <Section title="판매자 판단" ariaLabel="판매자 판단 영역">
        <SellerCorrectionControls
          accountId={accountId}
          reviewId={detail.id}
          word={word}
          systemTier={detail.triage.tier}
          aiMarked={detail.aiMark !== null}
          correction={detail.sellerCorrection}
          onCorrected={bump}
          headingLevel={3}
        />
      </Section>

      {/* 6 — what to do. The address is the decision's own, so a channel with no reply flow can still
          record one; where the reply lane exists its ref addresses the same decision, so a failed
          context read costs the seller the CONTEXT and not the ability to decide. Both are minted by
          the server — this page composes neither. With no ref at all there is no control, because a
          control that could not write is worse than none. */}
      {decisionRef ? (
        <DecisionActionStep
          accountId={accountId}
          reviewId={detail.id}
          decisionRef={decisionRef}
          decision={decision}
          replySupported={replyWork !== null}
          onDecided={(next) => {
            setDecision(next);
            bump();
          }}
          onRecorded={bump}
        />
      ) : null}

      {/* 7 — the draft that follows from 대응 필요. The same panel as every other reply surface: no
          second reply flow, no write this page owns, and the approval boundary untouched. */}
      {showDraft && replyWork ? (
        <Section title="답변 준비" ariaLabel="답변 준비 영역">
          <VocItemReplyPrep
            key={`prep-${replyWork.actionRef}`}
            accountId={accountId}
            actionRef={replyWork.actionRef}
            disposition={decision}
            onPrepared={() => setPrepared(true)}
            onOutcomeRecorded={bump}
            onLocalWork={setLocalWork}
            headingLevel={3}
          />
        </Section>
      ) : null}

      {replyWork === null ? (
        <div className="space-y-1">
          <p className="break-keep text-sm leading-relaxed text-muted">
            이 채널에서는 reviewnary가 답변을 작성하지 않습니다.
          </p>
          <p className="break-keep text-sm leading-relaxed text-muted">
            판단과 조치는 위에 기록되고, 원문은 리뷰 기록에서 읽을 수 있습니다.
          </p>
        </div>
      ) : null}

      {/* 8 — what has already been decided. */}
      <DecisionLog entries={log ?? []} failed={logFailed || log === null} />
    </div>
  );
}

/**
 * `/reviews/reply/:reviewId` — the same workspace, addressed by the review ALONE.
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
        <PageHead title="리뷰 처리" compact />
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
        <PageHead title="리뷰 처리" compact />
        <p className="text-sm text-muted">불러오는 중…</p>
      </div>
    );
  }
  if (!resolved.sellerAccountId) {
    // A review with no account binding has no workspace to open — every endpoint this page uses is
    // addressed by the account. Say that, rather than routing to a path that cannot resolve.
    return (
      <div className="space-y-4">
        <PageHead title="리뷰 처리" compact />
        <Empty
          title="이 리뷰의 판매 계정을 확인하지 못했습니다"
          body="리뷰 처리는 계정 단위로 열립니다. 리뷰 기록에서 채널을 고른 뒤 다시 시도해 주세요."
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
