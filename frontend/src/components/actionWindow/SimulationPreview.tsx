import {
  SIM_SCENARIO_NAMES,
  createSimulatedSource,
  type SimScenarioName,
} from "../../lib/actionWindow/simulatedSource";
import {
  activateSimulation,
  stepSimulation,
  stopSimulation,
} from "../../lib/actionWindow/operationsStore";

const SIM_LABEL: Record<SimScenarioName, string> = {
  "sim-duplicate": "중복 수신",
  "sim-stale-view": "이전 상태 수신",
  "sim-out-of-order": "순서 어긋남",
  "sim-snapshot-restore": "스냅샷 복원",
  "sim-stale-command": "명령 충돌",
  "sim-offline-reconnect": "연결 끊김·복구",
};

/**
 * DEV-ONLY UI-resilience simulation controls (FE-2.5). Rendered only inside the
 * `isFixturePreviewEnabled()` gate on both the home and the run detail, so the
 * production build tree-shakes this component AND the simulated source it
 * constructs. The scenarios are UI resilience simulations, not Runtime behavior.
 */
export function SimulationPreview({
  simulation,
  simulationRemaining,
}: {
  simulation: SimScenarioName | null;
  simulationRemaining: number;
}) {
  return (
    <div className="mt-3 border-t border-dashed border-line pt-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        수신 안정성 시뮬레이션 (개발용)
      </p>
      <div className="flex flex-wrap gap-1.5">
        {SIM_SCENARIO_NAMES.map((name) => {
          const active = name === simulation;
          return (
            <button
              key={name}
              type="button"
              aria-pressed={active}
              onClick={() => activateSimulation(name, createSimulatedSource(name))}
              className={
                "rounded-lg px-3 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 " +
                (active
                  ? "bg-ink text-white"
                  : "border border-line bg-surface text-muted hover:bg-surface/70")
              }
            >
              {SIM_LABEL[name]}
            </button>
          );
        })}
      </div>
      {simulation !== null ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={stepSimulation}
            disabled={simulationRemaining === 0}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            다음 이벤트 <span aria-hidden="true">▶</span> ({simulationRemaining})
          </button>
          <button
            type="button"
            onClick={stopSimulation}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-muted transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            시뮬레이션 종료
          </button>
        </div>
      ) : null}
    </div>
  );
}
