import { Link } from "react-router-dom";
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

const HOME_SCENARIO_LABEL: Record<HomeScenarioName, string> = {
  "home-empty": "처음 (기록 없음)",
  "home-active-running": "진행 중",
  "home-active-checkpoint": "확인 필요",
  "home-active-paused": "일시정지",
  "home-completed-just-now": "방금 완료",
  "home-with-history": "기록만 있음",
};

/**
 * 리뷰 수집 workbench (`/connect/imports`) — where the seller runs a review acquisition (Action Window:
 * the seller clicks export in their own seller-center window, SellerOps detects and ingests) and sees
 * what each import brought, before drilling into the run detail (`/connect/imports/current`). Shares
 * state with the detail page via the operations store.
 *
 * Collection and record only, since product assembly A6. Reading, deciding and replying to reviews
 * happens on the 리뷰 screen (`/reviews`), which this page points at; the worklist that used to sit
 * here moved there so review work has one home and one count.
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
  // Commands are offered only where something real (a live Bridge) — or the developer's fixture
  // preview — is behind them. On the product surface with no agent the workbench is read-only:
  // the fixture source would otherwise "start" a scripted demo run and pass it off as the seller's.
  const liveActions = sourceMode === "bridge" || isFixturePreviewEnabled();
  const connected = connection === "connected" && liveActions;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="리뷰 수집"
        description="판매자센터에서 리뷰 파일을 내려받는 작업을 단계별로 안내하고, 지금까지 가져온 기록을 보여 줍니다. 리뷰를 읽고 답변하는 일은 리뷰 화면에서 합니다."
        action={
          <Link
            to="/reviews"
            className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            리뷰 화면으로
          </Link>
        }
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

      {!liveActions ? (
        <p role="note" className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm text-muted">
          로컬 에이전트가 연결되어 있지 않아 지금은 수집을 시작할 수 없습니다. 지금까지 가져온 기록은 아래에서 볼 수 있어요.
        </p>
      ) : null}

      {/* Collection workbench: the current task/state on the left, the seller's own import history
          as a side rail (stacks below on mobile). Progressive disclosure stays at the page level —
          the no-run start card vs. the active-run summary.

          The rail reads PERSISTED imports, not this session's runs: `recentRuns` lives in browser
          memory, so it starts empty and vanishes on reload — yesterday's import left no trace
          anywhere the seller looks. The session list is kept as what it always was, a DEV
          fixture-preview affordance, and is shown only under the fixture-preview gate. */}
      <WorkbenchLayout
        body={
          run === null ? (
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
          )
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
