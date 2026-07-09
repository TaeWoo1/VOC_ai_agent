import { HOME_SCENARIO_NAMES, type HomeScenarioName } from "../lib/actionWindow/homeFixtures";
import {
  dispatchOperationsCommand,
  loadHomeScenario,
} from "../lib/actionWindow/operationsStore";
import { useBridgeBoot, useOperationsNote, useOperationsStore } from "../hooks/useOperationsStore";
import { isBridgeModeEnabled, isFixturePreviewEnabled } from "../lib/actionWindow/devMode";
import { retryBridgeBoot } from "../lib/actionWindow/bridgeSource";
import { ActiveRunCard } from "../components/actionWindow/ActiveRunCard";
import { ConnectionBanner } from "../components/actionWindow/ConnectionBanner";
import { SimulationPreview } from "../components/actionWindow/SimulationPreview";
import { RecentActivityList } from "../components/actionWindow/RecentActivityList";

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
  const { run, recentRuns, connection, sourceMode, homeScenario, simulation, simulationRemaining } =
    useOperationsStore();
  const note = useOperationsNote();
  const connected = connection === "connected";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-16">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-ink">리뷰 운영</h1>
        {/* "운영 에이전트" wording lives in page copy only (IA decision) — nav keeps 리뷰 운영. */}
        <p className="text-muted">
          운영 에이전트가 리뷰 내려받기 같은 반복 작업을 단계별로 대신 진행해요. 꼭 필요한
          순간에만 확인을 요청해요.
        </p>
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
              🔌 로컬 에이전트 다시 연결 (개발용)
            </button>
          ) : null}
        </nav>
      ) : null}

      <p aria-live="polite" className="min-h-[1.25rem] text-sm text-brand-700">
        {note}
      </p>

      <ConnectionBanner connection={connection} />

      {run === null ? (
        <section
          aria-label="시작하기"
          className="rounded-2xl bg-surface p-6 text-center shadow-card"
        >
          <p className="text-lg text-ink">리뷰 내려받기를 시작할 수 있어요.</p>
          <p className="mt-1 text-muted">시작하면 판매자센터 화면에서 단계별로 안내해요.</p>
          {connected ? (
            <button
              type="button"
              onClick={() => dispatchOperationsCommand("START_RUN")}
              className="mt-4 hidden rounded-xl bg-brand px-5 py-3 font-medium text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 sm:inline-block"
            >
              시작
            </button>
          ) : null}
          <p className="mt-4 text-sm text-muted sm:hidden">
            시작은 데스크톱에서 할 수 있어요. 휴대폰에서는 진행 상황만 볼 수 있어요.
          </p>
        </section>
      ) : (
        <ActiveRunCard
          run={run}
          onStartNew={() => dispatchOperationsCommand("START_RUN")}
          actionsEnabled={connected}
        />
      )}

      <RecentActivityList items={recentRuns} />
    </div>
  );
}
