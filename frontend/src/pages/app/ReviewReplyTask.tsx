import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { Empty } from "../../components/ui/Empty";
import { Facts } from "../../components/ui/ObjectRow";
import { Section } from "../../components/ui/Section";
import { Btn } from "../../components/ui/Btn";
import { VocItemReplyPrep } from "../../components/VocItemReplyPrep";
import { SellerCorrectionControls } from "../../components/reviews/SellerCorrectionControls";
import { ChannelAnsweredState } from "../../components/reviews/ChannelAnsweredState";
import { TriageTierChip } from "../../components/reviews/TriageTierChip";
import { ReviewProblemCard } from "../../components/reviews/decision/ReviewProblemCard";
import { RepeatedSignal } from "../../components/reviews/decision/RepeatedSignal";
import { GroundingOnHand } from "../../components/reviews/decision/GroundingOnHand";
import { DecisionActionStep } from "../../components/reviews/decision/DecisionActionStep";
import { DecisionLog } from "../../components/reviews/decision/DecisionLog";
import { api } from "../../lib/apiClient";
import { reviewRecordPath } from "../../lib/reviewRecord";
import { reviewWord } from "../../lib/channelVocabulary";
import { plainText } from "../../lib/plainText";
import { COPY, sourceLabel } from "../../lib/copy/customerOps";
import { Disclosure } from "../../components/ui/Disclosure";
import { CaseBlock, CaseLayout, DecisionCard, type CaseVariant, type PaneDepth } from "../../components/workspace/CaseLayout";
import { DECISION_ACTION_NOTE, DECISION_ACTION_WORD } from "../../lib/reviewDecision";
import type {
  ChannelReviewDetailView,
  ReviewDecisionContext,
  ReviewDecisionLogEntry,
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
 * <p><b>Addressed by the review alone</b> (Agent-native Core Boundary v1). `/reviews/reply/:reviewId`
 * IS this page now — it used to resolve an account and redirect, and a review with no account to
 * resolve hit a dead end that said so in as many words. Every read and write above is org-scoped; the
 * account arrives as a FACT on the detail (`sellerAccountId`) and is used for exactly the two things
 * that are genuinely account-shaped: the reply panel, and the link back to that channel's record.
 *
 * <p><b>Nothing on this page posts to a marketplace.</b> The only writes are the ones the product
 * already had, and every one of them lands in reviewnary's own database.
 */
export function ReviewReplyTask() {
  const { reviewId = "" } = useParams();
  const [params] = useSearchParams();
  const from = params.get("from");
  return (
    <ReviewCaseView
      reviewId={reviewId}
      variant="page"
      from={from === "chat" || from === "work" || from === "record" ? from : null}
    />
  );
}

/**
 * The Review Case in either reading of {@link CaseLayout} — its own page, or the right-hand pane of 확인할 일 and
 * 오늘. The reads, the writes and the reply lane are the same in both; only the placement differs.
 *
 * <p><b>Two judgments, numbered, because they are two.</b> 「이 리뷰의 중요도」 is T-07's correction of the
 * triage tier; 「처리 방법」 is the `TriageDisposition`. They used to stand one under the other with the same word —
 * 「지켜보기」 — on a button in each, recorded in two different stores. The stored values are unchanged; the
 * disposition's word is now 「두고 보기」 (`TRIAGE_OPTIONS`) so the seller can tell which question a press answers.
 */
export function ReviewCaseView({
  reviewId,
  variant,
  depth = "full",
  from = null,
}: {
  reviewId: string;
  variant: CaseVariant;
  /**
   * {@link PaneDepth}. 「preview」 leaves the two judgments and the record control to the full case and
   * says instead what stands — see {@link DecisionSoFar}.
   */
  depth?: PaneDepth;
  /** Where a full page was opened from — decides which way back it offers. */
  from?: "chat" | "work" | "record" | null;
}) {
  const pane = variant === "pane";
  const preview = pane && depth === "preview";
  const paneEvidenceFolded = pane && !preview;

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
  // any approval withdrawable — after the seller moves it to 두고 보기.
  const [prepared, setPrepared] = useState(false);
  const [localWork, setLocalWork] = useState(false);

  useEffect(() => {
    // A pane that switches from one review to the next must not carry the last one's session state.
    setDecision(null);
    setPrepared(false);
    setLocalWork(false);
  }, [reviewId]);

  useEffect(() => {
    if (!reviewId) return;
    let live = true;
    setLoading(true);
    api
      .getReviewWorkspace(reviewId)
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
  }, [reviewId, version]);

  useEffect(() => {
    if (!reviewId) return;
    let live = true;
    api
      .getReviewDecisionContext(reviewId)
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
  }, [reviewId, version]);

  useEffect(() => {
    if (!reviewId) return;
    let live = true;
    api
      .getReviewDecisionLog(reviewId)
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
  }, [reviewId, version]);

  const word = reviewWord(context?.channelCode ?? null);

  // The channel record is an ACCOUNT-shaped surface: it lists what one connected account holds. A
  // review this org uploaded has no such page, so the way back is the index rather than a link into a
  // record that does not exist.
  const recordPath = detail?.sellerAccountId ? reviewRecordPath(detail.sellerAccountId) : "/reviews";

  const back = pane ? undefined : (
    <div className="flex flex-wrap items-center gap-3">
      {/* The way back is the way in. A review opened from 확인할 일 goes back there — sending the seller to one
          channel's record would drop them into a list they never came from. */}
      {from === "work" ? (
        <Link to="/customer-operations/cases" className="text-sm font-semibold text-muted hover:text-ink hover:underline">
          ← {COPY.listTitle}
        </Link>
      ) : from === "record" ? (
        <Link to="/reviews" className="text-sm font-semibold text-muted hover:text-ink hover:underline">
          ← 리뷰
        </Link>
      ) : (
        <Link to={recordPath} className="text-sm font-semibold text-muted hover:text-ink hover:underline">
          ← 리뷰 기록으로
        </Link>
      )}
      {/* The conversation that sent the seller here is still the one at `/` — the pointer is stored per
          org and restored on mount, so this link returns to the same thread rather than starting one.
          Rendered only when a conversation actually sent them. */}
      {from === "chat" ? (
        <Link to="/" className="text-sm font-semibold text-muted hover:text-ink hover:underline">
          대화로 돌아가기
        </Link>
      ) : null}
    </div>
  );

  if (loading && !detail) {
    return (
      <div className="space-y-4">
        {back}
        {pane ? null : <PageHead title="리뷰 처리" compact />}
        <p className="text-sm text-muted">불러오는 중…</p>
      </div>
    );
  }

  if (failed || !detail) {
    return (
      <div className="space-y-4">
        {back}
        {pane ? null : <PageHead title="리뷰 처리" compact />}
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
  // withdraw it.
  const showDraft = replyWork !== null && (decision === "RESPONSE_NEEDED" || prepared || localWork);
  // The reply lane's own address. Reply work is only ever handed out with an account behind it, so
  // this is non-null exactly when the panel below mounts.
  const replyAccountId = detail.sellerAccountId ?? "";
  const body = detail.body ? plainText(detail.body).trim() : "";
  const title = detail.textless || body.length === 0 ? `별점만 남긴 ${word}` : body;

  return (
    <CaseLayout
      variant={variant}
      decisionLabel="판매자의 결정"
      nav={back}
      meta={
        <Facts>
          <span>{sourceLabel(context?.channelCode ?? null, "REVIEW", detail.rating)}</span>
          <span className="tabular-nums">{detail.writtenOn ?? "날짜 없음"}</span>
        </Facts>
      }
      sub={
        detail.productName ? (
          context?.productId ? (
            <Link to={`/products/${context.productId}`} className="hover:text-ink hover:underline">
              {detail.productName}
            </Link>
          ) : (
            detail.productName
          )
        ) : undefined
      }
      depth={depth}
      title={title}
      headerAction={
        preview ? undefined : pane ? (
          <Link to={`/reviews/reply/${detail.id}?from=work`} className="rounded font-semibold text-muted hover:text-ink hover:underline">
            전체 화면으로
          </Link>
        ) : detail.sellerAccountId ? (
          <Link
            to={`${reviewRecordPath(detail.sellerAccountId)}?review=${detail.id}`}
            className="rounded font-semibold text-muted hover:text-ink hover:underline"
          >
            리뷰 기록에서 보기
          </Link>
        ) : undefined
      }
      subject={
        // The customer's sentence is the title above; this block is what the RULES said about it.
        //
        // Folded in the pane (Home v3), open on the full page. The order the seller needs is 고객 요청 →
        // 확인한 사실 → 내가 결정할 것 → 그 결정의 실행, and in a 556px column the middle step was costing
        // ~150px of the only fold there is: measured at 1440×900, the filled button that actually does
        // something sat at y=960 while a classification control sat at y=405. Nothing is removed and
        // nothing is summarised away — the facts are one press from where they always were, and the page
        // variant, which has a second column for them, is unchanged.
        pane ? (
          <Disclosure label="왜 올라왔나요" summaryClassName="-ml-2">
            <div className="pt-2">
              <ReviewProblemCard detail={detail} word={word} showBody={false} />
            </div>
          </Disclosure>
        ) : (
          <CaseBlock title="왜 올라왔나요" tone="plain" flat>
            <ReviewProblemCard detail={detail} word={word} showBody={false} />
          </CaseBlock>
        )
      }
      decision={
        preview ? (
          <>
            <ChannelAnsweredState state={replyWork?.channelReplyState ?? null} />
            <DecisionSoFar decision={decision} replySupported={replyWork !== null} reason={detail.replyUnavailableReason} />
          </>
        ) : (
        <>
          {/* The channel's own statement, said BEFORE anyone decides anything. */}
          <ChannelAnsweredState state={replyWork?.channelReplyState ?? null} />

          {/* <b>Two questions, one card</b> (Review Decision UX v3.2). They were a card each, and the
              numbering — not the border — is what tells them apart: 「① 이 리뷰의 중요도」 and 「② 처리 방법」
              are the seller's judgment of this review, asked in order, and they are answered in one
              sitting. Two cards cost 40px of padding and a 14px gap for a separation the numerals already
              made, and they pushed 「AI 초안 준비」 — the thing this screen exists for — outside the fold at
              every width the product is used at. A hairline divides them now. Neither control changed. */}
          <DecisionCard primary={decision === null}>
            <div className="space-y-3">
              {/* ① — the seller's own judgment of the tier, which does not replace the system's.
                  <b>Folded in the pane.</b> It is a different judgment from ② and a secondary one: the
                  triage contract §5-C says it stands BESIDE the system's and changes no ordering, so
                  nothing downstream waits on it. In a 556px column it was 160px standing between
                  확인한 사실 and the action; the page, which has a whole second column for it, keeps it
                  open. The fold's own summary names the tier that stands, so what it holds is visible
                  without opening it. */}
              {paneEvidenceFolded ? (
                <Disclosure
                  label="① 이 리뷰의 중요도"
                  note={<TriageTierChip tier={detail.sellerCorrection?.correctedTier ?? detail.triage.tier} />}
                  summaryClassName="-ml-2"
                >
                  <div className="pt-1">
                    <SellerCorrectionControls
                      reviewId={detail.id}
                      word={word}
                      systemTier={detail.triage.tier}
                      aiMarked={detail.aiMark !== null}
                      correction={detail.sellerCorrection}
                      onCorrected={bump}
                      headingLevel={3}
                    />
                  </div>
                </Disclosure>
              ) : (
                <Section title="① 이 리뷰의 중요도" ariaLabel="판매자 판단 영역">
                  <SellerCorrectionControls
                    reviewId={detail.id}
                    word={word}
                    systemTier={detail.triage.tier}
                    aiMarked={detail.aiMark !== null}
                    correction={detail.sellerCorrection}
                    onCorrected={bump}
                    headingLevel={3}
                  />
                </Section>
              )}

              <div className="border-t border-line pt-3">
                {/* ② — what to do. Stands on every review the workspace can open: a channel with no reply
                    flow, and a review no account acquired. */}
                <DecisionActionStep
                  reviewId={detail.id}
                  decision={decision}
                  replySupported={replyWork !== null}
                  replyUnavailableReason={detail.replyUnavailableReason}
                  title="② 처리 방법"
                  onDecided={(next) => {
                    setDecision(next);
                    bump();
                  }}
                  onRecorded={bump}
                />
              </div>
            </div>
          </DecisionCard>

          {/* The draft that follows from 대응 필요. The same panel as every other reply surface: no second
              reply flow, no write this page owns, and the approval boundary untouched. */}
          {showDraft && replyWork ? (
            <DecisionCard primary>
              {/* The panel names itself 「답변 준비」 — a Section around it said the same word twice (Phase 4). */}
              <VocItemReplyPrep
                key={`prep-${replyWork.actionRef}`}
                accountId={replyAccountId}
                actionRef={replyWork.actionRef}
                disposition={decision}
                onPrepared={() => setPrepared(true)}
                onOutcomeRecorded={bump}
                onLocalWork={setLocalWork}
                headingLevel={2}
                subjectShownAbove
                unboxed
              />
              {/* 작업에서 제외 lived only on the 리뷰 screen's 「내 답변 작업」 list; that list is gone and its rows are
                  확인할 일's now, so the one exit from the to-do stands with the work it takes out. */}
              {detail.sellerAccountId ? (
                <SetAsideFromWork accountId={detail.sellerAccountId} actionRef={replyWork.actionRef} onDone={bump} />
              ) : null}
            </DecisionCard>
          ) : null}

          {/* Why there is no draft — and the two reasons are not the same sentence. The server decides which. */}
          {replyWork === null ? (
            <div className="space-y-1">
              <p className="break-keep text-sm leading-relaxed text-muted">
                {detail.replyUnavailableReason === "NO_SELLER_ACCOUNT"
                  ? "이 채널에 연결된 판매 계정이 없어 답변을 준비할 수 없습니다."
                  : "이 채널에서는 reviewnary가 답변을 작성하지 않습니다."}
              </p>
              <p className="break-keep text-sm leading-relaxed text-muted">판단과 조치는 위에 기록됩니다.</p>
            </div>
          ) : null}
        </>
        )
      }
      context={
        // <b>Folded in the full pane, open on the page and in the preview.</b> 확인한 사실 comes before
        // 판매자 판단 now (Review Decision UX v3.2), and in a 556px column these two sections measure
        // 644px — so keeping them open moved 「AI 초안 준비」 to y=1,351, three folds down. Folded they are
        // 72px and the decision is back on the first screen, which is the promise the new order was
        // allowed to make. Same blocks, same reads, one press; 왜 올라왔나요 has been folded here since
        // Home v3 for the same reason. The PAGE has a second column for them and the Home preview offers
        // no forms to push down, so neither folds.
        paneEvidenceFolded ? (
          <>
            <Disclosure
              label="반복 신호"
              note={
                (context?.repeatedProblems.length ?? 0) > 0 ? `${context!.repeatedProblems.length}` : undefined
              }
              summaryClassName="-ml-2"
            >
              <div className="pt-1">
                <RepeatedSignal
                  problems={context?.repeatedProblems ?? []}
                  failed={contextFailed || context === null}
                  titled={false}
                />
              </div>
            </Disclosure>
            {context ? (
              <Disclosure label="이 상품에 대해 우리가 아는 것" summaryClassName="-ml-2">
                <div className="pt-1">
                  <GroundingOnHand context={context} titled={false} />
                </div>
              </Disclosure>
            ) : null}
          </>
        ) : (
          <>
            <RepeatedSignal problems={context?.repeatedProblems ?? []} failed={contextFailed || context === null} />
            {context ? <GroundingOnHand context={context} /> : null}
          </>
        )
      }
      more={<DecisionLog entries={log ?? []} failed={logFailed || log === null} />}
    />
  );
}

/**
 * <b>추천 — what stands, in a preview that does not offer the forms</b> (Home v3.1).
 *
 * <p>Two facts and no third: the `TriageDisposition` that is recorded right now (or that none is), and
 * whether a draft can be prepared for this review at all — the same three reasons
 * {@link DECISION_ACTION_NOTE} already distinguishes, in the same words, so the preview and the case
 * cannot describe one review's reply lane differently.
 *
 * <p><b>It reads and never writes.</b> The controls that change either fact live on the full case, one
 * press away through the pane's docked action.
 */
function DecisionSoFar({
  decision,
  replySupported,
  reason,
}: {
  decision: TriageDisposition | null;
  replySupported: boolean;
  reason: "CHANNEL_HAS_NO_REPLY_FLOW" | "NO_SELLER_ACCOUNT" | null;
}) {
  return (
    <div className="space-y-1.5 border-t border-line pt-4">
      <h3 className="text-sm font-bold text-muted">처리 방법</h3>
      <p className="break-keep text-[15px] font-semibold leading-relaxed text-ink">
        {decision ? `「${DECISION_ACTION_WORD[decision]}」로 정해 두셨습니다.` : "아직 처리 방법을 정하지 않았습니다."}
      </p>
      {/* Only when there is no reply lane. `withReply` promises 「아래에서 …준비하고 승인할 수 있습니다」 and in a
          preview there is no 아래 — the way to it is the docked action under this block, which says so itself.
          The other two are statements about the channel and this seller's setup, true wherever they are read. */}
      {replySupported ? null : (
        <p className="break-keep text-sm leading-relaxed text-muted">
          {reason === "NO_SELLER_ACCOUNT" ? DECISION_ACTION_NOTE.withoutAccount : DECISION_ACTION_NOTE.withoutReply}
        </p>
      )}
    </div>
  );
}

/**
 * `/reviews/:accountId/reply/:reviewId` — the address this page used to live at.
 *
 * <b>A redirect, and nothing else.</b> The canonical address is `/reviews/reply/:reviewId`: the
 * account was never part of the authorization, and keeping two live copies of one screen is how the
 * two eventually disagree about what a review is. Links that already exist — a bookmark, a record
 * screen, an old chat artifact — land on the same workspace with their query string intact.
 *
 * The account id is not checked and not passed on. If it named an account this org does not own, the
 * page it used to open answered 404; now the review it names decides, which is the same answer for an
 * id from another org and a better one for every id that was simply redundant.
 */
export function ReviewReplyTaskLegacyEntry() {
  const { reviewId = "" } = useParams();
  const [params] = useSearchParams();
  const search = params.toString();
  return <Navigate replace to={`/reviews/reply/${reviewId}${search ? `?${search}` : ""}`} />;
}

/**
 * 「작업에서 제외」 — the reply to-do's one exit, moved here from the 리뷰 screen's 「내 답변 작업」 (UI/UX v2 Phase 3).
 *
 * <p>The same write, the same idempotency key and the same confirmation sentence it always had: the review leaves
 * the to-do (확인할 일) and nothing else happens — no draft is deleted, nothing is recorded as answered — and it can
 * be restored from 확인할 일's 「지난 답변 작업」.
 */
function SetAsideFromWork({ accountId, actionRef, onDone }: { accountId: string; actionRef: string; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  if (state === "done") {
    return (
      <p role="status" className="mt-3 border-t border-line pt-3 text-sm text-ink" data-testid="reply-work-dismissed-notice">
        리뷰를 답변 작업 목록에서 제외했어요. 저장한 초안과 기록은 그대로 있습니다.
      </p>
    );
  }
  return (
    <div className="mt-3 border-t border-line pt-3">
      {confirming ? (
        <div role="group" aria-label="작업에서 제외 확인" className="space-y-2" data-testid="reply-work-dismiss-confirm">
          <p className="break-keep text-sm text-muted">
            이 리뷰를 확인할 일에서만 제외합니다. 저장한 초안과 기록은 그대로 남고, 답변한 것으로 기록되지 않습니다.
            제외한 리뷰는 확인할 일 아래 &apos;제외한 작업&apos;에서 다시 확인하고 복원할 수 있어요.
          </p>
          <div className="flex flex-wrap gap-2">
            <Btn
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.dismissReplyWork(accountId, actionRef, { commandId: crypto.randomUUID() });
                  setState("done");
                  onDone();
                } catch {
                  setState("failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "제외하는 중…" : "제외하기"}
            </Btn>
            <Btn size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              취소
            </Btn>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-sm text-muted underline underline-offset-2 hover:text-ink"
          data-testid="reply-work-dismiss"
        >
          작업에서 제외
        </button>
      )}
      {state === "failed" ? <p className="mt-2 text-sm text-bad">제외하지 못했습니다. 잠시 후 다시 시도해 주세요.</p> : null}
    </div>
  );
}
