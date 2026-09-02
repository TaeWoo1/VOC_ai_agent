import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { HumanActionRequiredArtifact as HumanAction } from "../../../lib/conversation/types";
import { Btn, BtnLink } from "../../ui/Btn";
import { api } from "../../../lib/apiClient";
import { analytics } from "../../../lib/analytics";
import { blockerView, resolveCopy } from "../../../lib/actionWindow/copy";
import { buildImportGuidancePack, continuationAfterNext, recheckLabel } from "../../../lib/reviewImport";
import { isTerminalRunStatus } from "../../../lib/actionWindow/homeFixtures";
import { type AcquireRuntime } from "../../../lib/actionWindow/acquire/acquireRuntime";
import {
  useGuidedAcquisition,
  type AcquisitionConnect,
  type GuidedAcquisitionPath,
} from "../../../lib/actionWindow/acquire/useGuidedAcquisition";
import { useBridge } from "../../../hooks/useBridge";
import { useGuidedImport } from "../../../lib/actionWindow/import/useGuidedImport";
import type { GuidedImportRuntime } from "../../../lib/actionWindow/import/importRuntime";
import { AgentPairingPanel } from "../../reviewImport/AgentPairingPanel";
import { ActionWindowControlPanel } from "../../actionWindow/ActionWindowControlPanel";
import { HumanCheckpointCard, CHECKPOINT_COMMANDS } from "../../actionWindow/HumanCheckpointCard";
import { ArtifactCard } from "./ArtifactCard";
import { asOfWord } from "../../../lib/conversation/asOf";
import { useContinueInPanel } from "../useContinueInPanel";

const HEADLINE: Record<HumanAction["actionType"], string> = {
  // **The card names the QUESTION it answers, not the machinery that answers it** (Continuity v1 §1).
  // A seller who asked 「오늘 네이버 리뷰 있어?」 is being offered the one thing that can answer it: a check
  // of what has arrived. 「가져오기」 described our import; 「최신 상태 확인」 describes their question.
  REVIEW_IMPORT: "리뷰 최신 상태 확인",
  CHANNEL_CONNECT: "이 채널을 확인하려면 연결이 필요합니다",
  KNOWLEDGE_ENTRY: "답변하려면 답변 기준이 필요합니다",
  VARIANT_CLARIFICATION: "규격을 확인해야 정확한 답변을 준비할 수 있습니다",
};

const REASON: Record<HumanAction["reason"], string> = {
  FRESHNESS_UNPROVEN: "마지막 수집이 최신인지 확인되지 않았습니다.",
  NOT_COLLECTED: "이 기간에 수집된 기록이 없습니다.",
  NOT_CONNECTED: "채널이 연결되어 있지 않습니다.",
  NO_ANSWER_BASIS: "이 질문에 적용할 수 있는 답변 기준이 없습니다.",
};

/** What a link-only step's button says. Absent ⇒ the generic 「직접 진행하기」. */
const LINK_LABEL: Partial<Record<HumanAction["actionType"], string>> = {
  KNOWLEDGE_ENTRY: "답변 기준 추가",
  VARIANT_CLARIFICATION: "규격 확인",
  CHANNEL_CONNECT: "채널 연결하기",
};

const GUIDED_PATHS: ReadonlyArray<HumanAction["path"]> = ["EXPORT_ACTION_WINDOW", "WING_READ_ACTION_WINDOW"];

/** What the guided run does, per path — the product contract's wording (a bounded set of platform confirmations, not a one-press promise). */
const GUIDED_SENTENCE: Record<GuidedAcquisitionPath, string> = {
  EXPORT_ACTION_WINDOW: "reviewnary가 판매자센터의 리뷰 내려받기 화면과 기간을 준비합니다. 판매자님은 화면이 요구하는 확인만 누르시면, 내려받은 파일을 reviewnary가 읽어 이 질문을 이어서 확인합니다.",
  WING_READ_ACTION_WINDOW: "reviewnary가 판매자센터의 리뷰 화면을 준비합니다. 판매자님은 화면이 요구하는 확인과 페이지 넘기기만 하시면, reviewnary가 그 화면의 리뷰를 읽어 이 질문을 이어서 확인합니다.",
};

/** The card's title: the channel's own step, in four words — 「네이버 리뷰 최신 상태 확인」 / 「네이버 리뷰 · 8월 20일 기준」. */
function titleOf(artifact: HumanAction, channel: string | null): string {
  if (artifact.actionType !== "REVIEW_IMPORT") return HEADLINE[artifact.actionType];
  if (artifact.optional) {
    const word = asOfWord(artifact.asOf);
    return `${channel ?? "채널"} 리뷰 · ${word ? `${word} 기준` : "확인 기록 없음"}`;
  }
  return `${channel ?? ""} ${HEADLINE.REVIEW_IMPORT}`.trim();
}

/** One line of reason. For a review step it names the instant, never the mechanism (no "sync", no "coverage"). */
function reasonOf(artifact: HumanAction): string | null {
  // 「답변하려면 답변 기준이 필요합니다」 as the title and 「이 질문에 적용할 수 있는 답변 기준이
  // 없습니다」 under it are one fact in two shapes (Conversation UX v2 §D). The title keeps it.
  if (artifact.actionType === "KNOWLEDGE_ENTRY") return null;
  if (artifact.actionType !== "REVIEW_IMPORT") return REASON[artifact.reason];
  if (artifact.reason === "NOT_CONNECTED") return REASON.NOT_CONNECTED;
  const word = asOfWord(artifact.asOf);
  if (artifact.optional) return word ? "지금 보이는 목록은 그때까지 확인한 것입니다." : "아직 확인한 적이 없어 목록이 비어 있을 수 있습니다.";
  return word ? `${word} 이후 아직 확인하지 못했어요.` : "아직 확인한 적이 없어요.";
}

/**
 * The one-step human action the agent could not do itself. ONE primary, decided by the path: the
 * seller-pressed collection this product already has (MANUAL_SYNC), a guided Action Window run rendered
 * INLINE (EXPORT_ACTION_WINDOW · WING_READ_ACTION_WINDOW — the local helper prepares the seller-center
 * screen, the seller performs the platform's own confirmations, reviewnary detects and ingests), or a link
 * to the screen where the seller does it. 「계속 확인하기」 resumes the turn. This artifact is the only
 * conversation module that may start a collection or an acquisition run, and it is always the seller's press.
 *
 * When several channels each need a step, the runtime sends one artifact per channel and this renders one
 * card per channel; the 「일단 확인된 리뷰 보기」 chip is the turn's own suggested action.
 */
export function HumanActionArtifact({
  artifact,
  onResume,
  acquireRuntime,
  importRuntime,
  connect,
}: {
  artifact: HumanAction;
  onResume: () => void;
  /** Test seam: a runtime supplied here skips pairing and the socket (Coupang WING read). */
  acquireRuntime?: AcquireRuntime;
  /** Test seam: the guided-import runtime for the NAVER export (Acceptance Closure §4). */
  importRuntime?: GuidedImportRuntime;
  connect?: AcquisitionConnect;
}) {
  const onOpen = useContinueInPanel("HUMAN_ACTION_REQUIRED");
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);
  /**
   * **The press that opens the seller center — unless the sentence WAS that press.**
   *
   * 「네이버 리뷰 최신화해줘」 and 「오늘 리뷰 있어?」 reached the identical card, so a seller who had just
   * written the instruction was handed a button repeating it back. `autoStart` is the runtime's
   * deterministic reading of that sentence (`conversation/acquisitionRequest.ts`), and it starts the same
   * guided READ run the button starts — same path, same seller confirmations in their own window, nothing
   * clicked or downloaded for them. It never applies to a write, a composer or a submission.
   */
  const [engaged, setEngaged] = useState(artifact.autoStart === true);
  /**
   * Bumped to start a NEW guided run in this same card.
   *
   * Once `engaged` is true the card replaces its primary with the run panel, so a run that reached a terminal
   * state left the seller with no control at all — observed live on 2026-09-01: after 「그만두기」 the card had
   * neither 「최신 리뷰 가져오기」 nor anything else, and only a page reload brought it back.
   */
  const [runKey, setRunKey] = useState(0);
  const channel = artifact.channelNameKo ?? artifact.channelCode;
  const canSync = artifact.path === "MANUAL_SYNC" && !!artifact.accountId;
  const guided = GUIDED_PATHS.includes(artifact.path) && !!artifact.accountId ? (artifact.path as GuidedAcquisitionPath) : null;
  const review = artifact.actionType === "REVIEW_IMPORT";
  // The primary's label: an offer says what it does to the list; a required step says what it fetches.
  const primaryLabel = artifact.optional ? "최신 상태로 갱신" : review ? "최신 상태 확인" : "지금 리뷰 가져오기";

  async function startSync() {
    if (!artifact.accountId) return;
    setStarting(true);
    setFailed(false);
    try {
      await api.manualSync(artifact.accountId, artifact.dataType ?? "REVIEW");
      analytics.track("human_action_completed", { type: "review_import" });
      onResume();
    } catch {
      setFailed(true);
    } finally {
      setStarting(false);
    }
  }

  const returnTo = (to: string) => `${to}${to.includes("?") ? "&" : "?"}returnTo=%2F`;

  // An OFFERED refresh is not this answer's primary action (Frontend-first Agent Workspace Redesign
  // v1). Measured: on a screen whose subject was eight customer complaints, the only solid button was
  // 「최신 상태로 갱신」 — the loudest control on the page belonged to our collection machinery. It is
  // still here, still one press, and now it looks like what it is: an offer beside the work. A REQUIRED
  // step keeps its primary, because then the answer genuinely waits on it.
  const tone = artifact.optional ? ("outline" as const) : ("solid" as const);
  const primary = canSync ? (
    <Btn variant={tone} onClick={startSync} disabled={starting}>{starting ? "시작하는 중…" : primaryLabel}</Btn>
  ) : guided ? (
    !engaged ? <Btn variant={tone} onClick={() => setEngaged(true)}>{primaryLabel}</Btn> : null
  ) : artifact.to ? (
    // The button says the STEP, not 「직접 진행하기」: a seller reading 「답변 기준이 필요합니다」 needs the
    // control to name the thing they are about to add (the same words the 문의 screen uses).
    <BtnLink to={returnTo(artifact.to)} onClick={onOpen}>{LINK_LABEL[artifact.actionType] ?? "직접 진행하기"}</BtnLink>
  ) : null;
  const running = guided != null && engaged && !!artifact.accountId;
  /**
   * **Escapes belong beside a step you are IN, not beside the way in.**
   *
   * Live on 2026-09-02 this card offered three controls at rest — 「최신 리뷰 가져오기」, 「계속 확인하기」
   * and 「파일로 직접 올리기」 — for a step with one way forward. Two of them only mean something after the
   * first: there is nothing to resume before a run exists, and the manual fallback is what you reach for
   * when the guided path did not work.
   *
   * A card whose primary acts IN PLACE (a guided run, a sync) can therefore hold them back until it has
   * been pressed. A card whose primary sends the seller to another screen cannot: leaving IS the step, and
   * 「계속 확인하기」 is how they come back — hiding it there would strand them.
   */
  const inPlace = guided != null || canSync;
  const showEscapes = running || failed || !inPlace;

  // Compact: title · one reason line · the primary in the header. The guided run's own sentence and controls
  // appear only after the press; 「계속 확인하기」 only when the turn is actually waiting on this step.
  return (
    <ArtifactCard
      title={titleOf(artifact, channel)}
      note={reasonOf(artifact)}
      action={primary}
      testId={artifact.optional ? "human-action-offer" : "human-action-artifact"}
      framed
    >
      {running || failed || showEscapes ? (
        <div className="space-y-3 px-4 pb-3">
          {running && guided ? <p className="break-keep text-sm text-muted">{GUIDED_SENTENCE[guided]}</p> : null}
          {failed ? <p className="text-sm text-bad">수집을 시작하지 못했습니다. 채널 연결 화면에서 다시 시도해 주세요.</p> : null}

          {guided === "EXPORT_ACTION_WINDOW" && running && artifact.accountId ? (
            <NaverGuidedImportRun
              // Remounting on restart is the point: a fresh mount runs the whole attach → plan → launch →
              // START_RUN chain again, which is exactly what "try again" has to mean. Keeping the component
              // and re-firing part of the chain would leave it addressing the run that just ended.
              key={runKey}
              accountId={artifact.accountId}
              onCompleted={() => {
                analytics.track("human_action_completed", { type: "review_import" });
                onResume();
              }}
              onRestart={() => setRunKey((k) => k + 1)}
              inject={importRuntime}
            />
          ) : guided && running && artifact.accountId ? (
            <GuidedAcquisitionRun
              path={guided}
              accountId={artifact.accountId}
              onCompleted={() => {
                analytics.track("human_action_completed", { type: "review_import" });
                onResume();
              }}
              inject={acquireRuntime}
              connect={connect}
            />
          ) : null}

          {/* **The escapes appear once the seller is IN the step, not beside the way in.**

              Live on 2026-09-02 this card offered three controls at rest — 「최신 리뷰 가져오기」,
              「계속 확인하기」 and 「파일로 직접 올리기」 — for a step that has one way forward. Two of them
              only mean anything after the first has been pressed: there is nothing to resume before a run
              exists, and the manual fallback is what you reach for when the guided path did not work. A card
              with one action says what to do; a card with three asks the seller to choose a strategy. */}
          {/* ONE row of ways out (Reviewnary Visual System v1 §4). Two controls stacked vertically,
              each on its own line, read as two steps in a sequence; they are alternatives, and an
              alternative sits beside the thing it is an alternative to. */}
          {(artifact.resumable && !artifact.optional && showEscapes) || (artifact.fallback?.to && showEscapes) ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
              {artifact.resumable && !artifact.optional && showEscapes ? (
                <Btn variant="outline" size="sm" onClick={onResume}>계속 확인하기</Btn>
              ) : null}
              {artifact.fallback?.to && showEscapes ? (
                <p className="text-sm text-muted">
                  도우미 없이 진행하려면{" "}
                  <Link to={returnTo(artifact.fallback.to)} onClick={onOpen} className="font-semibold text-brand-700 hover:underline">
                    {artifact.fallback.label}
                  </Link>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </ArtifactCard>
  );
}

/**
 * The inline guided run. Mounted only after the seller's press, so pairing is asked for by that press and
 * never by a reloaded conversation. Order: pair → attach (carrier by path) → mint the ref (Coupang) → ONE
 * `START_RUN` → controls from `allowedCommands` → the run's own `COMPLETED` resumes the turn.
 */
function GuidedAcquisitionRun({
  path,
  accountId,
  onCompleted,
  inject,
  connect,
}: {
  path: GuidedAcquisitionPath;
  accountId: string;
  onCompleted: () => void;
  inject?: AcquireRuntime;
  connect?: AcquisitionConnect;
}) {
  const bridge = useBridge(!inject, { autoPair: true });
  const paired = !!inject || bridge.state.phase === "paired";
  const { view, unavailable, ensureRuntime, send } = useGuidedAcquisition(path, inject, connect);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const startedRef = useRef(false);
  /**
   * A start that actually reached `runtime.start` — the ONE thing that must never happen twice, and the one
   * thing `startedRef` alone could not express.
   */
  const committedRef = useRef(false);
  const completedRef = useRef(false);

  /**
   * **Start once per mounted card, and never lock the card out of starting at all.**
   *
   * `startedRef` was set BEFORE the first await and never reset, while the cleanup set `live = false`. Under
   * `React.StrictMode` (this app mounts under it — `main.tsx`) an effect runs, is cleaned up, and runs again:
   * the first pass abandoned itself at `if (!runtime || !live) return;` and the second was refused by the ref,
   * so the run was NEVER started and nothing anywhere said so. Observed live on 2026-09-02: sockets attached,
   * a snapshot arrived, no ticket was minted, no `START_RUN` was sent, no error was shown.
   *
   * The repair is to say what the two flags actually mean. `startedRef` guards an attempt that is still in
   * flight and is RELEASED when that attempt is torn down; `committedRef` is set once a `START_RUN` has been
   * handed to the runtime and is never released, so a re-run of this effect cannot start a second run. An
   * abandoned first pass returns before minting, so it leaves no unspent ticket behind.
   */
  useEffect(() => {
    if (!paired || startedRef.current || committedRef.current) return;
    startedRef.current = true;
    let live = true;
    setStarting(true);
    void (async () => {
      try {
        const runtime = await ensureRuntime();
        if (!runtime || !live) return;
        // Connect first, mint second: a refused attach must not spend a single-use ref.
        // From here the attempt is COMMITTED: a ref is spent-or-spendable and a command is on the wire, so no
        // later invocation of this effect may start another.
        committedRef.current = true;
        try {
          if (path === "WING_READ_ACTION_WINDOW") {
            const minted = await api.startReviewAcquisitionRun(accountId);
            if (!live) return;
            await runtime.start({ intent: "REVIEW_ACQUISITION", acquisitionRef: minted.acquisitionRef });
          } else {
            await runtime.start({ intent: "EXPORT" });
          }
        } catch (e) {
          committedRef.current = false;
          throw e;
        }
      } catch {
        if (live) setError("판매자센터 화면을 준비하지 못했습니다. 아래 다른 방법으로 진행할 수 있습니다.");
      } finally {
        if (live) setStarting(false);
      }
    })();
    return () => {
      live = false;
      // An attempt torn down before it committed started nothing, so the next invocation must be allowed to
      // try. Leaving this set is what made the card permanently dead.
      if (!committedRef.current) startedRef.current = false;
    };
  }, [paired, ensureRuntime, path, accountId]);

  useEffect(() => {
    if (view?.status === "COMPLETED" && !completedRef.current) {
      completedRef.current = true;
      onCompleted();
    }
  }, [view?.status, onCompleted]);

  if (!paired) {
    return (
      <AgentPairingPanel
        phase={bridge.state.phase}
        confirmationCode={bridge.state.confirmationCode}
        confirmUrl={bridge.state.confirmUrl}
        attestedApproval={bridge.state.attestedApproval}
        pairingHint={bridge.state.pairingHint}
        maybeNeedsLocalNetworkAccess={bridge.state.maybeNeedsLocalNetworkAccess}
        onConnect={bridge.requestPairing}
        onRetry={bridge.retry}
      />
    );
  }
  if (unavailable) {
    return (
      <p className="break-keep text-sm text-warn" role="status">
        {unavailable === "wrong_carrier"
          ? "연결된 도우미가 다른 작업을 진행 중입니다. 그 작업을 마친 뒤 다시 시도해 주세요."
          : "내 PC의 도우미와 연결하지 못했습니다. 도우미를 실행한 뒤 다시 시도해 주세요."}
      </p>
    );
  }
  if (error) {
    return <p className="break-keep text-sm text-warn" role="status">{error}</p>;
  }
  if (!view) {
    return <p className="text-sm text-muted" role="status">{starting ? "판매자센터 화면을 준비하는 중…" : "도우미와 연결하는 중…"}</p>;
  }
  const terminal = isTerminalRunStatus(view.status);
  return (
    <div className="space-y-3" data-testid="guided-acquisition-run">
      {view.currentStep && !terminal && view.status !== "WAITING_FOR_HUMAN" ? (
        <p className="break-keep text-sm text-ink">{resolveCopy(view.currentStep.copyKey, view.currentStep.copyParams)}</p>
      ) : null}
      {view.status === "WAITING_FOR_HUMAN" ? <HumanCheckpointCard run={view} onCommand={send} /> : null}
      {view.status === "COMPLETED" ? (
        <p className="break-keep text-sm text-ink" role="status">리뷰 가져오기가 끝났습니다. 이어서 확인하겠습니다.</p>
      ) : null}
      {!terminal ? (
        <ActionWindowControlPanel run={view} onCommand={send} exclude={view.status === "WAITING_FOR_HUMAN" ? CHECKPOINT_COMMANDS : []} />
      ) : null}
    </div>
  );
}



/**
 * The NAVER export started from a conversation — routed through the TRUSTED `import/naver` carrier (Acceptance
 * Closure §4, option B): the same live driver, download detection and launch-bound ingest the onboarding import
 * uses, so the rows it writes carry `SELLER_CENTER_EXPORT` provenance with the launch binding that makes them
 * marketplace objects. Nothing new is hosted: the conversation MINTS the bounded launch the carrier already
 * understands, on a plan that covers the period that has arrived (an existing DRAFT/ACTIVE plan is reused and
 * carried forward; otherwise a plan for this month is created).
 *
 * Order: pair → attach → plan → extend (idempotent) → mint the next segment → ONE `START_RUN` → the run's own
 * `COMPLETED` resumes the turn. A refused start hands the unspent ticket back. The seller performs NAVER's own
 * confirmations in their window; nothing here clicks, downloads or submits for them.
 */
function NaverGuidedImportRun({
  accountId,
  onCompleted,
  onRestart,
  inject,
}: {
  accountId: string;
  onCompleted: () => void;
  /** Ask the card for a brand-new run. Offered only once this one has terminated. */
  onRestart?: () => void;
  inject?: GuidedImportRuntime;
}) {
  const bridge = useBridge(!inject, { autoPair: true });
  const paired = !!inject || bridge.state.phase === "paired";
  const { snapshot, unavailable, refused, ensureRuntime, send } = useGuidedImport(inject);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const startedRef = useRef(false);
  /** See `GuidedAcquisitionRun` above: an attempt in flight vs a `START_RUN` actually handed over. */
  const committedRef = useRef(false);
  const completedRef = useRef(false);

  /**
   * Start once per mounted card, and never lock the card out of starting at all — the 2026-09-02 defect, and
   * the same repair as its sibling above.
   */
  useEffect(() => {
    if (!paired || startedRef.current || committedRef.current) return;
    startedRef.current = true;
    let live = true;
    setStarting(true);
    void (async () => {
      try {
        // Attach BEFORE minting: a refused attach must not spend a single-use ticket.
        const runtime = await ensureRuntime();
        if (!runtime || !live) return;
        // **The plan is the server's business, not the seller's** (Continuity v1 §2). One call finds or
        // creates it, carries it to today, and authorizes the next run — from the period this account has
        // actually verified. The four-request stitch this replaces guessed the period from the calendar and
        // is what put 「구간」, 「병합」 and a date picker in a seller's way.
        const launch = await api.launchNextReviewImportForAccount(accountId);
        // **The words the seller reads inside their SmartStore window.**
        //
        // Without this the runtime renders NO in-page panel at all (`ImportSegmentSession.queuePanelRender`
        // returns early with no pack) — which is what the 2026-09-02 live sitting hit: rings appeared on the
        // right controls and nothing on that screen said what to do, why the run had stopped, or offered the
        // recovery. The runtime authors no sentence of its own by design, so a lane that does not send the
        // pack is a lane with no guidance. The onboarding card has always sent it; this one never did.
        const detail = launch.planId ? await api.getReviewImportPlan(launch.planId).catch(() => null) : null;
        runtime.setGuidancePack(
          buildImportGuidancePack(
            detail ? continuationAfterNext(detail.segments, launch.segmentId ?? detail.nextSegmentId) : null,
          ),
        );
        try {
          // From here the attempt is COMMITTED: a ticket is spent-or-spendable and a command is on the wire,
          // so no later invocation of this effect may start another.
          committedRef.current = true;
          await runtime.start({ launchRef: launch.launchRef, kind: launch.kind });
        } catch (e) {
          committedRef.current = false;
          await api.expireReviewImportLaunch(launch.launchRef).catch(() => undefined);
          throw e;
        }
      } catch {
        if (live) setError("판매자센터 화면을 준비하지 못했습니다. 아래 다른 방법으로 진행할 수 있습니다.");
      } finally {
        if (live) setStarting(false);
      }
    })();
    return () => {
      live = false;
      // An attempt that was torn down before it committed did not start anything, so the next invocation of
      // this effect must be allowed to try. Leaving this set is what made the card permanently dead.
      if (!committedRef.current) startedRef.current = false;
    };
  }, [paired, ensureRuntime, accountId]);

  useEffect(() => {
    if (snapshot?.status === "COMPLETED" && !completedRef.current) {
      completedRef.current = true;
      onCompleted();
    }
  }, [snapshot?.status, onCompleted]);

  if (!paired) {
    return (
      <AgentPairingPanel
        phase={bridge.state.phase}
        confirmationCode={bridge.state.confirmationCode}
        confirmUrl={bridge.state.confirmUrl}
        attestedApproval={bridge.state.attestedApproval}
        pairingHint={bridge.state.pairingHint}
        maybeNeedsLocalNetworkAccess={bridge.state.maybeNeedsLocalNetworkAccess}
        onConnect={bridge.requestPairing}
        onRetry={bridge.retry}
      />
    );
  }
  if (unavailable) {
    return (
      <p className="break-keep text-sm text-warn" role="status">
        {unavailable === "wrong_carrier"
          ? "연결된 도우미가 다른 작업을 진행 중입니다. 그 작업을 마친 뒤 다시 시도해 주세요."
          : "내 PC의 도우미와 연결하지 못했습니다. 도우미를 실행한 뒤 다시 시도해 주세요."}
      </p>
    );
  }
  if (error) {
    return <p className="break-keep text-sm text-warn" role="status">{error}</p>;
  }
  if (!snapshot) {
    return <p className="text-sm text-muted" role="status">{starting ? "판매자센터 화면을 준비하는 중…" : "도우미와 연결하는 중…"}</p>;
  }
  const terminal = ["COMPLETED", "FAILED", "CANCELLED", "OPERATOR_REPORTED"].includes(snapshot.status);
  return (
    <div className="space-y-3" data-testid="guided-import-run">
      {snapshot.step && !terminal ? (
        <p className="break-keep text-sm text-ink">{resolveCopy(snapshot.step.copyKey, snapshot.step.copyParams)}</p>
      ) : null}
      {/* **A stopped run is described by `blockerView`, never by `resolveCopy`.**

          `resolveCopy` answers an unknown key with `COPY_FALLBACK` — 「안내를 준비하고 있어요」 — so on
          2026-09-02 a terminal `RUNTIME_FAULT` told the seller the run was being prepared while it had already
          died. `blockerView` is the lookup whose fallback is honest ("진행이 멈췄어요"), and it is the same one
          the recovery card uses, so the two screens now say the same thing about the same run. */}
      {snapshot.blocker ? (
        <p className="break-keep text-sm text-warn" role="status">
          {blockerView(snapshot.blocker.code).title} · {blockerView(snapshot.blocker.code).body}
        </p>
      ) : null}
      {snapshot.status === "COMPLETED" ? (
        <p className="break-keep text-sm text-ink" role="status">리뷰 가져오기가 끝났습니다. 이어서 확인하겠습니다.</p>
      ) : null}
      {/* A run that ENDED without finishing still has somewhere to go. `COMPLETED` deliberately does not
          offer this — that run's next step is the conversation resuming, not another import. */}
      {terminal && snapshot.status !== "COMPLETED" && onRestart ? (
        <div className="flex flex-wrap items-center gap-3">
          <Btn variant="outline" onClick={onRestart} data-testid="guided-import-restart">다시 시도</Btn>
          {/* A stopped run's second exit. The seller who has just been told the run ended needs the screen
              that can pick a different period or abandon the plan, and until now nothing in the product
              pointed at it — it was reachable only by typing the URL (2026-09-02). */}
          <Link to="/connect/review-history" className="text-sm font-semibold text-brand-700 hover:underline">
            기간을 다시 고르기
          </Link>
        </div>
      ) : null}
      {/* A press that did nothing has to say so. Before this, `send` dropped a command the view did not allow
          without writing anything anywhere, and a runtime rejection came back on the wire and was discarded —
          so the seller pressed, nothing moved, and no surface could tell them why. */}
      {refused ? (
        <p className="break-keep text-sm text-warn" role="status" data-testid="guided-import-refused">
          {refused.cause === "NOT_ALLOWED_NOW"
            ? "지금은 이 동작을 할 수 없습니다. 화면이 바뀌면 다시 시도해 주세요."
            : "요청이 처리되지 않았습니다. 화면을 새로 고친 뒤 다시 시도해 주세요."}
        </p>
      ) : null}
      {!terminal ? (
        <div className="flex flex-wrap gap-2">
          {/* The label is the STEP's, not the run's. `REQUEST_STEP_RECHECK` is one command that means a
              different thing at every barrier — "시작일 입력했어요", "기간이 같아요", "엑셀 다운로드
              눌렀어요" — and this card used to hardcode the download one for all of them. Observed live on
              2026-09-01: at the range-confirm step, before anything had been downloaded, the only control on
              screen claimed the seller had downloaded a file. `recheckLabel` is the same lookup the in-page
              panel already used, so the two windows now say the same word. */}
          {snapshot.allowedCommands.includes("REQUEST_STEP_RECHECK") ? (
            <Btn onClick={() => send("REQUEST_STEP_RECHECK")}>
              {recheckLabel({ copyKey: snapshot.step?.copyKey ?? null, blockerCode: snapshot.blocker?.code ?? null })}
            </Btn>
          ) : null}
          {snapshot.allowedCommands.includes("CANCEL_RUN") ? (
            <Btn variant="outline" onClick={() => send("CANCEL_RUN")}>그만두기</Btn>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
