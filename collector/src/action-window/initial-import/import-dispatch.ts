/**
 * **Shared import dispatch service (ISOLATED, v2).** The single place that mints an import run identity
 * and assembles {@link ImportSegmentEngine} + {@link ImportSegmentSession} over a v2 transport, so the
 * thin adapters — the Bridge endpoint (`bridge/initial-import-endpoint.ts`) and any gated CLI — share ONE
 * assembly. The isolated mirror of `reply-dispatch.ts`, leaving the audited v1 export runtime and its
 * `.operation-runs/` store untouched.
 *
 * Run identity is Runtime-assigned (opaque `run_<hex>`), never derived from an account and never invented
 * by the frontend. What the frontend supplies is the launch ref inside `START_RUN`; the server resolves it
 * to a segment and its required window.
 *
 * **The driver is INJECTED and there is no default.** A default would inevitably be the fixture driver,
 * and a fixture driver reaching the product path would report imports that never happened. The production
 * wiring in `cli/local-agent.ts` passes the LIVE driver; the fixture is reachable only from tests.
 */
import { randomBytes } from "node:crypto";
import type { AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import { DISCOVERY_TOTAL_STEPS } from "./discovery-stages";
import { ImportDiscoveryEngine, type DiscoveryClock } from "./discovery-engine";
import { ImportDiscoverySession } from "./discovery-session";
import { ImportSegmentEngine, type ImportClock } from "./import-engine";
import { ImportSegmentSession } from "./import-session";
import type { ImportDiscoveryDriver, ImportProbeDriver, RequiredRange } from "./import-driver";
import { IMPORT_RUN_SCHEMA_VERSION, saveImportRun, type ImportRunRecord } from "./import-run-store";

export { defaultImportRunDirFor, recoverImportRuns } from "./import-run-store";

/** Runtime-assigned opaque run identity — same format and source as the other two runtimes. */
export function mintImportRunId(): string {
  return `run_${randomBytes(6).toString("hex")}`;
}

/** A synthetic monotonic marker generator — deliberately NOT a wall-clock read. */
export function makeImportRunMarker(): () => string {
  let n = 0;
  return () => `import-run.${String((n += 1)).padStart(6, "0")}`;
}

export interface ImportRunAssembly {
  runId: string;
  engine: ImportSegmentEngine;
  session: ImportSegmentSession;
}

export interface ImportDispatchConfig {
  runId: string;
  /** Semantic channel code (e.g. `naver`). */
  channelCode: string;
  /** Opaque 16-hex single-use authorization for THIS segment. Never persisted, never emitted. */
  importRef: string;
  /** The window this segment must cover, resolved server-side from the launch ref. */
  required: RequiredRange;
  /** Injected driver. No default on purpose — see the module note. */
  driver: ImportProbeDriver;
  /** When set, the sanitized run marker is persisted after every transition. */
  persistDir?: string;
  /** Synthetic monotonic marker source for the persisted `updatedAt` (never wall-clock). */
  now?: () => string;
  clock?: ImportClock;
}

function recordFrom(engine: ImportSegmentEngine, now: () => string): ImportRunRecord {
  const view = engine.view();
  const artifactRef = engine.detectedArtifactRef();
  return {
    schemaVersion: IMPORT_RUN_SCHEMA_VERSION,
    runId: view.runId,
    channelCode: view.channelCode,
    stage: engine.currentStage(),
    artifactDetected: artifactRef !== null,
    // Only the opaque artifact reference — never the launch ref, which authorizes an ingest and so is
    // never written to disk (see import-run-store's note on why that rules out resumption).
    ...(artifactRef ? { artifactRef } : {}),
    abandoned: false,
    updatedAt: now(),
  };
}

/**
 * Tell a driver how many steps THIS run has, for the headed diagnostic overlay's badge.
 *
 * Optional capability, not part of either driver interface: it affects a dev-only badge and nothing that is
 * clicked, so a driver without it is fully usable. `null` restores the driver's own default — needed because
 * one driver instance serves every run in a sequence, and a five-step discovery must not leave its denominator
 * behind on the eight-step segment run that follows.
 */
function setBadgeTotalSteps(driver: unknown, totalSteps: number | null): void {
  const badged = driver as { setBadgeTotalSteps?: (n: number | null) => void };
  badged.setBadgeTotalSteps?.(totalSteps);
}

export interface DiscoveryRunAssembly {
  runId: string;
  engine: ImportDiscoveryEngine;
  session: ImportDiscoverySession;
}

export interface DiscoveryDispatchConfig {
  runId: string;
  channelCode: string;
  /** Opaque 16-hex single-use authorization for THIS discovery. Never persisted, never emitted. */
  discoveryRef: string;
  driver: ImportDiscoveryDriver;
  clock?: DiscoveryClock;
}

/**
 * Assemble the range-discovery run.
 *
 * **Not persisted, and that is the point.** The segment assembly writes a sanitized run marker so a restart
 * can ABANDON an interrupted run honestly. A discovery run has nothing worth recovering: it produced no
 * export window, cost the seller no marketplace action they cannot repeat, and its whole output is a single
 * server-side plan creation that either happened or did not. Writing a marker would add a file whose only use
 * would be to describe a run nobody can resume — resumption needs the launch ref on disk, which is exactly
 * what this runtime refuses to do.
 */
export function assembleDiscoveryRun(
  transport: AwServerTransport,
  cfg: DiscoveryDispatchConfig,
): DiscoveryRunAssembly {
  const engine = new ImportDiscoveryEngine(
    { runId: cfg.runId, channelCode: cfg.channelCode, discoveryRef: cfg.discoveryRef },
    cfg.clock ? { clock: cfg.clock } : undefined,
  );
  // Keep the headed diagnostic badge's denominator honest for THIS run kind, when the driver has one.
  setBadgeTotalSteps(cfg.driver, DISCOVERY_TOTAL_STEPS);
  const session = new ImportDiscoverySession(engine, cfg.driver, transport);
  return { runId: cfg.runId, engine, session };
}

export function assembleImportRun(
  transport: AwServerTransport,
  cfg: ImportDispatchConfig,
): ImportRunAssembly {
  const engine = new ImportSegmentEngine(
    {
      runId: cfg.runId,
      channelCode: cfg.channelCode,
      importRef: cfg.importRef,
      required: cfg.required,
    },
    cfg.clock ? { clock: cfg.clock } : undefined,
  );
  const now = cfg.now ?? makeImportRunMarker();
  const persistDir = cfg.persistDir;
  // Back to this driver's own default: a preceding discovery run in the same sitting set its own.
  setBadgeTotalSteps(cfg.driver, null);
  const session = new ImportSegmentSession(
    engine,
    cfg.driver,
    transport,
    cfg.required,
    persistDir ? { onStatePublished: () => saveImportRun(persistDir, recordFrom(engine, now)) } : undefined,
  );
  return { runId: cfg.runId, engine, session };
}
