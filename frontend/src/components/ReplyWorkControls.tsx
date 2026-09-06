import { useCallback, useEffect, useState } from "react";
import type { TriageDisposition } from "../lib/types";
import { triageDispositionLabel } from "../lib/vocItems";
import { VocItemReplyPrep } from "./VocItemReplyPrep";
import { VocItemTriageControl } from "./VocItemTriageControl";

/**
 * One review's reply work: the operator's decision (대응 필요 / 지켜보기 / 대응 불필요) and, once the
 * decision or existing work calls for it, the reply preparation panel — draft → approve → copy → the
 * guided (or manual) handoff to the seller center → the operator's own outcome record.
 *
 * This is the SAME cluster on every surface that offers reply work: the 내 답변 작업 rows
 * (`VocItemCard`) and, since product assembly A6, the 리뷰 screen's detail panel. It used to live inline
 * in `VocItemCard`; it was lifted out unchanged so the 리뷰 detail mounts the one flow the product has
 * (the live-proven NAVER path) rather than a second one that could drift in gate or copy.
 *
 * Nothing here posts anything: 대응 필요 is a judgement, the draft is text, the handoff ends on the
 * seller's own screen. `VocItemReplyPrep` owns the runtime and its capabilities.
 */
export function ReplyWorkControls({
  accountId,
  actionRef,
  disposition,
  hasReplyPreparation,
  channelReplyState,
  triageMode = "edit",
  headingLevel,
  onOutcomeRecorded,
  onDecided,
}: {
  accountId: string;
  /** Server-minted, client-opaque address of the review's reply work. */
  actionRef: string;
  /** The decision as the surface last read it. */
  disposition: TriageDisposition | null;
  /** Whether a draft or approval already exists, as the surface last read it. */
  hasReplyPreparation: boolean;
  /**
   * What the CHANNEL last said about a reply already posted (`ANSWERED` | `PENDING` | `UNKNOWN` |
   * null when the surface does not carry it).
   *
   * <p>Stated HERE, above the decision, because this cluster is the one thing mounted on every reply
   * surface from the moment it opens — and the reply panel, which has known this all along, does not
   * mount until AFTER the response decision has been made. Measured in pilot QA on 2026-09-06: a
   * review the channel reports as answered opened on 「판단 전」 and three triage buttons and said
   * nothing, so the operator judged whether to answer without being told an answer already exists.
   */
  channelReplyState?: string | null;
  /**
   * Whether this surface offers to CHANGE the decision, or only shows it.
   *
   * "edit" (default) renders the interactive control — where the decision is actually made. "readonly"
   * renders a compact label instead, for the 내 답변 작업 worklist: there a full toggle group reads as a
   * competing "take it off my list" control beside 작업에서 제외, and moving a DRAFTED row to 지켜보기
   * silently fails to remove it. The reply flow itself is unchanged in both modes.
   */
  triageMode?: "edit" | "readonly";
  /** The heading level 「답변 준비」 renders at — the caller owns the outline. See VocItemReplyPrep. */
  headingLevel?: 2 | 3 | 4;
  /** Bubbled to the owner so a count or badge can reflect a reply the operator just posted. */
  onOutcomeRecorded?: () => void;
  /** The server-confirmed decision, announced so an owner-level list (내 답변 작업) can re-read. */
  onDecided?: (disposition: TriageDisposition) => void;
}) {
  // The LIVE decision, not the one the owner last fetched.
  //
  // `disposition` is a snapshot: the owner refetches only on its own deps, and nothing on the triage
  // path bumps them. So a decision recorded in this session never reaches the prop, and a mount rule
  // reading it would leave an operator who just clicked 대응 필요 looking at a pressed button and no
  // panel — able to reach 답변 준비 only by reloading the page.
  //
  // Seeded from the prop and advanced only on a server-confirmed decision (see
  // VocItemTriageControl.onRecorded). Re-seeded when the prop itself changes, so a real refetch — a new
  // page, a new review — still wins over a stale session decision.
  const [decided, setDecided] = useState<TriageDisposition | null>(disposition);
  useEffect(() => setDecided(disposition), [disposition, actionRef]);
  const recordDecision = useCallback(
    (next: TriageDisposition) => {
      setDecided(next);
      onDecided?.(next);
    },
    [onDecided],
  );

  // Whether this review carries reply work — the server's answer, promoted locally the moment a draft is
  // saved in this session.
  //
  // `hasReplyPreparation` predates any draft written since it was read. Without the promotion an operator
  // could save a draft, change their mind to 지켜보기, and watch the panel take their draft with it.
  //
  // MONOTONIC within a session: false → true and never back. The panel's job here is to not vanish out
  // from under work that exists, and nothing an operator does in this session destroys a draft (a
  // withdrawal explicitly keeps it). The server is still the authority — a re-read re-seeds it.
  const [prepared, setPrepared] = useState(hasReplyPreparation);
  useEffect(() => setPrepared(hasReplyPreparation), [hasReplyPreparation, actionRef]);

  // Whether the panel is holding work that exists nowhere else — an unsaved edit, or a write in flight.
  // Unmounting over either destroys it silently: the buffer lives only in the panel, and a write whose
  // handler is unmounted reports neither success nor failure.
  const [localWork, setLocalWork] = useState(false);
  const noteLocalWork = useCallback((has: boolean) => setLocalWork(has), []);
  const promote = useCallback(() => setPrepared(true), []);

  return (
    <>
      <ChannelAnsweredState state={channelReplyState ?? null} />
      {triageMode === "readonly" ? (
        // The decision, shown but not editable here — see `triageMode`. A label, never a disabled toggle:
        // the operator is not being refused an action, the action simply lives elsewhere. The word is the
        // live decision (`decided`), so a row that arrived 대응 필요 says so.
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">처리 상태</span>
          <span
            className="rounded-lg bg-canvas px-2.5 py-1 text-sm font-semibold text-ink"
            data-testid="voc-triage-readonly"
          >
            {triageDispositionLabel(decided)}
          </span>
        </div>
      ) : (
        <VocItemTriageControl
          key={`decide-${actionRef}`}
          accountId={accountId}
          actionRef={actionRef}
          disposition={disposition}
          onRecorded={recordDecision}
        />
      )}
      {/* Reply preparation, when the review needs a reply now or already carries work. Mounting it opens a
          read, so it stays off reviews that offer nothing.

          The `|| prepared` half is what keeps work from being stranded: a draft written while the review
          was 대응 필요 must stay readable — and any approval withdrawable — after the operator moves it to
          지켜보기. On the decision alone that review would render no panel, leaving an approved reply the
          operator can neither see nor take back.

          Both operands are free: `decided` is local, and `prepared` starts from a flag the owner already
          read and is promoted in-session by the panel's own save. So the rule costs no request of its own —
          the panel reads once when it mounts, and again only after its own writes. */}
      {decided === "RESPONSE_NEEDED" || prepared || localWork ? (
        <VocItemReplyPrep
          key={`prep-${actionRef}`}
          accountId={accountId}
          actionRef={actionRef}
          disposition={decided}
          onPrepared={promote}
          onOutcomeRecorded={onOutcomeRecorded}
          onLocalWork={noteLocalWork}
          headingLevel={headingLevel}
        />
      ) : null}
    </>
  );
}

/**
 * 「이미 답변 완료」 — the channel's own statement, said before anyone decides anything.
 *
 * <p><b>It is not the triage decision and it does not make one.</b> The controls below are untouched:
 * a review answered on the channel may still be one this operator has never looked at, and writing
 * 「처리 완료」 here would record a decision nobody made. What it does say is that the road to a
 * SECOND public reply is closed — new draft, new approval and the guided run are all withheld by the
 * server (`canSave` / `canApprove` / `canStartSubmissionRun`) and refused by it — so this is a
 * sentence about a real closure rather than a warning the product then walks past.
 *
 * <p>Rendered for ANSWERED alone. 「아직 답변이 없습니다」 would be the channel's silence dressed as a
 * statement: UNKNOWN means no usable answer, which is a different fact from PENDING.
 */
function ChannelAnsweredState({ state }: { state: string | null }) {
  if (state !== "ANSWERED") return null;
  return (
    <div className="rounded-xl border border-line bg-canvas p-3" data-testid="channel-answered-state">
      <p className="break-keep text-sm font-semibold text-ink">채널에 이미 답변이 등록된 리뷰입니다</p>
      <p className="break-keep text-sm leading-relaxed text-muted">
        판매자센터에 답변이 있다고 채널이 알려왔습니다. 새 초안·승인·판매자센터 답변하기는 열리지 않습니다.
        처리 상태는 아래에서 따로 기록할 수 있습니다.
      </p>
    </div>
  );
}
