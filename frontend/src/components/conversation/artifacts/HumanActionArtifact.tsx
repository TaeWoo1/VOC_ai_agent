import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { HumanActionRequiredArtifact as HumanAction } from "../../../lib/conversation/types";
import { Btn, BtnLink } from "../../ui/Btn";
import { api } from "../../../lib/apiClient";
import { analytics } from "../../../lib/analytics";
import { resolveCopy } from "../../../lib/actionWindow/copy";
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
  REVIEW_IMPORT: "최신 리뷰 가져오기",
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

/** The card's title: the channel's own step, in four words — 「네이버 최신 리뷰 가져오기」 / 「네이버 리뷰 · 8월 20일 기준」. */
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
  const [engaged, setEngaged] = useState(false);
  const channel = artifact.channelNameKo ?? artifact.channelCode;
  const canSync = artifact.path === "MANUAL_SYNC" && !!artifact.accountId;
  const guided = GUIDED_PATHS.includes(artifact.path) && !!artifact.accountId ? (artifact.path as GuidedAcquisitionPath) : null;
  const review = artifact.actionType === "REVIEW_IMPORT";
  // The primary's label: an offer says what it does to the list; a required step says what it fetches.
  const primaryLabel = artifact.optional ? "최신 상태로 갱신" : review ? "최신 리뷰 가져오기" : "지금 리뷰 가져오기";

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

  const primary = canSync ? (
    <Btn onClick={startSync} disabled={starting}>{starting ? "시작하는 중…" : primaryLabel}</Btn>
  ) : guided ? (
    !engaged ? <Btn onClick={() => setEngaged(true)}>{primaryLabel}</Btn> : null
  ) : artifact.to ? (
    // The button says the STEP, not 「직접 진행하기」: a seller reading 「답변 기준이 필요합니다」 needs the
    // control to name the thing they are about to add (the same words the 문의 screen uses).
    <BtnLink to={returnTo(artifact.to)} onClick={onOpen}>{LINK_LABEL[artifact.actionType] ?? "직접 진행하기"}</BtnLink>
  ) : null;
  const running = guided != null && engaged && !!artifact.accountId;

  // Compact: title · one reason line · the primary in the header. The guided run's own sentence and controls
  // appear only after the press; 「계속 확인하기」 only when the turn is actually waiting on this step.
  return (
    <ArtifactCard
      title={titleOf(artifact, channel)}
      note={reasonOf(artifact)}
      action={primary}
      testId={artifact.optional ? "human-action-offer" : "human-action-artifact"}
    >
      {running || failed || (artifact.resumable && !artifact.optional) || artifact.fallback?.to ? (
        <div className="space-y-3 px-4 pb-3">
          {running && guided ? <p className="break-keep text-sm text-muted">{GUIDED_SENTENCE[guided]}</p> : null}
          {failed ? <p className="text-sm text-bad">수집을 시작하지 못했습니다. 채널 연결 화면에서 다시 시도해 주세요.</p> : null}

          {guided === "EXPORT_ACTION_WINDOW" && running && artifact.accountId ? (
            <NaverGuidedImportRun
              accountId={artifact.accountId}
              onCompleted={() => {
                analytics.track("human_action_completed", { type: "review_import" });
                onResume();
              }}
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

          {artifact.resumable && !artifact.optional ? (
            <div className="flex flex-wrap items-center gap-2">
              <Btn variant="outline" onClick={onResume}>계속 확인하기</Btn>
            </div>
          ) : null}

          {artifact.fallback?.to ? (
            <p className="text-sm text-muted">
              도우미 없이 진행하려면{" "}
              <Link to={returnTo(artifact.fallback.to)} onClick={onOpen} className="font-semibold text-brand-700 hover:underline">
                {artifact.fallback.label}
              </Link>
            </p>
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
  const completedRef = useRef(false);

  useEffect(() => {
    if (!paired || startedRef.current) return;
    startedRef.current = true;
    let live = true;
    setStarting(true);
    void (async () => {
      try {
        const runtime = await ensureRuntime();
        if (!runtime || !live) return;
        // Connect first, mint second: a refused attach must not spend a single-use ref.
        if (path === "WING_READ_ACTION_WINDOW") {
          const minted = await api.startReviewAcquisitionRun(accountId);
          if (!live) return;
          await runtime.start({ intent: "REVIEW_ACQUISITION", acquisitionRef: minted.acquisitionRef });
        } else {
          await runtime.start({ intent: "EXPORT" });
        }
      } catch {
        if (live) setError("판매자센터 화면을 준비하지 못했습니다. 아래 다른 방법으로 진행할 수 있습니다.");
      } finally {
        if (live) setStarting(false);
      }
    })();
    return () => {
      live = false;
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


/** `YYYY-MM` of today (UTC) — the shortest range the import plan accepts: the current month up to today. */
function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
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
  inject,
}: {
  accountId: string;
  onCompleted: () => void;
  inject?: GuidedImportRuntime;
}) {
  const bridge = useBridge(!inject, { autoPair: true });
  const paired = !!inject || bridge.state.phase === "paired";
  const { snapshot, unavailable, ensureRuntime, send } = useGuidedImport(inject);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const startedRef = useRef(false);
  const completedRef = useRef(false);

  useEffect(() => {
    if (!paired || startedRef.current) return;
    startedRef.current = true;
    let live = true;
    setStarting(true);
    void (async () => {
      try {
        // Attach BEFORE minting: a refused attach must not spend a single-use ticket.
        const runtime = await ensureRuntime();
        if (!runtime || !live) return;
        const plans = await api.listReviewImportPlans(accountId);
        const open = plans.find((p) => p.status === "DRAFT" || p.status === "ACTIVE");
        const planId = open ? open.id : (await api.selectReviewImportRange(accountId, thisMonth())).plan.id;
        // Carry the plan up to today so "new reviews" has a segment to run; idempotent on the server.
        await api.extendReviewImportPlan(planId).catch(() => undefined);
        const launch = await api.launchNextReviewImportSegment(planId);
        try {
          await runtime.start({ launchRef: launch.launchRef, kind: launch.kind });
        } catch (e) {
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
      {snapshot.blocker ? (
        <p className="break-keep text-sm text-warn" role="status">{resolveCopy(`actionWindow.blocker.${snapshot.blocker.code}`)}</p>
      ) : null}
      {snapshot.status === "COMPLETED" ? (
        <p className="break-keep text-sm text-ink" role="status">리뷰 가져오기가 끝났습니다. 이어서 확인하겠습니다.</p>
      ) : null}
      {!terminal ? (
        <div className="flex flex-wrap gap-2">
          {snapshot.allowedCommands.includes("REQUEST_STEP_RECHECK") ? (
            <Btn onClick={() => send("REQUEST_STEP_RECHECK")}>내려받기를 마쳤습니다 · 다시 확인</Btn>
          ) : null}
          {snapshot.allowedCommands.includes("CANCEL_RUN") ? (
            <Btn variant="outline" onClick={() => send("CANCEL_RUN")}>그만두기</Btn>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
