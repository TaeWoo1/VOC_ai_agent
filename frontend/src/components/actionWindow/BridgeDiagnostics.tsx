import { channelLabel } from "../../lib/actionWindow/copy";
import { describeBridgeDiagnostics } from "../../lib/actionWindow/diagnostics";
import { isBridgeModeEnabled } from "../../lib/actionWindow/devMode";
import { isBridgeBootAttempted } from "../../lib/actionWindow/bridgeSource";
import type { OperationsState } from "../../lib/actionWindow/operationsStore";

const VERDICT_TONE: Record<string, string> = {
  live: "border-good/40 bg-good/5 text-good",
  "fixture-fallback": "border-warn/40 bg-warn/5 text-warn",
  "fixture-demo": "border-line bg-canvas text-muted",
};

/**
 * FE-5 DEV-only sanitized live-bridge diagnostics. Rendered on both the operations
 * home and the run detail ONLY inside the page-level
 * `isFixturePreviewEnabled() && isBridgeModeEnabled()` gate — the same dead-branch
 * pattern as `SimulationPreview`, so the production build tree-shakes this
 * component (and `diagnostics.ts`) out entirely.
 *
 * It exists so that, when we run a real paired local agent, we can confirm at a
 * glance whether Operations is truly on the live Bridge or fell back to the
 * fixture. Every value shown is a sanitized primitive — source mode, connection
 * literal, booleans, a plain integer revision, and the channel *display label*
 * (never the raw code, runId, URL, token, or wire frame): the formatter is handed
 * primitives only, so it structurally cannot leak an identifier.
 */
export function BridgeDiagnostics({ state }: { state: OperationsState }) {
  const run = state.run;
  const view = describeBridgeDiagnostics({
    sourceMode: state.sourceMode,
    connection: state.connection,
    bridgeModeEnabled: isBridgeModeEnabled(),
    bootAttempted: isBridgeBootAttempted(),
    retryPending: state.retryPending,
    connectionTrail: state.connectionTrail,
    connectionChangeCount: state.connectionChangeCount,
    revision: run?.revision ?? null,
    channelLabel: run ? channelLabel(run.channelCode) : null,
    runBound: run !== null,
  });

  return (
    <section
      aria-label="브리지 진단 (개발용)"
      className="rounded-2xl border-2 border-dashed border-line bg-canvas p-3"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        🔎 브리지 진단 · 개발용 · 실제 화면에는 표시되지 않아요
      </p>
      <p
        className={
          "mb-3 inline-block rounded-lg border px-2.5 py-1 text-xs font-semibold " +
          (VERDICT_TONE[view.verdict] ?? VERDICT_TONE["fixture-demo"])
        }
      >
        {view.verdictLabel}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {view.fields.map((field) => (
          <div key={field.label} className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0 text-muted">{field.label}</dt>
            <dd className="min-w-0 break-keep text-right font-mono text-ink">{field.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
