/**
 * **Shared reply-submission dispatch service (ISOLATED, v2).** The single place that mints a reply
 * run identity and assembles the {@link ReplyEngine} + {@link ReplySubmitSession} over a v2 transport,
 * so the two thin adapters — the Bridge endpoint (`bridge/reply-submission-endpoint.ts`) and the gated
 * CLI (`cli/run-reply-submission-live-naver.ts`) — share ONE assembly and never duplicate it. It is
 * the isolated mirror of export's `buildActionWindowConfig` / `buildLiveRunDeps`, and it leaves the
 * audited v1 export runtime and its `.operation-runs/` store byte-for-byte untouched.
 *
 * Run identity is Runtime-assigned (opaque `run_<hex>`), never derived from any account and never
 * invented by the FE. The driver is INJECTED, so the default assembly stays synthetic/fixture (no
 * browser); the live `NaverReplySubmitProbeDriver` is reserved for the gate-locked live adapter only.
 *
 * Persistence + restart safety (double-post guard, made concrete): with a `persistDir` the sanitized
 * reply-run marker is saved after every transition into the gitignored `.reply-runs/` store, and restart
 * recovery ({@link recoverReplyRuns}) PARKS any interrupted run — it is NEVER resumed or re-driven.
 */
import { randomBytes } from "node:crypto";
import type { AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import { ReplyEngine } from "./reply-engine";
import { ReplySubmitSession } from "./reply-session";
import type { ReplySubmitProbeDriver } from "./reply-driver";
import type { ReplyTargetHint } from "./reply-surface";
import type { ReplyRunMode } from "./reply-stages";
import { REPLY_RUN_SCHEMA_VERSION, saveReplyRun, type ReplyRunRecord } from "./reply-run-store";

export { defaultReplyRunDirFor, recoverReplyRuns } from "./reply-run-store";

/** Runtime-assigned opaque run identity — same format + source as the export runtime (`run_<12 hex>`). */
export function mintReplyRunId(): string {
  return `run_${randomBytes(6).toString("hex")}`;
}

export interface ReplyRunAssembly {
  runId: string;
  engine: ReplyEngine;
  session: ReplySubmitSession;
}

export interface ReplyDispatchConfig {
  /** Runtime-assigned opaque run identity (mint via {@link mintReplyRunId}). */
  runId: string;
  /** Semantic channel code (e.g. `naver`). */
  channelCode: string;
  /** Opaque 16-hex binding to an approved reply — never text or a review id. */
  submissionRef?: string;
  /**
   * Privacy-safe target metadata for the guided review-row locator. Present → guided 3-step run; absent →
   * legacy composer-only run. Passed to the engine (plan selector) AND to the driver factory (matching
   * input). NEVER persisted or emitted.
   */
  targetHint?: ReplyTargetHint;
  /** Run mode. `ABORT_REHEARSAL` (requires a `targetHint`) makes the submitted terminal unreachable. */
  mode?: ReplyRunMode;
  /** Injected driver factory; synthetic/fixture by default (no browser), live only in the gated adapter. */
  createDriver: (hint?: ReplyTargetHint) => ReplySubmitProbeDriver;
  /** When set, the sanitized reply-run marker is persisted after every transition (required in live mode). */
  persistDir?: string;
  /** Synthetic monotonic marker source for the persisted `updatedAt` (never wall-clock). */
  now?: () => string;
}

/** A synthetic monotonic marker generator — deliberately NOT a wall-clock read. */
export function makeReplyRunMarker(): () => string {
  let n = 0;
  return () => `reply-run.${String((n += 1)).padStart(6, "0")}`;
}

function recordFrom(engine: ReplyEngine, now: () => string): ReplyRunRecord {
  const view = engine.view();
  return {
    schemaVersion: REPLY_RUN_SCHEMA_VERSION,
    runId: view.runId,
    channelCode: view.channelCode,
    stage: engine.currentStage(),
    mode: engine.runMode(),
    planKind: engine.runPlanKind(),
    parked: false,
    updatedAt: now(),
  };
}

/**
 * Assemble a reply-submission run over the given v2 transport. The caller (a Bridge endpoint or the
 * CLI's loopback) owns the transport and the run identity; this wires the engine, session, injected
 * driver, and — when a `persistDir` is present — the R3 persistence hook onto the isolated store.
 */
export function assembleReplyRun(transport: AwServerTransport, cfg: ReplyDispatchConfig): ReplyRunAssembly {
  const engine = new ReplyEngine({
    runId: cfg.runId,
    channelCode: cfg.channelCode,
    ...(cfg.submissionRef ? { submissionRef: cfg.submissionRef } : {}),
    ...(cfg.targetHint ? { targetHint: cfg.targetHint } : {}),
    ...(cfg.mode ? { mode: cfg.mode } : {}),
  });
  const now = cfg.now ?? makeReplyRunMarker();
  const persistDir = cfg.persistDir;
  const session = new ReplySubmitSession(
    engine,
    cfg.createDriver(cfg.targetHint),
    transport,
    persistDir ? { onStatePublished: () => saveReplyRun(persistDir, recordFrom(engine, now)) } : undefined,
  );
  return { runId: cfg.runId, engine, session };
}
