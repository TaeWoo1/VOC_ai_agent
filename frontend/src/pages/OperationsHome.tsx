import { useMemo } from "react";
import { HOME_SCENARIO_NAMES, type HomeScenarioName } from "../lib/actionWindow/homeFixtures";
import {
  dispatchOperationsCommand,
  loadHomeScenario,
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
import { PageHeader } from "../components/PageHeader";
import { WorkbenchLayout } from "../components/WorkbenchLayout";
import { ActiveRunCard } from "../components/actionWindow/ActiveRunCard";
import { ReviewWorkCard } from "../components/actionWindow/ReviewWorkCard";
import { ConnectionBanner } from "../components/actionWindow/ConnectionBanner";
import { SimulationPreview } from "../components/actionWindow/SimulationPreview";
import { BridgeDiagnostics } from "../components/actionWindow/BridgeDiagnostics";
import { RecentActivityList } from "../components/actionWindow/RecentActivityList";
import { ImportHistoryList } from "../components/actionWindow/ImportHistoryList";
import { OperationsWorklist } from "../components/OperationsWorklist";

/**
 * Run statuses after which the backend may hold rows the worklist has not seen.
 *
 * COMPLETED is the one that matters — an export landed. FAILED and CANCELLED are included because a
 * run can fail AFTER a partial ingest (`PARTIAL` is a real import outcome), so treating them as
 * "nothing changed" would leave the seller looking at a list that silently predates their own work.
 * The in-flight statuses are deliberately absent: nothing has reached the backend yet, so refetching
 * would spend requests redrawing the same list.
 */
const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

/** Stable small integer from a runId — a changed value is the signal; its magnitude means nothing. */
function hashRunId(runId: string): number {
  let hash = 0;
  for (let i = 0; i < runId.length; i += 1) {
    hash = (hash * 31 + runId.charCodeAt(i)) | 0;
  }
  return hash;
}

const HOME_SCENARIO_LABEL: Record<HomeScenarioName, string> = {
  "home-empty": "처음 (기록 없음)",
  "home-active-running": "진행 중",
  "home-active-checkpoint": "확인 필요",
  "home-active-paused": "일시정지",
  "home-completed-just-now": "방금 완료",
  "home-with-history": "기록만 있음",
};

/**
 * FE-2 Operations-agent home (/operations) — where the seller sees what the
 * operations agent is doing before drilling into the run detail
 * (/operations/current). Mock/fixture-driven; shares state with the detail page
 * via the operations store.
 */
export function OperationsHome() {
  useBridgeBoot(); // FE-3: opt-in live Bridge connection (no-op without VITE_AW_BRIDGE=1)
  const state = useOperationsStore();
  const {
    run,
    recentRuns,
    connection,
    retryPending,
    sourceMode,
    homeScenario,
    simulation,
    simulationRemaining,
  } = state;
  const note = useOperationsNote();
  const reconnect = useBridgeReconnect(); // FE-4: manual live-Bridge reconnect
  const connected = connection === "connected";
  // Changes only when a run SETTLES, not on every revision: an in-flight run has not handed
  // anything to the backend yet, so refetching mid-run would spend requests to redraw the same list.
  const worklistRefreshKey = useMemo(
    () => (run !== null && TERMINAL_RUN_STATUSES.has(run.status) ? hashRunId(run.runId) : 0),
    [run],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* "운영 에이전트" wording lives in page copy only (IA decision) — nav keeps 리뷰 운영. */}
      <PageHeader
        title="리뷰 운영"
        description="운영 에이전트가 리뷰 내려받기 같은 반복 작업을 단계별로 대신 진행해요. 꼭 필요한 순간에만 확인을 요청해요."
      />

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
            {HOME_SCENARIO_NAMES.map((name) => {
              const active = name === homeScenario && simulation === null;
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={active}
                  onClick={() => loadHomeScenario(name)}
                  className={
                    "rounded-lg px-3 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 " +
                    (active
                      ? "bg-ink text-white"
                      : "border border-line bg-surface text-muted hover:bg-surface/70")
                  }
                >
                  {HOME_SCENARIO_LABEL[name]}
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

      {/* Review-ops workbench: the current task/state on the left, the seller's own import
          history as a side rail (stacks below on mobile). Progressive disclosure stays at
          the page level — the no-run start card vs. the active-run summary.

          The rail reads PERSISTED imports, not this session's runs: `recentRuns` lives in
          browser memory, so it starts empty and vanishes on reload — yesterday's import left no
          trace anywhere the seller looks. The session list is kept as what it always was, a DEV
          fixture-preview affordance, and is shown only under the fixture-preview gate. */}
      <WorkbenchLayout
        body={
          <>
            {run === null ? (
              <ReviewWorkCard
                connected={connected}
                onStart={() => dispatchOperationsCommand("START_RUN")}
              />
            ) : (
              <ActiveRunCard
                run={run}
                onStartNew={() => dispatchOperationsCommand("START_RUN")}
                actionsEnabled={connected}
              />
            )}
            {/* The work itself, on the page named for it. It belongs in `body` and not the rail:
                the worklist is what the seller came to do, and the import history beside it is the
                record of how it got here. Mobile stacks the rail after the body, so the work stays
                above the record on both. */}
            {/* Bumped when a run reaches a terminal, so the list below an import reflects it —
                the completion copy points at this section by position ("아래"), and a stale list
                would make that sentence untrue the one time a seller is certain to read it. */}
            <OperationsWorklist refreshKey={worklistRefreshKey} />
          </>
        }
        rail={
          <div className="flex flex-col gap-4">
            <ImportHistoryList />
            {isFixturePreviewEnabled() && sourceMode === "fixture" ? (
              <RecentActivityList items={recentRuns} />
            ) : null}
          </div>
        }
      />
    </div>
  );
}
