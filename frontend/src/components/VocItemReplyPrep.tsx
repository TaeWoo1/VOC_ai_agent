import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "../lib/apiClient";
import { copyText } from "../lib/clipboard";
import { SecureRandomUnavailableError, newCommandId } from "../lib/commandId";
import type { OperatorOutcomeName, ReviewReplyPrep, TriageDisposition } from "../lib/types";
import {
  startReplySubmission,
  type ReplyRunHandle,
  type ReplyRuntime,
} from "../lib/actionWindow/reply/replyRuntime";
import { useReplyRuntime } from "../lib/actionWindow/reply/useReplyRuntime";

// NO module-level runtime. The hook resolves null in any shipped build without a bridge, and that
// null is the point: before it, this panel fell back to the SIMULATED runtime everywhere, minting a
// `run_<hex>` locally and persisting it as an Action Window run that never happened.

// Prepare a reply to one review: read the redacted body, start from a rule-based
// suggestion, edit, approve (which freezes it), copy.
//
// It stops at the clipboard. There is no send here and no marketplace call behind any of
// it — the operator pastes the text into the seller center themselves, and the copy says
// so. No control on this panel may read as 발송/전송/등록 (Frontend Spec §10.2).
//
// Every affordance is rendered from the SERVER's `capabilities`, never re-derived here.
// The rule depends on the disposition AND whether a draft exists AND whether an approval
// stands; a second copy of it in the client is how the two surfaces drift into disagreeing
// about what is allowed.

/** One approval intent: the state asked for, and the command id identifying it. */
interface ApprovalAttempt {
  state: "APPROVED" | "WITHDRAWN";
  commandId: string;
}

/** What the panel is currently doing, so only one write is ever in flight. */
type Busy = null | "saving" | "approving" | "withdrawing" | "starting" | "reporting";

/** One guided reply-submission run: the single-use binding + the live run handle it reports through. */
interface GuidedRun {
  submissionRef: string;
  /**
   * The live run this report will terminate through, or null for a MANUAL handoff.
   *
   * <p>Null is not a missing handle — it says no Action Window run exists, so the outcome is the
   * operator's own report and no run ref is recorded. It is the difference between "SellerOps
   * watched a run end" and "the seller told us what they did".
   */
  handle: ReplyRunHandle | null;
}
/** One outcome-report intent: what was reported, and the command id identifying it. */
interface OutcomeAttempt {
  outcome: OperatorOutcomeName;
  commandId: string;
}

export function VocItemReplyPrep({
  accountId,
  actionRef,
  disposition,
  onPrepared,
  onOutcomeRecorded,
  onLocalWork,
  replyRuntime,
}: {
  accountId: string;
  actionRef: string;
  /**
   * The reply-submission runtime the guided flow drives, when this build HAS one.
   *
   * <p>Injected so tests can pass a stub — an injected runtime is owned (and disposed) by whoever
   * created it, never by this panel. Otherwise {@code useReplyRuntime} owns it: the live bridge
   * runtime in DEV bridge mode (released, socket and all, on unmount), the simulated one in plain
   * DEV, and null in production. When it is null the panel offers a MANUAL handoff instead of a
   * guided one — different copy, and no run ref recorded — rather than silently simulating a run.
   *
   * <p>When a runtime does exist it remains the SOLE source of the recorded outcome + runId; the FE
   * never fabricates either.
   */
  replyRuntime?: ReplyRuntime;
  /**
   * The row's LIVE triage decision — a conservative gate, never a re-read trigger.
   *
   * This panel reads once and after its own writes; it deliberately does NOT re-read because
   * a sibling control moved the decision. So the `capabilities` in hand were computed under
   * whatever disposition held at read time, and every forward one — canSave, canApprove,
   * canCopy — has `responseNeeded` as a factor. Once the operator moves the review to
   * 지켜보기, those three are stale-TRUE, and acting on them means: a 초안 저장 whose every
   * retry is a byte-identical 409, and a 복사 the server would refuse but cannot, because the
   * approved body is already in this component's memory.
   *
   * So the disposition is AND-ed back in below. That re-states ONE clause of the server's
   * rule, and the direction is what makes it safe: the client can only ever refuse what the
   * server would allow, never allow what the server refuses. A conservative refinement cannot
   * drift into permissiveness — the failure mode of duplicating a rule — and it costs no
   * request, which is the constraint this design is under.
   */
  disposition: TriageDisposition | null;
  /**
   * Announced once a draft has been saved — i.e. once this review carries work the operator
   * must not lose.
   *
   * The row owns whether this panel exists, and its `hasReplyPreparation` came from the list
   * read, which predates any draft written in this session. Without this the operator could
   * save a draft, change their mind to 지켜보기, and watch the panel — and their draft —
   * disappear, reachable again only by re-triaging or reopening the drill-down.
   *
   * Fired after a confirmed save, not optimistically: the row would otherwise pin itself
   * open for work the server never accepted.
   */
  onPrepared?: () => void;
  /**
   * Fired once a SUBMITTED outcome has been RECORDED by the server — the moment the worklist above
   * stops counting this review and the row earns its 답변함으로 기록 badge.
   *
   * <p>Without it the rule is real and invisible: the count and the row are snapshots taken when the
   * page loaded, so a seller who works through their queue watches the number sit still and only
   * discovers the truth by reloading. Fired AFTER the server call, never on the operator's click —
   * announcing work the backend has not recorded would make the queue lie in the other direction.
   *
   * <p>Not fired for an abort: "I did not post it" changes nothing about the queue.
   */
  onOutcomeRecorded?: () => void;
  /**
   * Whether this panel currently holds work that only exists here — an unsaved edit, or a
   * write in flight.
   *
   * The row unmounts this panel when the decision leaves 대응 필요 and no server-side work
   * exists, which is right for an untouched panel and destructive for a typed-in one: the
   * buffer lives nowhere else, so a sibling click would silently take a written reply with
   * no confirm and no undo. `dirty` already exists to stop a server re-read from discarding
   * that text; this stops a sibling from doing the same thing.
   *
   * It also covers a write in flight: unmounting mid-save drops the failure handler, so a
   * save that then fails is never reported and the operator is left believing it landed.
   */
  onLocalWork?: (hasLocalWork: boolean) => void;
}) {
  const [prep, setPrep] = useState<ReviewReplyPrep | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [copied, setCopied] = useState(false);
  // The approved text, revealed for manual copying when this origin has no clipboard API.
  // Holds `approvedBody` and nothing else — never the editor buffer.
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const [body, setBody] = useState("");
  // True once the operator has touched the editor, so a reload does not silently discard
  // their typing by re-seeding from the server.
  const [dirty, setDirty] = useState(false);
  // A guided reply-submission run in progress (after 네이버에서 직접 답변하기, before the operator
  // reports). Local and re-enterable: the ref is single-use, so backing out just re-mints on reopen.
  const [guided, setGuided] = useState<GuidedRun | null>(null);

  const attempt = useRef<ApprovalAttempt | null>(null);
  const reportAttempt = useRef<OutcomeAttempt | null>(null);
  const inFlight = useRef(false);

  // Announced, not inferred: the row cannot see a buffer that lives in this component.
  const hasLocalWork = dirty || busy != null;
  useEffect(() => {
    onLocalWork?.(hasLocalWork);
  }, [hasLocalWork, onLocalWork]);
  // Owned by the hook: injected (tests, untouched) > live bridge runtime (DEV, disposed with its
  // socket on unmount) > simulated (DEV) > null. Null in every shipped build without a bridge:
  // this build cannot guide, and the panel says so rather than simulating a run nobody ran.
  const runtime = useReplyRuntime(replyRuntime);
  const canGuide = runtime != null;

  const headingId = useId();
  const editorId = useId();

  const load = useCallback(async () => {
    try {
      const next = await api.getReviewReplyPrep(accountId, actionRef);
      setPrep(next);
      setLoadFailed(false);
      return next;
    } catch {
      setLoadFailed(true);
      return null;
    }
  }, [accountId, actionRef]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const next = await load();
      if (!active || next == null) {
        return;
      }
      // Seed the editor once: the saved draft if there is one, else the suggestion. Never
      // over an edit in progress — see `dirty`.
      setBody((current) => (current === "" ? (next.draft?.body ?? next.suggestion.body) : current));
    })();
    return () => {
      active = false;
    };
  }, [load]);

  if (loadFailed) {
    return (
      <p role="alert" className="text-sm text-bad">
        답변 준비 정보를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.
      </p>
    );
  }
  if (prep == null) {
    return (
      <p aria-live="polite" className="text-sm text-muted">
        불러오는 중…
      </p>
    );
  }

  const { capabilities, approval, draft } = prep;
  const approved = approval?.state === "APPROVED";
  const baseVersion = draft?.version ?? 0;
  const working = busy != null;

  // Every forward capability, refined by the LIVE decision — see the `disposition` prop.
  // Withdrawal is deliberately absent: `canWithdraw` is `approved` alone, so the decision
  // moving cannot stale it, and gating the one operation that reduces commitment is how a
  // review gets stranded in APPROVED.
  const responseNeeded = disposition === "RESPONSE_NEEDED";
  const canSave = capabilities.canSave && responseNeeded;
  const canCopy = capabilities.canCopy && responseNeeded;
  // The guided post is the copy step performed in the seller center, so it carries the same
  // conservative refinement as copy. It authorizes no send — the operator posts the reply themselves.
  const canStart = capabilities.canStartSubmissionRun && responseNeeded;
  // The channel already has a reply on this review. The server has already withheld
  // `canStartSubmissionRun` and would 409 the call anyway; this only lets the panel SAY why, instead
  // of hiding the control with no reason. Copy stays available — the clipboard is the operator's.
  const channelAnswered = prep.channelReplyState === "ANSWERED";

  /**
   * Approving binds the last SAVED version — never what is in the box.
   *
   * So an unsaved edit must block it. Otherwise the operator types a correction, clicks
   * 승인, is told it is approved, copies, and pastes the text they just replaced: the
   * approval bound `draft.version`, which their typing never reached. That is the same
   * failure the approved-head copy rule exists to prevent, arriving through the client
   * instead of the wire, and the server cannot see it — only this side knows the buffer
   * diverged. The fix is to refuse rather than to guess which text they meant.
   */
  const approvable = capabilities.canApprove && responseNeeded && !dirty;

  async function refresh() {
    const next = await load();
    if (next != null && !dirty) {
      setBody(next.draft?.body ?? next.suggestion.body);
    }
  }

  async function save() {
    if (inFlight.current || !canSave) {
      return;
    }
    inFlight.current = true;
    setBusy("saving");
    setFailed(null);
    try {
      await api.saveReviewReplyDraft(accountId, actionRef, { body, baseVersion });
      setDirty(false);
      // Before the re-read, so the row pins itself open on the save itself rather than on
      // the read that follows it — a failed refresh must not cost the operator their panel.
      onPrepared?.();
      await refresh();
    } catch {
      // No detail: the actionable fact is "it did not save". A status code tells the
      // operator nothing, and a server message risks surfacing what this UI should not.
      setFailed("초안을 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function decide(state: "APPROVED" | "WITHDRAWN") {
    if (inFlight.current || unavailable) {
      return;
    }
    if (state === "APPROVED" ? !approvable : !capabilities.canWithdraw) {
      // Enforced, not merely advertised by aria-disabled: the buttons stay focusable, so
      // they still receive clicks.
      return;
    }
    // Reuse the command id ONLY when retrying the same failed intent — a retry is one
    // decision reaching the server twice, which it answers as a replay. A fresh id would
    // make it a second, independent decision. Changing the intent takes a new id.
    const reuse = attempt.current?.state === state && failed != null;
    let commandId: string;
    try {
      commandId = reuse ? attempt.current!.commandId : newCommandId();
    } catch (e) {
      if (e instanceof SecureRandomUnavailableError) {
        setUnavailable(true);
        setFailed(null);
        return;
      }
      throw e;
    }
    attempt.current = { state, commandId };

    inFlight.current = true;
    setBusy(state === "APPROVED" ? "approving" : "withdrawing");
    setFailed(null);
    setCopied(false);
    setManualCopy(null);
    try {
      await api.decideReviewReplyApproval(accountId, actionRef, {
        commandId,
        state,
        baseVersion: state === "APPROVED" ? baseVersion : null,
      });
      attempt.current = null;
      // Re-read rather than trust the write's echo: the approved BODY only ever comes from
      // the prep read, so there is exactly one way to obtain copyable text.
      await refresh();
    } catch {
      setFailed(
        state === "APPROVED"
          ? "승인하지 못했습니다. 다시 시도해 주세요."
          : "승인을 해제하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function copy() {
    // Refused while any write is in flight — the same guard `save` and `decide` carry, and
    // for the same reason: the buttons are aria-disabled rather than natively disabled, so
    // they still receive clicks, and only the ref updates synchronously enough to stop one.
    //
    // Load-bearing here in a way it is not on the others. A withdrawal in flight has already
    // cleared `copied`/`manualCopy` and set `busy`, but has NOT yet refreshed `prep` — so
    // `approved` and `canCopy` both still read true, and a click landing in that window
    // copies the body and re-sets `copied` AFTER the withdrawal cleared it. The panel then
    // finishes withdrawing and tells the operator "복사했습니다. 채널에 직접 붙여넣으세요"
    // about a reply that no longer stands.
    if (inFlight.current) {
      return;
    }
    // The server sends `approvedBody` only when copying is allowed, so this cannot reach
    // for the editor buffer even by mistake — there is nothing else to reach for. That is
    // the point: an unsaved keystroke nobody approved must never land in a public reply.
    // Gated here too, not only on the button: the approved body is already in this
    // component's state, so unlike a save there is no server call to refuse a copy the rule
    // no longer allows. This is the whole enforcement.
    const text = canCopy ? approval?.approvedBody : null;
    if (text == null) {
      return;
    }
    setFailed(null);
    const result = await copyText(text);
    if (result.ok) {
      setCopied(true);
      setManualCopy(null);
      return;
    }
    setCopied(false);
    if (result.reason === "UNAVAILABLE") {
      // No clipboard on this origin, and no retry will change that. Reveal the approved
      // text so the operator can copy it by hand — never a claim that it was copied.
      setManualCopy(text);
      return;
    }
    setFailed("복사하지 못했습니다. 다시 시도해 주세요.");
  }

  async function startHandoff() {
    // Named for what it does in BOTH modes: it starts a handoff, which is a guided run only when this
    // build has a runtime. Calling it startGuided while it also opened the manual path would be the
    // same overclaim in code that "(가이드)" was in the label.
    //
    // Reuse an UNSPENT handoff: one already in flight keeps its single-use submissionRef rather
    // than minting another. A fresh mint happens only after a terminal report spends it (setGuided(null)).
    if (inFlight.current || !canStart || guided != null) {
      return;
    }
    inFlight.current = true;
    setBusy("starting");
    setFailed(null);
    try {
      // The submissionRef is minted by the SERVER either way — a real single-use binding, in both
      // the guided and the manual path. Only the RUN is conditional.
      const run = await api.startReviewReplySubmissionRun(accountId, actionRef);
      // With a runtime, it assigns the opaque runId (never the FE), using the same secure randomness
      // as a command id so a non-secure origin fails closed exactly like approval does. Without one,
      // there is no run to start and nothing to mint — the handoff is manual and says so.
      const handle = runtime
        ? await startReplySubmission(runtime, { channelCode: "naver", submissionRef: run.submissionRef })
        : null;
      setGuided({ submissionRef: run.submissionRef, handle });
    } catch (e) {
      if (e instanceof SecureRandomUnavailableError) {
        setUnavailable(true);
        setFailed(null);
      } else {
        setFailed("답변 준비를 시작하지 못했습니다. 다시 시도해 주세요.");
      }
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function report(outcome: OperatorOutcomeName) {
    if (inFlight.current || guided == null) {
      return;
    }
    // Reuse the command id ONLY when retrying the same report — a retry is one report reaching the
    // server twice. A changed report (submitted vs aborted) takes a fresh id.
    const reuse = reportAttempt.current?.outcome === outcome && failed != null;
    let commandId: string;
    try {
      commandId = reuse ? reportAttempt.current!.commandId : newCommandId();
    } catch (e) {
      if (e instanceof SecureRandomUnavailableError) {
        setUnavailable(true);
        setFailed(null);
        return;
      }
      throw e;
    }
    reportAttempt.current = { outcome, commandId };
    inFlight.current = true;
    setBusy("reporting");
    setFailed(null);
    try {
      // Drive the run to its OPERATOR_REPORTED terminal; the recorded outcome + runId come FROM the
      // terminal (the sole source), never fabricated on the client.
      // With a run, the terminal is the sole source of both the outcome and the runId. Without one,
      // the outcome is the operator's own report and there is NO run ref — production may not mint a
      // run identity for a run that did not happen, and an absent ref is the honest record of that.
      const terminal = guided.handle
        ? outcome === "OPERATOR_REPORTED_SUBMITTED"
          ? await guided.handle.reportSubmitted()
          : await guided.handle.abortSubmission()
        : null;
      await api.recordReviewReplyOutcome(accountId, actionRef, {
        commandId,
        submissionRef: guided.submissionRef,
        operatorOutcome: terminal ? terminal.operatorOutcome : outcome,
        ...(terminal ? { awRunRef: terminal.runId } : {}),
      });
      reportAttempt.current = null;
      setGuided(null);
      // Only a reported SUBMISSION changes the worklist. An abort is a normal ending that leaves the
      // review exactly where it was, so telling the list to refetch would spend a request to redraw
      // an identical page.
      if ((terminal ? terminal.operatorOutcome : outcome) === "OPERATOR_REPORTED_SUBMITTED") {
        onOutcomeRecorded?.();
      }
      // Re-read so the recorded outcome (operatorOutcome + verification, as a pair) shows.
      await refresh();
    } catch {
      setFailed("기록하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-xl bg-canvas p-3">
      <h4 id={headingId} className="text-sm font-semibold text-ink">
        답변 준비
      </h4>

      {/* The review, in full. Not the list's 60-char preview — an operator cannot answer a
          complaint they can only glimpse. Sensitive spans arrive already tokenized by the
          server; this renders, it never redacts. */}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-muted">고객 리뷰</p>
        <p className="whitespace-pre-wrap text-sm text-ink">
          {prep.redactedBody ?? <span className="italic text-muted">내용 없음</span>}
        </p>
        {prep.bodyRedacted ? (
          // Said out loud rather than left as a mystery: the operator is about to send this
          // to a customer, and an unexplained [번호] in their source text is worth a
          // sentence.
          <p className="text-sm text-muted">개인정보로 보이는 부분은 가려서 표시했습니다.</p>
        ) : null}
      </div>

      {/* 규칙 기반, stated plainly (Frontend Spec §10.3). The label is the FE's, not the
          server's `providerKind` echoed raw — an enum name is a contract, not copy. */}
      <div className="flex flex-col gap-1">
        <label htmlFor={editorId} className="text-sm font-semibold text-muted">
          답변 초안
        </label>
        <p className="text-sm text-muted">
          아래 초안은 <strong className="font-semibold">규칙 기반 추천</strong>입니다. 내용을 확인하고
          직접 고쳐 주세요.
        </p>
        <textarea
          id={editorId}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setDirty(true);
          }}
          readOnly={!canSave || working}
          aria-describedby={approved ? `${headingId}-frozen` : undefined}
          rows={5}
          className="w-full rounded-lg border border-line bg-white p-2 text-sm text-ink"
        />
        {approved ? (
          <p id={`${headingId}-frozen`} className="text-sm text-muted">
            승인된 초안은 수정할 수 없습니다. 고치려면 승인을 해제하세요.
          </p>
        ) : null}
        {!approved && !canSave ? (
          // Why the editor is inert, rather than a dead control with no explanation. The
          // operator's own decision is what closed it, and they can reverse it.
          <p className="text-sm text-muted">
            '대응 필요'로 기록된 리뷰만 답변을 준비할 수 있습니다.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-disabled={!canSave || working}
          aria-busy={busy === "saving"}
          onClick={() => void save()}
          className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${
            canSave && !working ? "bg-canvas text-ink" : "bg-canvas text-muted opacity-40"
          }`}
        >
          초안 저장
        </button>
        {/* Rendered inert rather than removed once a draft exists. The card removes a
            control when the row can NEVER carry the action (no ref); here the truth is
            "not while this review is 지켜보기" — a reason, and one the operator can reverse.
            The explanation is the '대응 필요로 기록된 리뷰만…' line above. */}
        {capabilities.canApprove || (!approved && draft != null) ? (
          <button
            type="button"
            aria-disabled={!approvable || working || unavailable}
            aria-busy={busy === "approving"}
            onClick={() => void decide("APPROVED")}
            className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${
              approvable && !working ? "bg-brand/10 text-brand-700" : "bg-canvas text-muted opacity-40"
            }`}
          >
            승인
          </button>
        ) : null}
        {approved ? (
          <button
            type="button"
            aria-disabled={!capabilities.canWithdraw || working || unavailable}
            aria-busy={busy === "withdrawing"}
            onClick={() => void decide("WITHDRAWN")}
            className="rounded-lg bg-canvas px-2.5 py-1 text-sm font-semibold text-ink"
          >
            승인 해제
          </button>
        ) : null}
        {approved ? (
          <button
            type="button"
            aria-disabled={!canCopy || working}
            onClick={() => void copy()}
            className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${
              canCopy && !working ? "bg-brand text-white" : "bg-canvas text-muted opacity-40"
            }`}
          >
            복사
          </button>
        ) : null}
        {/* The guided post. NOT a send: SellerOps foregrounds the seller center and the operator
            posts the reply themselves. No 발송/전송/등록 label (Frontend Spec §10.2). Rendered only
            while no run is in progress; the run's own panel is below. */}
        {canStart && guided == null ? (
          <button
            type="button"
            aria-disabled={!canStart || working}
            aria-busy={busy === "starting"}
            onClick={() => void startHandoff()}
            className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${
              canStart && !working ? "bg-canvas text-ink ring-1 ring-line" : "bg-canvas text-muted opacity-40"
            }`}
          >
            {canGuide ? "네이버에서 직접 답변하기(가이드)" : "직접 답변하고 기록하기"}
          </button>
        ) : null}
        {channelAnswered ? (
          <span className="text-sm text-muted" data-testid="channel-answered-notice">
            채널에 이미 답변이 등록된 리뷰예요. 같은 리뷰에 답변이 두 번 달리지 않도록 가이드형 답변은
            제공하지 않아요.
          </span>
        ) : null}
        {capabilities.canApprove && dirty ? (
          <span className="text-sm text-muted">
            저장하지 않은 변경이 있습니다. 먼저 초안을 저장하세요.
          </span>
        ) : null}
        {approved && !canCopy ? (
          <span className="text-sm text-muted">
            '대응 필요'로 되돌리면 복사할 수 있습니다.
          </span>
        ) : null}
      </div>

      {/* The guided run in progress. The operator posts the reply in the seller center themselves;
          SellerOps only guides and records what they report. Two reports, both honest: 답변함 /
          답변 안 함 — never a claim SellerOps posted anything, and never a 완료. */}
      {guided != null ? (
        <div
          role="group"
          aria-label="네이버에서 직접 답변하기"
          className="flex flex-col gap-2 rounded-lg border border-line bg-white p-2"
        >
          <p className="text-sm font-semibold text-ink">네이버에서 직접 답변하기</p>
          <p className="text-sm text-muted">
            복사한 답변을 네이버 판매자센터 답변란에 붙여넣고 <strong className="font-semibold">직접</strong>{" "}
            답변해 주세요. SellerOps가 대신 하지 않으며, 답변 여부도 확인하지 않습니다.
          </p>
          {/* The overclaim this slice removes. Without a runtime nothing opens the seller center,
              nothing finds the row, nothing watches the post — so the panel must not imply it does.
              The locating facts below are what SellerOps CAN offer instead. */}
          {!canGuide ? (
            <p className="text-sm text-muted">
              이 화면은 안내(가이드)를 제공하지 않아요. 아래 정보로 네이버에서 리뷰를 찾아 주세요.
            </p>
          ) : null}
          {/* The narrowing facts: what the seller scans a review list by. Display name only — never
              a SKU or 상품번호 — resolved by the same shared rule the attention row uses. Each is
              omitted rather than guessed when the review does not carry it. */}
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {prep.productName != null ? (
              <div className="flex gap-1">
                <dt className="font-semibold">상품</dt>
                <dd>{prep.productName}</dd>
              </div>
            ) : null}
            {prep.reviewDate != null ? (
              <div className="flex gap-1">
                <dt className="font-semibold">작성일</dt>
                <dd>{prep.reviewDate}</dd>
              </div>
            ) : null}
            {prep.rating != null ? (
              <div className="flex gap-1">
                <dt className="font-semibold">평점</dt>
                <dd>{"★".repeat(prep.rating)}</dd>
              </div>
            ) : null}
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-disabled={working}
              aria-busy={busy === "reporting"}
              onClick={() => void report("OPERATOR_REPORTED_SUBMITTED")}
              className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${
                working ? "bg-canvas text-muted opacity-40" : "bg-brand/10 text-brand-700"
              }`}
            >
              답변함으로 기록
            </button>
            <button
              type="button"
              aria-disabled={working}
              onClick={() => void report("SUBMISSION_ABORTED")}
              className="rounded-lg bg-canvas px-2.5 py-1 text-sm font-semibold text-ink"
            >
              답변 안 함으로 기록
            </button>
            <button
              type="button"
              aria-disabled={working}
              onClick={() => setGuided(null)}
              className="rounded-lg px-2.5 py-1 text-sm text-muted"
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}

      {/* The recorded outcome — outcome AND verification shown as a PAIR. Never the verification
          ("확인 안 함") alone (it would read as a system failure, not an operator report), and never
          a "완료". */}
      {prep.outcome != null ? (
        <div role="status" className="flex flex-col gap-1 rounded-lg bg-canvas p-2">
          <p className="text-sm text-ink">
            {prep.outcome.operatorOutcome === "OPERATOR_REPORTED_SUBMITTED"
              ? "채널에 직접 답변한 것으로 기록했어요."
              : "답변하지 않은 것으로 기록했어요."}
          </p>
          <p className="text-sm text-muted">SellerOps는 답변 여부를 확인하지 않습니다(확인 안 함).</p>
        </div>
      ) : null}

      {/* Mounted always, text toggling — a live region has to be in the accessibility tree
          before its content changes or assistive tech never registers on it. Empty renders
          as nothing, so there is no visual cost. */}
      <p aria-live="polite" className="text-sm text-muted">
        {busy === "saving" ? "저장 중…" : ""}
        {busy === "approving" ? "승인 중…" : ""}
        {busy === "withdrawing" ? "승인 해제 중…" : ""}
        {/* Honest about who sends. The product does not post this anywhere, and the moment
            it would be easiest to imply otherwise is the moment the copy succeeds. */}
        {!working && copied ? "복사했습니다. 채널에 직접 붙여넣으세요." : ""}
      </p>

      {manualCopy != null && canCopy ? (
        // A capability limit, not a failure — and NOT a claim that anything was copied.
        // The text is the approved body, selectable, so the operator can take it by hand.
        //
        // Gated on `canCopy`, not just on having text: nothing clears `manualCopy` when a
        // sibling moves the decision, and on a no-clipboard origin THIS is the copy path —
        // so without the gate the panel would keep offering "직접 선택해 복사하세요" beside a
        // button that has just refused the same action. That inverts the one invariant this
        // design rests on: the client may refuse what the server allows, never the reverse.
        //
        // Withheld rather than cleared, so restoring 대응 필요 restores the fallback the
        // operator was mid-way through using.
        <div role="group" aria-label="승인된 답변" className="flex flex-col gap-1">
          <p className="text-sm text-bad">
            이 환경에서는 자동 복사를 할 수 없습니다. 아래 내용을 직접 선택해 복사하세요.
          </p>
          <textarea
            readOnly
            value={manualCopy}
            rows={4}
            aria-label="승인된 답변 (직접 복사)"
            className="w-full rounded-lg border border-line bg-white p-2 text-sm text-ink"
          />
        </div>
      ) : null}

      {unavailable ? (
        <p role="alert" className="text-sm text-bad">
          이 환경에서는 승인을 기록할 수 없습니다. 보안 연결(HTTPS)로 접속해 주세요.
        </p>
      ) : null}
      {failed != null && !unavailable ? (
        <p role="alert" className="text-sm text-bad">
          {failed}
        </p>
      ) : null}
    </section>
  );
}
