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
import { AgentPairingPanel } from "../../reviewImport/AgentPairingPanel";
import { ActionWindowControlPanel } from "../../actionWindow/ActionWindowControlPanel";
import { HumanCheckpointCard, CHECKPOINT_COMMANDS } from "../../actionWindow/HumanCheckpointCard";
import { ArtifactCard } from "./ArtifactCard";
import { useContinueInPanel } from "../useContinueInPanel";

const HEADLINE: Record<HumanAction["actionType"], string> = {
  REVIEW_IMPORT: "새 리뷰를 확인하려면 리뷰 가져오기가 필요합니다",
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

const GUIDED_PATHS: ReadonlyArray<HumanAction["path"]> = ["EXPORT_ACTION_WINDOW", "WING_READ_ACTION_WINDOW"];

/** What the guided run does, per path — the product contract's wording (a bounded set of platform confirmations, not a one-press promise). */
const GUIDED_SENTENCE: Record<GuidedAcquisitionPath, string> = {
  EXPORT_ACTION_WINDOW: "reviewnary가 판매자센터의 리뷰 내려받기 화면과 기간을 준비합니다. 판매자님은 화면이 요구하는 확인만 누르시면, 내려받은 파일을 reviewnary가 읽어 이 질문을 이어서 확인합니다.",
  WING_READ_ACTION_WINDOW: "reviewnary가 판매자센터의 리뷰 화면을 준비합니다. 판매자님은 화면이 요구하는 확인과 페이지 넘기기만 하시면, reviewnary가 그 화면의 리뷰를 읽어 이 질문을 이어서 확인합니다.",
};

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
  connect,
}: {
  artifact: HumanAction;
  onResume: () => void;
  /** Test seam: a runtime supplied here skips pairing and the socket. */
  acquireRuntime?: AcquireRuntime;
  connect?: AcquisitionConnect;
}) {
  const onOpen = useContinueInPanel("HUMAN_ACTION_REQUIRED");
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const channel = artifact.channelNameKo ?? artifact.channelCode;
  const canSync = artifact.path === "MANUAL_SYNC" && !!artifact.accountId;
  const guided = GUIDED_PATHS.includes(artifact.path) && !!artifact.accountId ? (artifact.path as GuidedAcquisitionPath) : null;

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

  return (
    <ArtifactCard title={HEADLINE[artifact.actionType]} testId="human-action-artifact">
      <div className="space-y-3 px-4 pb-3">
        <p className="break-keep text-sm text-muted">
          {channel ? <span className="font-semibold text-ink">{channel} · </span> : null}
          {REASON[artifact.reason]}
        </p>
        {guided ? <p className="break-keep text-sm text-muted">{GUIDED_SENTENCE[guided]}</p> : null}
        {failed ? <p className="text-sm text-bad">수집을 시작하지 못했습니다. 채널 연결 화면에서 다시 시도해 주세요.</p> : null}

        {guided && engaged && artifact.accountId ? (
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

        <div className="flex flex-wrap items-center gap-2">
          {canSync ? (
            <Btn onClick={startSync} disabled={starting}>{starting ? "시작하는 중…" : "지금 리뷰 가져오기"}</Btn>
          ) : guided ? (
            !engaged ? (
              <Btn onClick={() => setEngaged(true)}>지금 {channel ?? "채널"} 리뷰 가져오기</Btn>
            ) : null
          ) : artifact.to ? (
            <BtnLink to={returnTo(artifact.to)} onClick={onOpen}>직접 진행하기</BtnLink>
          ) : null}
          {artifact.resumable ? (
            <Btn variant="outline" onClick={onResume}>계속 확인하기</Btn>
          ) : null}
        </div>

        {artifact.fallback?.to ? (
          <p className="text-sm text-muted">
            도우미 없이 진행하려면{" "}
            <Link to={returnTo(artifact.fallback.to)} onClick={onOpen} className="font-semibold text-brand-700 hover:underline">
              {artifact.fallback.label}
            </Link>
          </p>
        ) : null}
      </div>
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
