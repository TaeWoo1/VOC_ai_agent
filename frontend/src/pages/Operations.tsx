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
  SECTION_TITLE,
  START_NEW_RUN_LABEL,
} from "../lib/actionWindow/copy";
import { PageHeader } from "../components/PageHeader";
import { WorkbenchLayout } from "../components/WorkbenchLayout";
import { RunStatusBadge } from "../components/actionWindow/RunStatusBadge";
import { EmptyStartCard } from "../components/actionWindow/EmptyStartCard";
import { ConnectionBanner } from "../components/actionWindow/ConnectionBanner";
import { SimulationPreview } from "../components/actionWindow/SimulationPreview";
import { BridgeDiagnostics } from "../components/actionWindow/BridgeDiagnostics";
import { OperationRunTimeline } from "../components/actionWindow/OperationRunTimeline";
import {
  HumanCheckpointCard,
  CHECKPOINT_COMMANDS,
} from "../components/actionWindow/HumanCheckpointCard";
import { ActionWindowControlPanel } from "../components/actionWindow/ActionWindowControlPanel";
import { CompletedResult } from "../components/actionWindow/CompletedResult";
import { BlockerNotice } from "../components/actionWindow/BlockerNotice";

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

/** Compact run-progress bar for the run header band. Accessible (role=progressbar
 *  with an explicit name + value range); the fill width is the only inline style. */
function RunProgressBar({
  completedSteps,
  totalSteps,
}: {
  completedSteps: number;
  totalSteps: number;
}) {
  const pct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  return (
    <span className="flex items-center gap-2">
      <span
        role="progressbar"
        aria-label="단계 진행률"
        aria-valuemin={0}
        aria-valuemax={totalSteps}
        aria-valuenow={completedSteps}
        className="block h-2 w-32 overflow-hidden rounded-full bg-line"
      >
        <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-sm text-muted">
        진행 {completedSteps} / {totalSteps} 단계
      </span>
    </span>
  );
}

/** Review acquisition run detail (`/connect/imports/current`) — the single surface
 *  that renders command controls from `allowedCommands`. State is shared with the
 *  collection workbench (`/connect/imports`) via the operations store. */
export function Operations() {
  useBridgeBoot(); // FE-3: opt-in live Bridge connection (no-op without VITE_AW_BRIDGE=1)
  const state = useOperationsStore();
  const { run, runScenario, connection, retryPending, sourceMode, simulation, simulationRemaining } =
    state;
  const note = useOperationsNote();
  const reconnect = useBridgeReconnect(); // FE-4: manual live-Bridge reconnect
  // Same gate as the workbench: commands only behind a live Bridge or the developer preview (A7).
  const liveActions = sourceMode === "bridge" || isFixturePreviewEnabled();
  const connected = connection === "connected" && liveActions;

  function handleCommand(type: CommandType) {
    dispatchOperationsCommand(type);
  }

  const blocker = run?.blocker ? blockerView(run.blocker.code) : undefined;

  // Dedup: when the human-checkpoint card is shown it already renders the recheck /
  // switch-to-manual actions, so the action rail omits those (and hides entirely if
  // nothing else remains) — no command is offered twice on the same screen.
  const checkpointShown = !!run && connected && run.status === "WAITING_FOR_HUMAN";
  const railControlCommands = run
    ? run.allowedCommands.filter((t) => !(checkpointShown && CHECKPOINT_COMMANDS.includes(t)))
    : [];
  const showControlPanel = connected && (checkpointShown ? railControlCommands.length > 0 : true);

  return (
    <div className="flex flex-col gap-4">
      {run ? (
        <PageHeader
          title={resolveCopy(run.runCopyKey, run.runCopyParams)}
          action={<RunStatusBadge status={run.status} />}
          meta={
            <>
              <span className="text-sm text-muted">채널: {channelLabel(run.channelCode)}</span>
              <RunProgressBar
                completedSteps={run.progress.completedSteps}
                totalSteps={run.progress.totalSteps}
              />
            </>
          }
        />
      ) : (
        <PageHeader
          title="진행 중 작업"
          description="아직 진행 중인 작업이 없어요. 새로 시작할 수 있어요."
        />
      )}

      {/* Fixture/demo preview — DEV-ONLY (never rendered in the production build);
          hidden while a live Bridge source is active (fixture world only). */}
      {isFixturePreviewEnabled() && sourceMode === "fixture" ? (
        <nav
          aria-label="데모 시나리오 (개발용)"
          className="rounded-2xl border-2 border-dashed border-line bg-canvas p-3"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            <span aria-hidden="true">🧪 </span>데모 미리보기 · 개발용 · 실제 화면에는 표시되지 않아요
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
              <span aria-hidden="true">🔌 </span>로컬 에이전트 다시 연결 (개발용)
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
            <span aria-hidden="true">🔌 </span>라이브 연결 중 · 개발용
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

      {/* FE-5 sanitized live-bridge diagnostics — DEV preview only, never in the
          production build. Rendered whenever the DEV preview is on (bridge-live,
          fixture-fallback, AND bridge-off/fixture-demo) so the "브리지 꺼짐" verdict is
          observable; the verdict itself distinguishes the three via `isBridgeModeEnabled`. */}
      {isFixturePreviewEnabled() ? <BridgeDiagnostics state={state} /> : null}

      <p aria-live="polite" className="min-h-[1.25rem] text-sm text-brand-700">
        {note}
      </p>

      <ConnectionBanner
        connection={connection}
        retryPending={retryPending}
        onReconnect={sourceMode === "bridge" ? reconnect : undefined}
      />

      {!liveActions ? (
        <p role="note" className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm text-muted">
          로컬 에이전트가 연결되어 있지 않아 지금은 작업을 시작하거나 조작할 수 없습니다.
        </p>
      ) : null}

      {run === null ? (
        <EmptyStartCard connected={connected} onStart={() => handleCommand("START_RUN")} />
      ) : (
        /* Run workbench: the work area (required action + timeline + result) is the
           body; the persistent controls and next-step live in the action rail
           (beside the body on lg, stacked below on mobile). */
        <WorkbenchLayout
          body={
            <>
              {/* Mobile: read-only. The real operation runs on desktop (local agent + browser). */}
              <p
                role="note"
                className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm text-muted sm:hidden"
              >
                {DESKTOP_ONLY_COPY.readOnlyBanner}
              </p>

              {blocker && run.status !== "WAITING_FOR_HUMAN" ? (
                <BlockerNotice
                  title={blocker.title}
                  body={blocker.body}
                  recoverable={!!run.blocker?.recoverable}
                  variant="standalone"
                />
              ) : null}

              {/* Act-now first: the checkpoint the operator must handle leads the work
                  area on every viewport, with the timeline below as progress context. */}
              {connected && run.status === "WAITING_FOR_HUMAN" ? (
                <HumanCheckpointCard run={run} onCommand={handleCommand} />
              ) : null}

              <OperationRunTimeline run={run} />

              {run.status === "COMPLETED" ? <CompletedResult run={run} /> : null}
            </>
          }
          rail={
            showControlPanel || canStartNewRun(run) ? (
              <>
                {/* Interactive controls are desktop-only; mobile stays read-only; all
                    commands are suppressed while offline. Checkpoint actions are
                    excluded here while the checkpoint card renders them. */}
                {showControlPanel ? (
                  <div className="hidden sm:block">
                    <ActionWindowControlPanel
                      run={run}
                      onCommand={handleCommand}
                      exclude={checkpointShown ? CHECKPOINT_COMMANDS : undefined}
                    />
                  </div>
                ) : null}

                {/* Terminal run: offer the next step here too (start-new is the idle
                    affordance, not a run command; navigation works even offline). */}
                {canStartNewRun(run) ? (
                  <section
                    aria-label={SECTION_TITLE.nextRun}
                    className="rounded-2xl bg-surface p-5 shadow-card"
                  >
                    <h2 className="text-lg font-semibold text-ink">{SECTION_TITLE.nextRun}</h2>
                    <p className="mt-1 text-ink">
                      이 작업은 끝났어요. 새 작업을 시작하거나 수집 화면에서 가져온 기록을 볼 수 있어요.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {connected ? (
                        <button
                          type="button"
                          onClick={() => handleCommand("START_RUN")}
                          className="hidden rounded-xl bg-brand px-4 py-2.5 font-medium text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 sm:inline-block"
                        >
                          {START_NEW_RUN_LABEL}
                        </button>
                      ) : null}
                      <Link
                        to="/connect/imports"
                        className="rounded-xl border border-line bg-surface px-4 py-2.5 font-medium text-ink transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                      >
                        수집 화면으로
                      </Link>
                    </div>
                    <p className="mt-2 text-sm text-muted sm:hidden">{DESKTOP_ONLY_COPY.startNew}</p>
                  </section>
                ) : null}
              </>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
