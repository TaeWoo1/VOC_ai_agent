import { useCallback, useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { AnswerBasisQuickAdd } from "./AnswerBasisQuickAdd";
import { api } from "../../lib/apiClient";
import {
  canGenerateProposal,
  classifyProposeError,
  detailErrorMessage,
  waitedLabel,
} from "../../lib/inquiryWorkflow";
import {
  canEditDraft,
  answeredElsewhere,
  canPublishReply,
  canResumePublish,
  canVerifyPublish,
  classifyPublishError,
  publishCategoryLabel,
  publishUnavailableReason,
} from "../../lib/inquiryPublish";
import type {
  DraftEvidenceView,
  InquiryDetail,
  OrderContextView,
  PublishCapabilityView,
  PublishStatusView,
  ReplyDraftView,
} from "../../lib/types";
import { bindingLabel, canBindProduct, productLabel } from "../../lib/inquiryProductBinding";
import { InquiryProductBinder } from "./InquiryProductBinder";
import { answerStateIsGood, answerStateOf, type AnswerStateView } from "../../lib/answerState";
import { copyText } from "../../lib/clipboard";
import { Btn } from "../ui/Btn";
import { Disclosure } from "../ui/Disclosure";
import { plainText } from "../../lib/plainText";
import { Link } from "react-router-dom";

/**
 * The inquiry response workflow, in the inbox detail panel. The engine (`inquiryWorkflow`) is reused
 * unchanged; the publish decisions live in `inquiryPublish`, and this component renders what they say.
 *
 * ## What the seller sees, in order (Inquiry Action Flow v1)
 *
 * 고객 문의 → AI 답변 → actions. Three blocks, one primary control. The previous layout put a
 * response-TYPE suggestion, a two-field editor and a send behind four same-weight buttons and three
 * explanatory paragraphs, so the screen never said what to do next.
 *
 * A draft now has a BODY, because `InquiryDraftComposer` writes one — grounded in the seller's own
 * 상품 지식 when the inquiry resolves to a product that has any. What it was grounded in is shown as
 * citations; what it could NOT be grounded in is one sentence ABOVE it (`knowledgeNote`), read before
 * the text it qualifies rather than discovered after. The response-TYPE suggestion still exists (it
 * is what moves the work item OPEN → PROPOSED) but it is one word in the meta line, not a section:
 * it was never why the seller opened this item.
 *
 * EDITING MAKES IT THEIRS. A save appends a version with a new fingerprint, which is exactly why a
 * prior approval can no longer be spent on it — the backend binds to the fingerprint, so "이전
 * 승인은 무효" is a property of the data rather than a rule this component has to remember. The
 * citations are dropped on that save for the same reason: the sentences are now the seller's, and
 * attributing them to a knowledge passage that may no longer support them would be a false claim.
 *
 * ## The send, and why it exists here now
 *
 * The backend has carried a complete, fail-closed inquiry reply-publish chain for some time — approval
 * bound immutably to an exact draft version and fingerprint, a `commandId` idempotency key, a
 * dispatch-recovery runner that reclassifies an abandoned DISPATCHING to DELIVERY_UNKNOWN and NEVER
 * resends, two independent flags, and a per-channel adapter registry that resolves empty by default.
 * It had **no caller in the product at all**: `confirm-publish` was reachable only by hand. A WRITE
 * path that exists and cannot be reached is not a safety property, it is an untested one.
 *
 * So the send is here, and every guard the backend enforces is mirrored in what the seller sees:
 *
 *  - **it is not offered unless the backend says it can be done** — `canPublishReply` reads the
 *    capability endpoint (execution flag + this channel's adapter) BEFORE any control is rendered, and
 *    fails closed when that read did not land. A channel without an adapter gets the manual hand-off
 *    it always had, with the reason said out loud;
 *  - **the approval binds to what was on screen** — the confirm sends the exact `contentFingerprint`
 *    of the draft version the seller read, so a draft that moved underneath them is a 409 and not a
 *    reply nobody reviewed;
 *  - **the press is deliberate** — a single click cannot send. The seller opens the confirm block,
 *    reads back what will be posted and where, and presses again. The second press is the ONLY thing
 *    in this product that writes to a marketplace;
 *  - **nothing is retried blindly** — "다시 시도" appears only for a retryable/publishing outcome, and
 *    DELIVERY_UNKNOWN offers verify-only, because an unobserved delivery must never be resent.
 */
export function InquiryResponsePanel({ workItemId }: { workItemId: string }) {
  const [detail, setDetail] = useState<InquiryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** `null` until the capability read lands — and `null` means "do not offer the send". */
  const [capability, setCapability] = useState<PublishCapabilityView | null>(null);
  const [publishStatus, setPublishStatus] = useState<PublishStatusView | null>(null);
  const [replyTitle, setReplyTitle] = useState("");
  const [replyComments, setReplyComments] = useState("");
  /** The second-press gate. Opening the confirm block is not sending; the button inside it is. */
  const [confirming, setConfirming] = useState(false);
  /**
   * The 초안 복사 result, and the fallback when there is no clipboard to copy with.
   *
   * `manualCopy` holds the SAVED text to reveal on a non-secure origin, because `copyText` cannot
   * pretend on one — the same rule the review lane follows. Claiming a copy that did not happen is
   * how a seller pastes an empty clipboard into a customer's inquiry and never learns why.
   */
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  /** The draft reads as text until the seller chooses to edit; an always-open textarea invites typing. */
  const [editing, setEditing] = useState(false);
  /** What the CURRENT draft was grounded in. Refreshed on every generate; cleared by a seller edit. */
  const [evidence, setEvidence] = useState<DraftEvidenceView[]>([]);
  /** The one sentence above the draft: what the knowledge library could and could not offer. */
  const [knowledgeNote, setKnowledgeNote] = useState<string | null>(null);
  /**
   * Whether THIS generate read the registered 회사 정보 as wording context (Seller Context v1-B). Not
   * stored on the version, so a reload does not claim it; a flag, never the text; never a citation.
   */
  const [companyContextUsed, setCompanyContextUsed] = useState(false);
  /**
   * Whether that sentence is the good-news one.
   *
   * Held as a boolean rather than read off the draft row, because the two places it comes from — a
   * reload and a generate — carry it in different shapes, and a sentence rendered as a caution when
   * it says the question COULD be answered is the defect this replaces.
   */
  const [knowledgeGrounded, setKnowledgeGrounded] = useState(false);
  /**
   * Set when the MACHINERY is why there is no draft — budget spent, capability off, vendor silent,
   * or a 상세페이지 read that failed. Never a statement about the seller's knowledge, and it wins
   * over the no-basis card when both could apply: not having finished looking is not the same as
   * having looked and found nothing.
   */
  const [unavailable, setUnavailable] = useState<string | null>(null);
  /**
   * Why no draft was written, when none was.
   *
   * Held separately from `knowledgeNote` because they answer different questions: the note says what
   * the library could offer, and this says what the seller should do next. A generate that produces
   * nothing must not look like a generate that failed.
   */
  const [answerState, setAnswerState] = useState<AnswerStateView | null>(null);
  /**
   * Set for one render pass after the seller saves an answer basis from this screen.
   *
   * The knowledge round trip used to end in silence: the box closed, a draft was regenerated, and
   * the seller was left asking whether their sentence had been saved at all — especially when the
   * regenerated draft landed on the SAME state, which is the ordinary outcome of adding knowledge
   * that does not happen to cover this question. It says what was saved and what was re-run, and
   * claims nothing about the result: the card underneath is where the result is.
   */
  const [basisSaved, setBasisSaved] = useState(false);
  /** Open only while the seller is choosing a product. Never open by default — it is not a step. */
  const [binding, setBinding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getInquiryDetailStrict(workItemId);
      setDetail(next);
      // Seed the editor from the saved draft when there is one. A seller who saved a draft yesterday
      // must come back to it, not to an empty box that would overwrite it on the next save.
      setReplyTitle(next.draft?.title ?? (next.title ? `[답변] ${next.title}` : ""));
      setReplyComments(next.draft?.comments ?? "");
      setEvidence(next.draftEvidence ?? []);
      setKnowledgeNote(next.draft?.knowledgeNote ?? null);
      setCompanyContextUsed(false);
      setKnowledgeGrounded(next.draft?.knowledgeState === "GROUNDED");
      // The state is READ, never re-derived (Agent Command Center v1 §2). It was computed on the
      // generate and stored on the version, because `knowledgeState` alone cannot tell a grounded
      // answer from a clarification question — both are GROUNDED there. A version written before the
      // column carries null, and null claims nothing: no card, exactly as before.
      setAnswerState(storedAnswerState(next.draft ?? null, next.productId ?? null));
      setBasisSaved(false);
      setUnavailable(null);
    } catch (e) {
      setDetail(null);
      setError(detailErrorMessage(isAxiosError(e) ? e.response?.status : undefined));
    } finally {
      setLoading(false);
    }
  }, [workItemId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Read once per panel. A failure leaves `capability` null, which `canPublishReply` treats as "no"
    // — offering a marketplace write on a guess is the one thing this surface must never do.
    let live = true;
    void api
      .getInquiryPublishCapability()
      .then((c) => {
        if (live) setCapability(c);
      })
      .catch(() => {
        if (live) setCapability(null);
      });
    return () => {
      live = false;
    };
  }, [workItemId]);

  const draft = detail?.draft ?? null;
  const publishable = detail ? canPublishReply(detail, capability) : false;
  const unavailableReason = detail ? publishUnavailableReason(detail, capability) : null;
  const draftDirty = !!draft && (draft.title !== replyTitle || draft.comments !== replyComments);
  const draftEditable = canEditDraft(publishStatus);
  /**
   * Whether a draft can be written at all. OPEN items are proposed on the way (see
   * {@link onGenerateDraft}); anything past PROPOSED is already bound into the reply lifecycle and a
   * new version would be a draft nobody can send.
   */
  const canDraft =
    !!detail
    // Already answered on the channel — a new draft version here would be a reply nobody needs,
    // written for a customer who is no longer waiting.
    && !answeredElsewhere(detail)
    && (canGenerateProposal(detail.phase) || detail.phase === "PROPOSED");

  async function onSaveDraft() {
    if (!detail) return;
    setBusy(true);
    setActionError(null);
    try {
      const saved = await api.saveInquiryReplyDraft(workItemId, {
        title: replyTitle,
        comments: replyComments,
        // The version being edited FROM — `0` for the first save. A stale base is the seller's own
        // draft having moved (another tab, another device), which is a 409 rather than a silent
        // overwrite of whichever version they did not see.
        baseVersion: draft?.version ?? 0,
      });
      setDetail((current) => (current ? { ...current, draft: saved } : current));
      setReplyTitle(saved.title);
      setReplyComments(saved.comments);
      setEditing(false);
      // The seller rewrote it, so it is no longer the model's sentence and no longer stands on the
      // model's evidence. Keeping the citations here would attribute the seller's own words to a
      // knowledge passage that may no longer support them.
      setEvidence([]);
      setKnowledgeNote(null);
      // The sentences are the seller's now. A state card that said "답변에 필요한 정보를 확인했습니다"
      // over text the model never saw would attribute their words to our evidence.
      setAnswerState(null);
      setBasisSaved(false);
      // A saved draft is a NEW version with a new fingerprint, so any confirm block that was open is
      // now about content that no longer exists. Close it rather than let a stale approval be pressed.
      setConfirming(false);
    } catch (e) {
      const info = classifyPublishError(isAxiosError(e) ? e.response?.status : undefined);
      setActionError(info.message);
      if (info.shouldRefresh) await load();
    } finally {
      setBusy(false);
    }
  }

  /**
   * **The one marketplace WRITE in this product.**
   *
   * `commandId` is minted HERE, once per press, so a network timeout followed by a retry cannot
   * become a second reply — the backend treats a repeat of the same id as the same confirm.
   * `expectedFingerprint` is the exact draft version shown above the button; a mismatch is a 409, and
   * the seller is sent back to re-read rather than having an approval applied to content they never saw.
   */
  async function onConfirmPublish() {
    if (!detail || !draft) return;
    setBusy(true);
    setActionError(null);
    try {
      const status = await api.confirmInquiryPublish(workItemId, {
        commandId: crypto.randomUUID(),
        expectedFingerprint: draft.contentFingerprint,
      });
      setPublishStatus(status);
      setConfirming(false);
      setDetail((current) => (current ? { ...current, phase: status.phase } : current));
    } catch (e) {
      const info = classifyPublishError(isAxiosError(e) ? e.response?.status : undefined);
      setActionError(info.message);
      if (info.shouldRefresh) await load();
    } finally {
      setBusy(false);
    }
  }

  /** Verify-only. It re-queries the channel's own status and NEVER resends — that is the whole point. */
  async function onVerifyPublish() {
    setBusy(true);
    setActionError(null);
    try {
      setPublishStatus(await api.verifyInquiryPublish(workItemId));
    } catch (e) {
      setActionError(classifyPublishError(isAxiosError(e) ? e.response?.status : undefined).message);
    } finally {
      setBusy(false);
    }
  }

  /** Resume a bound-but-undelivered publish. Dispatches only from ACTION_PENDING; never resends. */
  async function onResumePublish() {
    setBusy(true);
    setActionError(null);
    try {
      setPublishStatus(await api.resumeInquiryPublish(workItemId));
    } catch (e) {
      setActionError(classifyPublishError(isAxiosError(e) ? e.response?.status : undefined).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Make an AI reply draft.
   *
   * <p>Two calls, in one press. The composer requires a PROPOSED work item — that transition is what
   * freezes the item into the reply lifecycle — so an OPEN item is proposed first. The seller asked
   * for a draft, not for a state machine, and making them press twice for two backend preconditions
   * would be the product leaking its own sequencing.
   */
  async function onGenerateDraft() {
    if (!detail) return;
    setBusy(true);
    setActionError(null);
    setUnavailable(null);
    setBasisSaved(false);
    try {
      let phase = detail.phase;
      if (canGenerateProposal(phase)) {
        const proposed = await api.generateInquiryProposal(workItemId);
        phase = proposed.phase;
        setDetail((current) =>
          current ? { ...current, phase: proposed.phase, proposal: proposed.proposal } : current,
        );
      }
      const generated = await api.generateInquiryDraft(workItemId);
      setEvidence(generated.evidence);
      setKnowledgeNote(generated.knowledgeNote);
      setCompanyContextUsed(generated.companyContextUsed === true);
      setKnowledgeGrounded(generated.knowledgeState === "GROUNDED");
      setUnavailable(generated.unavailableMessage);
      // Which of the three states this generate landed in — computed once and applied whether or not
      // something was written. A draft can exist WITH no answer basis: the company's own pre-approved
      // sentence for 「확인 후 안내드리겠습니다」 (AI 답변 스타일). That is a deferral, not an answer,
      // so the seller must still see what is missing and still be able to add it.
      const state = answerStateOf(generated);
      if (!generated.draft) {
        // Nothing was composed, on purpose. Leave whatever the seller had typed exactly as it is —
        // clearing their box because the AI declined would be the worst of both behaviours — and
        // say which basis is missing so the sentence is actionable rather than an apology.
        setAnswerState(state);
        setEditing(true);
        return;
      }
      setAnswerState(state);
      setUnavailable(null);
      const written = generated.draft;
      setDetail((current) => (current ? { ...current, draft: written, phase } : current));
      setReplyTitle(written.title);
      setReplyComments(written.comments);
      setEditing(false);
      // A new version has a new fingerprint, so an open confirm is about content that no longer
      // exists. Close it rather than let a stale approval be pressed.
      setConfirming(false);
    } catch (e) {
      const info = classifyProposeError(isAxiosError(e) ? e.response?.status : undefined);
      setActionError(info.message);
      if (info.shouldRefresh) await load();
    } finally {
      setBusy(false);
    }
  }

  /**
   * The seller wrote the missing answer basis, here, and the screen re-asks with it.
   *
   * Saving is not answering, so this says only what it did. Whether the new sentence covers THIS
   * question is the regenerated state card's answer, and it is perfectly ordinary for it to still be
   * 「답변 기준이 필요합니다」 — knowledge that does not apply is not a failure to save.
   */
  async function onBasisSaved() {
    await onGenerateDraft();
    setBasisSaved(true);
  }

  /**
   * Copy the SAVED draft, never the editor buffer.
   *
   * The screen already told the seller to 「아래 초안을 복사해 판매자센터에서 등록해 주세요」 while
   * offering no way to do it (Demo UX Polish v1) — an instruction pointing at a control that was not
   * there. What it copies is `detail.draft`, the version the server holds, and the button is not
   * offered while the editor is open or dirty: the text on screen would then be one the seller has
   * not saved, and pasting an unsaved keystroke into a public reply is the exact failure the reply
   * lifecycle is built to prevent.
   */
  async function onCopyDraft() {
    if (!draft || draftDirty || editing) {
      return;
    }
    const text = [draft.title, draft.comments].filter(Boolean).join("\n\n");
    setActionError(null);
    const result = await copyText(text);
    if (result.ok) {
      setCopied(true);
      setManualCopy(null);
      return;
    }
    setCopied(false);
    if (result.reason === "UNAVAILABLE") {
      setManualCopy(text);
      return;
    }
    setActionError("복사하지 못했습니다. 다시 시도해 주세요.");
  }

  if (loading) {
    return <p className="text-base text-muted">문의 내용을 불러오는 중…</p>;
  }

  // Fail closed. Without the detail there is nothing honest to offer, so the panel says so and
  // offers no controls rather than presenting an empty workflow.
  if (error || !detail) {
    return <p className="text-base text-muted">{error ?? "문의 내용을 불러오지 못했습니다."}</p>;
  }

  return (
    <div className="space-y-4">
      {/*
        1 — THE CUSTOMER'S QUESTION. First, largest, and never competing with a control.

        The label steps DOWN and the question steps UP (Executive-friendly UX Redesign v1). 「고객
        문의」 used to be the bold 17px line and the customer's actual sentence was set at body size
        under it, so the largest words on the most important screen in the product were the ones the
        seller already knew.
      */}
      <section>
        {/* The 「고객 문의」 label is gone (Executive Readiness Fix v1). It cost a line at the very top
            of the pane to name something the reader had just clicked out of a list titled 문의, and
            the block below is unambiguous once the answer beneath it is labelled 「AI가 준비한 답변」.
            The section keeps its accessible name. */}
        <h3 className="sr-only">고객 문의</h3>
        {detail.title ? (
          <p className="break-keep text-lg font-bold leading-snug text-ink">
            {plainText(detail.title)}
          </p>
        ) : null}
        <p className="mt-2 whitespace-pre-wrap break-keep text-lg leading-relaxed text-ink">
          {plainText(detail.details) || "본문이 없습니다."}
        </p>
        <InquiryMeta
          detail={detail}
          onBind={canBindProduct(detail) ? () => setBinding(true) : undefined}
        />
        {binding ? (
          <InquiryProductBinder
            detail={detail}
            onCancel={() => setBinding(false)}
            onBound={(productId, productName) => {
              setBinding(false);
              // The bound product is what the next draft will be grounded in, so the panel must show
              // it immediately — a seller who binds and then presses "AI 답변 초안 만들기" is entitled
              // to see which product they are about to lean on.
              setDetail((current) =>
                current
                  ? { ...current, productId, productName, productBinding: "USER_CONFIRMED" }
                  : current,
              );
            }}
          />
        ) : null}
        <OperationalContext context={detail.orderContext} />
      </section>

      {/* 2 — THE ANSWER. One section, whatever state it is in. */}
      <section className="rounded-xl border border-line bg-canvas p-4">
        <h3 className="text-sm font-semibold text-muted">AI가 준비한 답변</h3>

        {/*
          Three states, not two. There was no draft and there was a draft; a generate that
          DECLINED to write one is a third, and folding it into the first would put the seller back
          in front of the same button with no answer to what they just pressed.
        */}
        {!draft && !answerState && !unavailable ? (
          <>
            <p className="mt-1.5 break-keep text-sm leading-relaxed text-muted">
              문의 내용과 등록된 상품 지식을 근거로 초안을 씁니다. 보내는 것은 확인 후 따로 누릅니다.
            </p>
            <div className="mt-4">
              <Btn onClick={onGenerateDraft} disabled={busy || !canDraft}>
                {busy ? "쓰는 중…" : "AI 답변 초안 만들기"}
              </Btn>
            </div>
            {!canDraft ? (
              <p className="mt-3 break-keep text-sm text-muted">
                지금 상태에서는 초안을 만들 수 없습니다. 목록에서 상태를 확인해 주세요.
              </p>
            ) : null}
          </>
        ) : (
          <>
            {/*
              2 — WHAT THE AI DECIDED, before the text it decided it about.

              The three states are the point of this screen (Core Daily Loop UX Integration v1 §5).
              Until 2026-08-27 only one of them had a card: GROUNDED was rendered as the same orange
              caution strip a failure got, and NEEDS_CLARIFICATION — where the draft is a question
              back to the customer — appeared nowhere, so a seller read a polite request for the
              규격 as an answer that had come out short.
            */}
            <AnswerStateCard
              state={answerState}
              justSaved={basisSaved}
              onSavedBasis={onBasisSaved}
            />

            {/*
              What the library could and could not offer — and ONLY when the card above is absent.

              Three reasons it is not repeated under the card (§11). On GROUNDED and
              NEEDS_CLARIFICATION it says the same thing the card just said. On NO_ANSWER_BASIS its
              longer form — 「아래 과거 답변은 참고용이며」 — points at citations that are not on this
              screen: a state with no answer basis records no evidence rows, so there is no 아래 to
              look at. What survives is the reload case, where nothing computed a state this session
              and the stored sentence is the only thing that can speak.
            */}
            {knowledgeNote && !answerState ? (
              <p
                className={`mt-2 break-keep rounded-lg border-l-4 px-3 py-2 text-base leading-relaxed text-ink ${
                  knowledgeGrounded ? "border-line bg-canvas" : "border-warn/50 bg-warn/5"
                }`}
              >
                {knowledgeNote}
              </p>
            ) : null}
            {/*
              THE MACHINERY DID NOT RUN — a different card from the one above, on purpose.

              「답변 기준이 필요합니다」 sends the seller off to write product knowledge. A vendor
              timeout on a fully grounded question sent them there too, until 2026-08-27, and the
              knowledge they were told to add already existed. This card says what did not run and
              leaves their library alone.
            */}
            {unavailable ? (
              <div className="mt-3 rounded-xl border border-warn/40 bg-warn/5 p-4">
                <p className="break-keep text-lg font-semibold leading-relaxed text-ink">
                  {unavailable}
                </p>
                <p className="mt-2 break-keep text-sm leading-relaxed text-muted">
                  아래에 직접 작성하실 수 있습니다.
                </p>
              </div>
            ) : null}

            {editing || !draft ? (
              <div className="mt-4">
                <label className="block text-sm font-medium text-ink" htmlFor="reply-title">
                  제목
                </label>
                <input
                  id="reply-title"
                  className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-ink"
                  value={replyTitle}
                  onChange={(e) => setReplyTitle(e.target.value)}
                  disabled={busy}
                />
                <label className="mt-3 block text-sm font-medium text-ink" htmlFor="reply-comments">
                  내용
                </label>
                <textarea
                  id="reply-comments"
                  className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-ink"
                  rows={6}
                  value={replyComments}
                  onChange={(e) => setReplyComments(e.target.value)}
                  disabled={busy}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Btn size="sm" onClick={onSaveDraft} disabled={busy || !replyComments.trim()}>
                    {busy ? "저장 중…" : "초안 저장"}
                  </Btn>
                  {draft ? (
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(false);
                        setReplyTitle(draft.title);
                        setReplyComments(draft.comments);
                      }}
                      disabled={busy}
                    >
                      취소
                    </Btn>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-line bg-surface p-4">
                {/*
                  THE COPY BUTTON SITS WITH THE TEXT IT COPIES (Executive Readiness Fix v1).

                  It used to be below the draft, after the evidence fold — measured at y=901 with the
                  fold at 900, and 181px below it at 125% zoom. Pinning it to the bottom of the pane
                  was tried and was worse: a 199px bar covered the draft and the gap note it was
                  supposed to accompany. A block's own copy control belongs in the block's header,
                  where it is visible exactly when the thing it copies is, at any zoom and for any
                  length of question.

                  Only when copying IS the action. Where SellerOps can register the answer itself,
                  「답변 보내기」 is the primary and it stays below with its confirm step — the one
                  irreversible control in the product does not move next to the text it would send.
                */}
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-keep font-semibold text-ink">{draft.title}</p>
                  {!publishable && !draftDirty ? (
                    /*
                      THE GUARANTEE TRAVELS WITH THE BUTTON (Executive Readiness Fix v1).

                      「이 환경에서는 SellerOps가 답변을 대신 등록하지 않습니다」 lives at the bottom of
                      the section, and at 125% zoom it is the FIRST thing to leave the screen — so a
                      reader enlarging the type, which is exactly what a 50-year-old operator does,
                      was left pressing a button on a customer's inquiry with no visible promise about
                      where the text goes. A reader called that a trust accident, not a crop. The full
                      sentence still stands below; this is the short form, attached to the control.

                      Only where copying is all that happens. On a channel SellerOps can post to, this
                      would be a false promise, and 「답변 보내기」 owns that path with its own confirm.
                    */
                    <div className="shrink-0 text-right">
                      <Btn onClick={onCopyDraft} disabled={busy}>
                        {copied ? "복사했습니다" : "초안 복사"}
                      </Btn>
                      <p className="mt-1 break-keep text-sm text-good">고객에게 나가지 않습니다</p>
                    </div>
                  ) : null}
                </div>
                <p className="mt-1.5 whitespace-pre-wrap break-keep text-lg leading-relaxed text-ink">
                  {draft.comments}
                </p>
                <DraftEvidence evidence={evidence} />
                {companyContextUsed ? (
                  <p className="mt-2 break-keep text-sm text-muted" aria-label="회사 정보 참고">
                    회사 정보를 참고해 표현했습니다. 배송·환불·규격 같은 사실의 근거는 아닙니다.
                  </p>
                ) : null}
              </div>
            )}

            {/*
              The send, or the honest reason there is none. `publishUnavailableReason` names WHICH of
              the three conditions failed, because "이 채널은 판매자센터에서 직접" and "이 환경에서는
              대신 등록하지 않습니다" are different things for the seller to do about it.
            */}
            {publishStatus ? null : (
              <div className="mt-5 border-t border-line pt-4">
                {/*
                  Said BEFORE the press, not recorded after it. On a channel whose collection is stale
                  SellerOps cannot prove this inquiry is still unanswered, and the person who accepts
                  that risk has to be the person who was told about it.
                */}
                {publishable && detail.answerStateNote ? (
                  <p className="mb-3 break-keep text-sm leading-relaxed text-warn">
                    {detail.answerStateNote}
                  </p>
                ) : null}

                {!confirming || !draft ? (
                  /*
                    ONE PRIMARY, THEN THE REST (Executive-friendly UX Redesign v1).

                    These four controls used to sit in one wrapping row at the same small size, so
                    「답변 보내기」 — the only irreversible action in the product — and 「다시 작성」
                    were the same object to a reader scanning it. The action the seller came here to
                    take is now alone on its line at full size; 수정 and 다시 작성 are text under it.

                    Which control IS the primary still depends on the channel, not on this component's
                    preference: where SellerOps cannot register the answer itself, copying is the
                    action and it takes the emphasis 답변 보내기 would have had.
                  */
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {publishable && !draftDirty && !editing ? (
                        <Btn onClick={() => setConfirming(true)} disabled={busy}>
                          답변 보내기
                        </Btn>
                      ) : null}
                      {/* Not repeated here when it is the primary — it is in the draft's own header. */}
                      {publishable && draft && !editing && !draftDirty ? (
                        <Btn size="sm" variant="outline" onClick={onCopyDraft} disabled={busy}>
                          {copied ? "복사했습니다" : "초안 복사"}
                        </Btn>
                      ) : null}
                    </div>
                    {!editing && draftEditable ? (
                      <div className="flex flex-wrap items-center gap-1">
                        <Btn size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={busy}>
                          수정
                        </Btn>
                        {/* 다시 작성 is gated on the SAME condition as the first generate. It was not,
                            so an inquiry already answered on the channel — and any item past PROPOSED,
                            which the composer refuses — still offered the button, and pressing it
                            produced an error where the seller had been promised a draft. 수정 stays:
                            their own text is theirs to change whatever the channel did. */}
                        {canDraft ? (
                          <Btn size="sm" variant="ghost" onClick={onGenerateDraft} disabled={busy}>
                            다시 작성
                          </Btn>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  /*
                    The second press. Everything that is about to happen is restated here — where it
                    goes, which saved version, and that it cannot be taken back — because this is the
                    only control in SellerOps that writes to a marketplace, and a seller should never
                    discover afterwards which text was sent.
                  */
                  <div
                    className="rounded-xl border border-line bg-surface p-4"
                    role="group"
                    aria-label="답변 등록 확인"
                  >
                    <p className="break-keep text-sm font-semibold text-ink">
                      {detail.channelNameKo ?? "채널"}에 아래 내용을 등록합니다. 등록 후에는 취소할 수
                      없습니다.
                    </p>
                    <p className="mt-2 text-sm text-muted">저장된 버전 {draft.version}</p>
                    <p className="mt-2 whitespace-pre-wrap break-keep rounded-lg bg-canvas p-3 text-sm leading-relaxed text-ink">
                      {draft.comments}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Btn size="sm" onClick={onConfirmPublish} disabled={busy}>
                        {busy ? "등록 중…" : "확인, 등록합니다"}
                      </Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                        취소
                      </Btn>
                    </div>
                  </div>
                )}

                {manualCopy !== null ? (
                  <div className="mt-3">
                    <p className="break-keep text-sm leading-relaxed text-muted">
                      이 주소에서는 자동 복사를 쓸 수 없습니다. 아래 내용을 직접 복사해 주세요.
                    </p>
                    <textarea
                      readOnly
                      aria-label="복사할 초안"
                      className="mt-2 w-full rounded-xl border border-line bg-canvas p-3 text-sm text-ink"
                      rows={5}
                      value={manualCopy}
                    />
                  </div>
                ) : null}

                {!publishable ? (
                  /* The sentence that tells the seller what finishing this looks like. It was the
                     smallest text on the screen while being the only instruction on it. */
                  <p className="mt-3 break-keep text-base leading-relaxed text-muted">
                    {unavailableReason}
                  </p>
                ) : draftDirty ? (
                  // A dirty editor means the fingerprint on screen is not the one that would be sent.
                  // Said while the editor is open too — that is when the seller can act on it.
                  <p className="mt-3 text-sm text-muted">
                    편집한 내용을 먼저 저장해 주세요. 저장된 버전만 등록할 수 있습니다.
                  </p>
                ) : null}
              </div>
            )}

            {publishStatus ? (
              <div className="mt-5 rounded-xl border border-line bg-surface p-4">
                <p className="break-keep text-sm text-ink">{publishCategoryLabel(publishStatus.category)}</p>
                {publishStatus.approvedDraftVersion !== null ? (
                  <p className="mt-1 text-sm text-muted">등록한 버전 {publishStatus.approvedDraftVersion}</p>
                ) : null}
                {publishStatus.presendStateProven === false ? (
                  <p className="mt-1 break-keep text-sm text-muted">
                    보낼 당시 이 채널의 문의 수집이 최신이 아니었습니다.
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {canVerifyPublish(publishStatus) ? (
                    <Btn size="sm" variant="ghost" onClick={onVerifyPublish} disabled={busy}>
                      상태 다시 확인
                    </Btn>
                  ) : null}
                  {canResumePublish(publishStatus) ? (
                    <Btn size="sm" variant="ghost" onClick={onResumePublish} disabled={busy}>
                      이어서 등록
                    </Btn>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}

        {actionError ? <p className="mt-3 text-sm text-bad">{actionError}</p> : null}
      </section>
    </div>
  );
}

/**
 * <b>What the AI decided about this question</b> — one card, three shapes.
 *
 * <p>Position 2 of the five the seller reads (Core Daily Loop UX Integration v1 §4): the customer's
 * question, then this, then the evidence and the draft, then the one thing to press. It is rendered
 * ONLY for a generate that happened in this session — a reload cannot tell a clarification draft
 * from a grounded one, and guessing would be the kind of confident wrong label this screen exists to
 * avoid.
 *
 * <p><b>GROUNDED is the only good-news shape.</b> NEEDS_CLARIFICATION is a real and correct reply,
 * and it still wants the seller's eye before it goes out: the customer is about to be asked a
 * question rather than answered, and a seller who skims past that sends a question they could have
 * answered themselves. NO_ANSWER_BASIS keeps the way out that was added to it — the box that writes
 * the missing sentence without leaving this screen.
 *
 * <p>The sentences are the backend's, in every shape. This component chooses the border, the order,
 * and which controls belong under which state.
 */
/**
 * The state a SAVED version was written in, or null when the row does not record one.
 *
 * <b>Read, not re-derived.</b> Re-running the projection on a reload would need the customer's
 * message and the 규격 verdict, neither of which the row holds; guessing GROUNDED for a draft that
 * was a question is precisely the confident wrong answer this card exists to prevent. A version from
 * before the column simply produces no card — the same screen the seller saw yesterday.
 *
 * The product id comes from the DETAIL, not from the draft: a saved version records which product
 * the retrieval was scoped to, but the errand to add knowledge belongs to the product this inquiry
 * is bound to now.
 */
function storedAnswerState(
  draft: ReplyDraftView | null,
  productId: string | null,
): AnswerStateView | null {
  if (!draft?.answerBasis || !draft.answerBasisNote) return null;
  return {
    basis: draft.answerBasis,
    note: draft.answerBasisNote,
    action: draft.answerBasisAction,
    productId,
  };
}

function AnswerStateCard({
  state,
  justSaved,
  onSavedBasis,
}: {
  state: AnswerStateView | null;
  justSaved: boolean;
  onSavedBasis: () => void | Promise<void>;
}) {
  if (!state) return null;
  const good = answerStateIsGood(state.basis);
  const noBasis = state.basis === "NO_ANSWER_BASIS";
  return (
    <div
      data-testid="answer-state"
      data-basis={state.basis}
      className={`mt-3 rounded-xl border p-4 ${
        good ? "border-good/40 bg-good/5" : "border-warn/40 bg-warn/5"
      }`}
    >
      {/* Said once, at the top, and only on the pass right after a save. It reports the two things
          that happened and neither more nor less — the state below is the result. */}
      {justSaved ? (
        <p className="mb-2 break-keep text-sm font-medium leading-relaxed text-good">
          답변 기준을 저장했습니다. 저장한 내용으로 답변을 다시 만들었습니다.
        </p>
      ) : null}
      <p className="break-keep text-lg font-semibold leading-relaxed text-ink">{state.note}</p>
      {state.action ? (
        <p className="mt-1.5 break-keep text-base leading-relaxed text-ink">{state.action}</p>
      ) : null}
      {noBasis ? (
        <p className="mt-2 break-keep text-sm leading-relaxed text-muted">
          근거가 없는 답변은 만들지 않습니다. 아래에 직접 작성하실 수 있습니다.
        </p>
      ) : null}
      {/*
        THE WAY OUT, on the screen that named the gap.

        Saying what is missing and offering nothing to do about it is where this state stopped until
        2026-08-27: the seller read 「답변 기준이 필요합니다」, and the next identical question read it
        again. It appears only with a product to attach the sentence to — with none, the line above
        already says that binding a product is the first thing to fix, and a knowledge box with
        nowhere to save would be worse than no box.
      */}
      {noBasis && state.productId ? (
        <AnswerBasisQuickAdd productId={state.productId} onSaved={onSavedBasis} />
      ) : null}
      {/*
        Where the sentence they just wrote now lives (§12). Offered after a save rather than always:
        it is the answer to "그래서 어디에 저장된 거지", and on a grounded draft nobody asked.
      */}
      {justSaved && state.productId ? (
        <p className="mt-3">
          <Link
            className="rounded text-sm font-medium text-brand-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
            to={`/products/${state.productId}`}
          >
            이 상품에 등록된 답변 기준 보기
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Channel · 상품 · 상태 · 경과 — one line, in the order a seller triages by.
 *
 * The response-TYPE suggestion sits here rather than in a section of its own: it is a hint about how
 * to answer, and it was never why the seller opened this item. 상품 is stated as an absence when there
 * is none, because "(미지정 상품)" is the reason a draft could not be grounded and hiding it would
 * make the limitation above the draft look arbitrary.
 */
/**
 * 운영 정보 — the state of the order this inquiry names.
 *
 * <p><b>It renders nothing when the inquiry names no order</b>, which is most of them. An empty card
 * with three "확인되지 않음" rows would read as "we looked up the order and it has no state", and the
 * seller would learn to distrust the card everywhere else.
 *
 * <p>Three rows rather than one status line, because payment does not imply dispatch — and each row
 * says "확인되지 않음" on its own rather than borrowing certainty from the row above it.
 */
function OperationalContext({ context }: { context: OrderContextView | null }) {
  if (!context || !context.present) return null;
  return (
    <div className="mt-4 rounded-lg border border-line bg-canvas px-3.5 py-3">
      <p className="text-sm font-semibold text-ink">운영 정보</p>
      {context.summaryKo ? (
        <p className="mt-1.5 break-keep text-sm leading-relaxed text-ink">{context.summaryKo}</p>
      ) : null}
      <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">결제</dt>
        <dd className="text-ink">{context.paymentKo}</dd>
        <dt className="text-muted">배송</dt>
        <dd className="text-ink">{context.fulfillmentKo}</dd>
        <dt className="text-muted">취소</dt>
        <dd className="text-ink">{context.cancellationKo}</dd>
      </dl>
      {context.observedKo ? (
        <p className="mt-2 text-sm text-muted">{context.observedKo}</p>
      ) : null}
    </div>
  );
}

function InquiryMeta({
  detail,
  onBind,
}: {
  detail: InquiryDetail;
  onBind?: () => void;
}) {
  const waited = waitedLabel(detail.receivedAt);
  const provenance = bindingLabel(detail);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
      {detail.channelNameKo ? <span>{detail.channelNameKo}</span> : null}
      {/* 「상품 미지정」 STAYS (Executive-friendly UX Redesign v1 — considered and rejected). Hiding
          the absence and offering only the control that fixes it reads cleaner and is less honest:
          the missing product is WHY a draft could not be grounded, and the gap line that explains
          that in full does not exist until a draft has been generated. */}
      <span aria-hidden="true">·</span>
      <span>{productLabel(detail)}</span>
      {provenance ? <span className="text-muted">({provenance})</span> : null}
      {onBind ? (
        <button
          type="button"
          className="rounded px-1 text-sm font-medium text-brand-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
          onClick={onBind}
        >
          {detail.productId ? "상품 바꾸기" : "상품 지정"}
        </button>
      ) : null}
      {waited ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{waited}</span>
        </>
      ) : null}
      {/* The workflow phase and the proposal's own category used to sit here too, so this one line
          read 「카페24 자사몰 · 상품 미지정 · 상품 지정 · 제안 생성됨 · 1시간째 · 일반 응답」. Neither told
          the seller anything they could act on: what state the work is in is what the 답변 block
          below RENDERS, and 「일반 응답」 is the classifier talking to itself. `phaseLabel` also
          passes unmapped phases through verbatim, so a completed item put a raw APPROVED /
          COMPLETED on screen — removing its only render site removes that leak (Demo UX Polish v1). */}
    </div>
  );
}

/**
 * What the draft was grounded in.
 *
 * Titles and provenance, never the passage text: the reply above already says the thing, and a
 * citation is a pointer back to the seller's own words so the claim can be checked. An empty list
 * renders nothing at all — an empty "근거" heading would read as a failure rather than as a draft
 * that never claimed grounding (the sentence above it already said which).
 */
function DraftEvidence({ evidence }: { evidence: DraftEvidenceView[] }) {
  if (evidence.length === 0) return null;
  // Grouped by where it came from, in the order the retrieval returned it. A seller who disagrees
  // with the reply needs to know WHICH thing to go and fix — a wrong spec is fixed in 상품 지식, a
  // wrong shipping promise in 운영 정책, and neither fix reaches the other.
  const groups: Array<{ label: string; items: DraftEvidenceView[] }> = [];
  for (const item of evidence) {
    const label = item.scopeLabel ?? item.kind;
    const last = groups.length > 0 ? groups[groups.length - 1] : undefined;
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  const [lead, ...rest] = evidence;
  const leadLabel = lead.scopeLabel ?? lead.kind;
  // 「상품 정보 2개 · 과거 답변 1개」 — the summary the fold is decided from.
  const summary = groups.map((group) => `${group.label} ${group.items.length}개`).join(" · ");
  return (
    /*
      THE FIRST CITATION IS OPEN; THE REST FOLD (2026-08-26).

      Executive-friendly UX Redesign v1 closed this list entirely, on the reasoning that a seller
      needs to know HOW MANY sources an answer stands on and can open it to see which. The NAVER live
      case showed what that costs. The reply answered 「전선이 몇 가닥까지 들어가나요?」 and the one
      citation read 「AI가 확인한 내용 · 상품 정보 1개」 — closed. Behind it was a source titled
      「자주 묻는 질문 - 접착과 재부착」, whose text contained that exact question and its answer. Neither
      the count nor the title could tell the seller whether the draft had any basis, and checking cost
      a click they had no reason to spend.

      So a grounded draft shows its lead citation in full — kind, title, excerpt — and everything
      after it folds. Opening all of them would be the other failure: four passages of quoted
      knowledge under every draft is noise, and the excerpt is the thing worth one card, not four.

      The locator stays off the screen entirely: it identified a chunk, and no seller acts on a
      chunk id.
    */
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-sm font-medium text-muted">AI가 확인한 내용</p>
      <div className="mt-1.5 rounded-lg bg-canvas px-3 py-2.5">
        <p className="text-sm text-muted">{leadLabel}</p>
        <p className="mt-0.5 break-keep font-medium text-ink">{lead.title ?? leadLabel}</p>
        {lead.snippet ? (
          <p className="mt-1 break-keep text-sm leading-relaxed text-ink">{lead.snippet}</p>
        ) : null}
      </div>
      {rest.length > 0 ? (
        <Disclosure className="mt-2" label={`나머지 근거 ${rest.length}개 · ${summary}`}>
          <div className="mt-2 space-y-2">
            {rest.map((item, index) => (
              <div
                key={`${item.chunkId ?? item.sourceId ?? "evidence"}-${index}`}
                className="rounded-lg bg-canvas px-3 py-2.5"
              >
                <p className="text-sm text-muted">{item.scopeLabel ?? item.kind}</p>
                <p className="mt-0.5 break-keep font-medium text-ink">
                  {item.title ?? item.scopeLabel ?? item.kind}
                </p>
                {item.snippet ? (
                  <p className="mt-1 break-keep text-sm leading-relaxed text-ink">{item.snippet}</p>
                ) : null}
              </div>
            ))}
          </div>
        </Disclosure>
      ) : null}
    </div>
  );
}
