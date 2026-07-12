import { Link } from "react-router-dom";
import type { CommandType } from "../lib/actionWindow/contract";
import { SCENARIO_NAMES, type ScenarioName } from "../lib/actionWindow/fixtures";
import {
  canStartNewRun,
  dispatchOperationsCommand,
  loadRunScenario,
  returnToFixtureForDev,
} from "../lib/actionWindow/operationsStore";
import {
  useBridgeBoot,
  useBridgeReconnect,
  useOperationsNote,
  useOperationsStore,
} from "../hooks/useOperationsStore";
import { isBridgeModeEnabled, isFixturePreviewEnabled } from "../lib/actionWindow/devMode";
import { retryBridgeBoot } from "../lib/actionWindow/bridgeSource";
import {
  blockerView,
  channelLabel,
  resolveCopy,
  DESKTOP_ONLY_COPY,
} from "../lib/actionWindow/copy";
import { RunStatusBadge } from "../components/actionWindow/RunStatusBadge";
import { EmptyStartCard } from "../components/actionWindow/EmptyStartCard";
import { ConnectionBanner } from "../components/actionWindow/ConnectionBanner";
import { SimulationPreview } from "../components/actionWindow/SimulationPreview";
import { BridgeDiagnostics } from "../components/actionWindow/BridgeDiagnostics";
import { OperationRunTimeline } from "../components/actionWindow/OperationRunTimeline";
import { HumanCheckpointCard } from "../components/actionWindow/HumanCheckpointCard";
import { ActionWindowControlPanel } from "../components/actionWindow/ActionWindowControlPanel";
import { CompletedResult } from "../components/actionWindow/CompletedResult";

const SCENARIO_LABEL: Record<ScenarioName, string> = {
  "ready-to-start": "시작 전",
  "starting": "시작 중",
  "human-action-required": "확인 필요",
  "waiting-for-user": "사용자 대기",
  "observing": "확인 중",
  "download-detected": "다운로드 감지",
  "processing": "처리 중",
  "completed": "완료",
  "paused": "일시정지",
  "ui-drift": "화면 변경",
  "login-required": "로그인 필요",
  "failed": "실패",
};

/** FE-1 Review Operations run detail (/operations/current) — the single surface
 *  that renders command controls from `allowedCommands`. State is shared with the
 *  operations home (/operations) via the operations store (FE-2/FE-2.5). */
export function Operations() {
  useBridgeBoot(); // FE-3: opt-in live Bridge connection (no-op without VITE_AW_BRIDGE=1)
  const state = useOperationsStore();
  const { run, runScenario, connection, retryPending, sourceMode, simulation, simulationRemaining } =
    state;
  const note = useOperationsNote();
  const reconnect = useBridgeReconnect(); // FE-4: manual live-Bridge reconnect
  const connected = connection === "connected";

  function handleCommand(type: CommandType) {
    dispatchOperationsCommand(type);
  }

  const blocker = run?.blocker ? blockerView(run.blocker.code) : undefined;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-16">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-ink">
            {run ? resolveCopy(run.runCopyKey, run.runCopyParams) : "진행 중 작업"}
          </h1>
          {run ? <RunStatusBadge status={run.status} /> : null}
        </div>
        {run ? (
          <p className="text-muted">채널: {channelLabel(run.channelCode)}</p>
        ) : (
          <p className="text-muted">아직 진행 중인 작업이 없어요. 새로 시작할 수 있어요.</p>
        )}
      </header>

      {/* Fixture/demo preview — DEV-ONLY (never rendered in the production build);
          hidden while a live Bridge source is active (fixture world only). */}
      {isFixturePreviewEnabled() && sourceMode === "fixture" ? (
        <nav
          aria-label="데모 시나리오 (개발용)"
          className="rounded-2xl border-2 border-dashed border-line bg-canvas p-3"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            🧪 데모 미리보기 · 개발용 · 실제 화면에는 표시되지 않아요
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SCENARIO_NAMES.map((name) => {
              const active = name === runScenario && simulation === null;
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={active}
                  onClick={() => loadRunScenario(name)}
                  className={
                    "rounded-lg px-3 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 " +
                    (active ? "bg-ink text-white" : "border border-line bg-surface text-muted hover:bg-surface/70")
                  }
                >
                  {SCENARIO_LABEL[name]}
                </button>
              );
            })}
          </div>
          <SimulationPreview simulation={simulation} simulationRemaining={simulationRemaining} />
          {/* DEV boot retry: bridge mode is enabled but the boot fell back to the
              fixture (agent off / unpaired) — offer another live attempt. */}
          {isBridgeModeEnabled() ? (
            <button
              type="button"
              onClick={() => void retryBridgeBoot()}
              className="mt-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-muted transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              🔌 로컬 에이전트 다시 연결 (개발용)
            </button>
          ) : null}
        </nav>
      ) : null}

      {/* DEV-only: leave a live/offline Bridge world back to the fixture world
          without a reload (the fixture scenario panel above is hidden in bridge
          mode). Never rendered in the production build. */}
      {isFixturePreviewEnabled() && sourceMode === "bridge" ? (
        <div className="rounded-2xl border-2 border-dashed border-line bg-canvas p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            🔌 라이브 연결 중 · 개발용
          </p>
          <button
            type="button"
            onClick={() => returnToFixtureForDev()}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-muted transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            픽스처로 돌아가기 (개발용)
          </button>
        </div>
      ) : null}

      {/* FE-5 sanitized live-bridge diagnostics — DEV + bridge-mode only (renders
          in both bridge-live and fixture-fallback), never in the production build. */}
      {isFixturePreviewEnabled() && isBridgeModeEnabled() ? (
        <BridgeDiagnostics state={state} />
      ) : null}

      <p aria-live="polite" className="min-h-[1.25rem] text-sm text-brand-700">
        {note}
      </p>

      <ConnectionBanner
        connection={connection}
        retryPending={retryPending}
        onReconnect={sourceMode === "bridge" ? reconnect : undefined}
      />

      {run === null ? (
        <EmptyStartCard connected={connected} onStart={() => handleCommand("START_RUN")} />
      ) : (
        <>
          {/* Mobile: read-only. The real operation runs on desktop (local agent + browser). */}
          <p
            role="note"
            className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm text-muted sm:hidden"
          >
            <span aria-hidden="true">📱 </span>
            {DESKTOP_ONLY_COPY.readOnlyBanner}
          </p>

          {blocker && run.status !== "WAITING_FOR_HUMAN" ? (
            <div role="status" className="rounded-2xl border border-bad/30 bg-bad/5 p-4">
              <p className="font-medium text-ink">
                <span aria-hidden="true">⚠ </span>
                {blocker.title}
                <span className="ml-2 align-middle text-xs text-muted">
                  {run.blocker?.recoverable ? "다시 시도할 수 있어요" : "복구할 수 없어요"}
                </span>
              </p>
              <p className="mt-0.5 text-sm text-muted">{blocker.body}</p>
            </div>
          ) : null}

          {/* Act-now first: the checkpoint the operator must handle leads, with the
              timeline below as supporting progress context. */}
          {connected && run.status === "WAITING_FOR_HUMAN" ? (
            <HumanCheckpointCard run={run} onCommand={handleCommand} />
          ) : null}

          <OperationRunTimeline run={run} />

          {run.status === "COMPLETED" ? <CompletedResult run={run} /> : null}

          {/* Terminal run: offer the next step here too (start-new is the idle
              affordance, not a run command; navigation works even offline). */}
          {canStartNewRun(run) ? (
            <section aria-label="다음 작업" className="rounded-2xl bg-surface p-5 shadow-card">
              <p className="text-ink">
                이 작업은 끝났어요. 새 작업을 시작하거나 홈에서 전체 현황을 볼 수 있어요.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {connected ? (
                  <button
                    type="button"
                    onClick={() => handleCommand("START_RUN")}
                    className="hidden rounded-xl bg-brand px-4 py-2.5 font-medium text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 sm:inline-block"
                  >
                    새 작업 시작
                  </button>
                ) : null}
                <Link
                  to="/operations"
                  className="rounded-xl border border-line bg-surface px-4 py-2.5 font-medium text-ink transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                >
                  홈으로
                </Link>
              </div>
              <p className="mt-2 text-sm text-muted sm:hidden">{DESKTOP_ONLY_COPY.startNew}</p>
            </section>
          ) : null}

          {/* Interactive controls are desktop-only; mobile stays read-only; all
              commands are suppressed while the source is offline/reconnecting. */}
          {connected ? (
            <div className="hidden sm:block">
              <ActionWindowControlPanel run={run} onCommand={handleCommand} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
