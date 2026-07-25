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
import { ImportSegmentEngine, type ImportClock } from "./import-engine";
import { ImportSegmentSession } from "./import-session";
import type { ImportProbeDriver, RequiredRange } from "./import-driver";
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
  const session = new ImportSegmentSession(
    engine,
    cfg.driver,
    transport,
    cfg.required,
    persistDir ? { onStatePublished: () => saveImportRun(persistDir, recordFrom(engine, now)) } : undefined,
  );
  return { runId: cfg.runId, engine, session };
}
