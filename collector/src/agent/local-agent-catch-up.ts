/**
 * **Local Agent catch-up integration** (M-Agent-1C2).
 *
 * Connects the merged Local Agent `READY` / catch-up path (M-Agent-1A/1C1) to the
 * EXISTING ESM review capture→upload boundary, without duplicating any capture,
 * upload, dedup, or worker logic. This is orchestration glue only.
 *
 * The catch-up STATE MACHINE + gating (ack-once, one-shot consumption, single-flight,
 * SUCCEEDED→READY / FAILED_RECOVERABLE→DEGRADED / SESSION_LOST→HUMAN_RECONNECT_REQUIRED)
 * lives on `LocalAgentRuntime.runCatchUp` — the single state authority. This module
 * only provides ADAPTERS from the existing capture/upload seam to the injected
 * `CatchUpSyncExecutor`:
 *
 *  - `syntheticCycleCatchUpExecutor` composes the shipped `SyntheticCycle` boundary
 *    (the same capture→upload→delete leg `EsmWorkerRuntime` drives, `esm-worker-runtime.ts`).
 *    The production executor wraps the real leg (`saveValidateUploadDeleteEsmReview`)
 *    behind this same `SyntheticCycle` shape; it stays UNEXECUTED in tests (no browser,
 *    no live ESM, no export click, no download, no upload, no backend write).
 *
 * Sanitization: outcomes are coarse enums + a coarse error category only — never raw
 * review content, seller/account identifiers, filenames, paths, URLs, cookies, tokens,
 * selectors, DOM text, or download metadata. Raw-file lifecycle + deletion behavior
 * are unchanged (they live entirely inside the existing capture/upload leg).
 */

import type { SyntheticCycle, SyntheticCycleOutcome, WorkerContext } from "../esm/esm-worker-runtime";
import type { CatchUpSyncExecutor, CatchUpSyncOutcome } from "./local-agent-runtime";
import type { SanitizedAccountRef } from "./local-agent-state";

/**
 * Map an existing `SyntheticCycle` outcome → a sanitized catch-up outcome:
 *  - `SUCCESS` → `SUCCEEDED` (→ READY)
 *  - everything else (`PARTIAL` / `DOWNLOAD_FAILED` / `UPLOAD_FAILED` / `DELETE_FAILED`)
 *    → `FAILED_RECOVERABLE` (→ DEGRADED, manual retry only).
 *
 * NOTE: the `SyntheticCycle` boundary has no session-loss outcome; an executor that
 * can distinguish a mid-sync auth drop returns `{ kind: "SESSION_LOST" }` directly.
 */
export function syntheticCycleOutcomeToCatchUp(outcome: SyntheticCycleOutcome): CatchUpSyncOutcome {
  switch (outcome) {
    case "SUCCESS":
      return { kind: "SUCCEEDED" };
    case "PARTIAL":
      return { kind: "FAILED_RECOVERABLE", errorCategory: "UNKNOWN" };
    case "DOWNLOAD_FAILED":
      return { kind: "FAILED_RECOVERABLE", errorCategory: "DOWNLOAD_FAILED" };
    case "UPLOAD_FAILED":
      return { kind: "FAILED_RECOVERABLE", errorCategory: "NETWORK" };
    case "DELETE_FAILED":
      return { kind: "FAILED_RECOVERABLE", errorCategory: "UNKNOWN" };
  }
}

/**
 * **The production composition seam.** Adapt the shipped `SyntheticCycle`
 * capture/upload boundary — the EXACT one `EsmWorkerRuntime` drives
 * (`esm-worker-runtime.ts`) — into a `CatchUpSyncExecutor`, injected ONCE into
 * `LocalAgentReconnectService`. The Local Agent runtime owns operational-state
 * recording, so this adapter only runs the cycle ONCE and maps its sanitized
 * outcome — it adds NO parsing, schema, dedup, or upload behavior.
 *
 * The concrete `SyntheticCycle` (the real capture→click→download→
 * `saveValidateUploadDeleteEsmReview`→delete leg) is INJECTED by the same live-wiring
 * slice that wires the ESM worker's cycle (deferred, 1.5C/1.5D) — this module never
 * constructs or executes it. In tests `cycle` is a fake and is invoked at most once.
 */
export function syntheticCycleCatchUpExecutor(cycle: SyntheticCycle): CatchUpSyncExecutor {
  return {
    async execute(context: WorkerContext, account: SanitizedAccountRef): Promise<CatchUpSyncOutcome> {
      const outcome = await cycle.run(context, account);
      return syntheticCycleOutcomeToCatchUp(outcome);
    },
  };
}
