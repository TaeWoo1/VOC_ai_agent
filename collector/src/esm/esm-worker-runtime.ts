/**
 * **Offline worker orchestration seam** for the ESM+ REVIEW persistent-session
 * scheduled beta (M-Sync-1.5B).
 *
 * This proves that ONE persistent context can be reused across multiple **manual**
 * synthetic sync ticks, composing the merged 1.5A primitives
 * (`reduceWorkerSession`, `AccountSingleFlight`, the candidate-signature gate) with
 * the dormant operational reducer (`applySyncOutcome`). It is deliberately
 * **injected end-to-end**: the launcher, persistent context, session inspection,
 * candidate scan, signature lookup, synthetic cycle, and operational sink are all
 * interfaces. **This module owns NO real browser** — no Playwright import, no
 * Chromium, no page, no click/download/upload, no filesystem, no timer/scheduler.
 * The whole lifecycle runs offline under fakes.
 *
 * What it is NOT (deferred, each separately approved): the real capture/upload
 * mechanism (1.5C/1.5D wire `saveValidateUploadDeleteEsmReview`), an armed timer,
 * a production CLI, the production signature-persistence adapter. It proves
 * orchestration, not the marketplace action.
 *
 * Determinism / recency discipline: this module reads NO wall clock. Every method
 * that needs a timestamp (for `applySyncOutcome`) takes an explicit `now` argument.
 */

import {
  mayScheduleSync,
  reduceWorkerSession,
  type InspectionVerdict,
  type WorkerSessionState,
} from "./worker-session-state";
import { AccountSingleFlight } from "./account-single-flight";
import {
  candidateSignatureMatches,
  type CandidateScope,
  type CandidateShape,
  type CandidateSignatureStore,
} from "./esm-candidate-signature";
import { applySyncOutcome, type SyncOutcome } from "../connection/sync-state-reduce";
import type { ConnectorSyncState, SanitizedAccountRef } from "../connection/sync-state";

// ── Injected interfaces (no real browser anywhere) ───────────────────────────────────────────────

/** A fake/injected persistent context. `id` is a stable identity used to PROVE reuse across ticks. */
export interface WorkerContext {
  readonly id: string;
  close(): Promise<void>;
}

/** Launches exactly one persistent context per worker lifecycle. Injected; owns no real browser. */
export interface ContextLauncher {
  launch(): Promise<WorkerContext>;
}

/** No-click session inspection over the held context → a coarse verdict. Never returns DOM/URL. */
export interface SessionInspector {
  inspect(context: WorkerContext): Promise<InspectionVerdict>;
}

/** Coarse actionable-candidate count bucket (mirrors the live gate's "one"/"none" discipline). */
export type ActionableCountBucket = "zero" | "one" | "many";

/**
 * A SANITIZED candidate scan of the held context. Carries only coarse booleans /
 * buckets / a scope enum and — when exactly one actionable candidate exists — its
 * sanitized `CandidateShape`. Never raw DOM text / selector / label / URL.
 */
export interface CandidateScanResult {
  actionableCount: ActionableCountBucket;
  scope: CandidateScope;
  consentLikePresent: boolean;
  /** The sole actionable candidate's sanitized shape, present iff `actionableCount === "one"`. */
  candidate: CandidateShape | null;
}

/** Scans the held context for the export candidate. Injected; no real click. */
export interface CandidateScanner {
  scan(context: WorkerContext): Promise<CandidateScanResult>;
}

/** A completed synthetic cycle's sanitized outcome (NO real capture/upload happened). */
export type SyntheticCycleOutcome = "SUCCESS" | "PARTIAL" | "DOWNLOAD_FAILED" | "UPLOAD_FAILED" | "DELETE_FAILED";

/**
 * The injected fake cycle. In 1.5B this stands in for the real
 * capture→validate→upload→delete leg — it must NOT call `saveValidateUploadDeleteEsmReview`,
 * a real upload, `/api/uploads`, the filesystem, the backend, or a browser.
 */
export interface SyntheticCycle {
  run(context: WorkerContext, account: SanitizedAccountRef): Promise<SyntheticCycleOutcome>;
}

/** Receives each applied operational `ConnectorSyncState`. Injected; no real persistence in 1.5B. */
export interface OperationalStateSink {
  record(state: ConnectorSyncState): Promise<void>;
}

/** Per-account scheduled-beta opt-in. A tick only proceeds when the account has opted in. */
export interface ScheduledBetaPolicy {
  isOptedIn(account: SanitizedAccountRef): boolean;
}

/** The full injected dependency set for the offline runtime. */
export interface WorkerRuntimeDeps {
  launcher: ContextLauncher;
  inspector: SessionInspector;
  scanner: CandidateScanner;
  signatureStore: CandidateSignatureStore;
  cycle: SyntheticCycle;
  operationalSink: OperationalStateSink;
  policy: ScheduledBetaPolicy;
  /** Salt for candidate-signature comparison (the `storageProbeSalt` convention). */
  salt: string;
  /** The frame scope a valid export candidate must live in. Defaults to `"allowlisted-frame"`. */
  expectedScope?: CandidateScope;
  /** Internal sync cadence (minutes) seeded into the operational state. Defaults to 120. */
  internalSyncCadenceMin?: number;
}

// ── Sanitized tick result ────────────────────────────────────────────────────────────────────────

/** Why a manual tick ended — a fixed sanitized enum, never raw data. */
export type TickDisposition =
  /** The gate passed and the single synthetic cycle ran. */
  | "SYNCED"
  /** An overlapping tick for the same account — single-flight was held; zero cycle. */
  | "SKIPPED_BUSY"
  /** The (re-)inspection was not `LOGGED_IN`; a human must reconnect. Zero cycle. */
  | "RECONNECT_REQUIRED"
  /** The account has not opted into the scheduled beta. Zero cycle. */
  | "NO_OPT_IN"
  /** State is not schedulable (e.g. the `DELETE_FAILED` hard stop). Zero cycle. */
  | "NOT_READY"
  /** Candidate drift (count≠1 / wrong scope / consent-like / no record / signature mismatch). Zero cycle. */
  | "UI_CHANGED";

/** The sanitized outcome of one manual tick. Contains only enums — no raw DOM/URL/path/ID/row/header. */
export interface TickResult {
  disposition: TickDisposition;
  state: WorkerSessionState;
  /** The synthetic cycle's sanitized outcome, present only when `disposition === "SYNCED"`. */
  cycleOutcome: SyntheticCycleOutcome | null;
}

// ── Internal per-account lifecycle record ────────────────────────────────────────────────────────

interface AccountLifecycle {
  account: SanitizedAccountRef;
  context: WorkerContext;
  state: WorkerSessionState;
  operational: ConnectorSyncState;
  contextClosed: boolean;
}

const DEFAULT_EXPECTED_SCOPE: CandidateScope = "allowlisted-frame";
const DEFAULT_CADENCE_MIN = 120;

/** Seed a fresh operational state for an account. `CapabilityStatus` starts — and stays — NEEDS_DISCOVERY. */
function seedOperationalState(account: SanitizedAccountRef, cadenceMin: number): ConnectorSyncState {
  return {
    channel: "ESM",
    connectorType: "BROWSER_EXPORT",
    accountRef: account,
    capabilityStatus: "NEEDS_DISCOVERY",
    authStatus: "UNKNOWN",
    syncStatus: "IDLE",
    lastSyncAttemptAt: null,
    lastSuccessfulSyncAt: null,
    nextSyncAt: null,
    internalSyncCadenceMin: cadenceMin,
    userReportSchedule: { preset: "ON_DEMAND" },
    reconnectRequired: false,
    lastErrorCategory: null,
    lastErrorAt: null,
    staleDataWarning: false,
    dataFreshnessLevel: "UNKNOWN",
  };
}

/** Map a synthetic cycle outcome to the operational `SyncOutcome` fed to `applySyncOutcome`. */
function operationalOutcomeFor(outcome: SyntheticCycleOutcome): SyncOutcome {
  switch (outcome) {
    case "SUCCESS":
      return { kind: "SUCCEEDED" };
    case "PARTIAL":
      return { kind: "PARTIAL" };
    case "DOWNLOAD_FAILED":
      return { kind: "FAILED", errorCategory: "DOWNLOAD_FAILED" };
    case "UPLOAD_FAILED":
      return { kind: "FAILED", errorCategory: "NETWORK" };
    case "DELETE_FAILED":
      return { kind: "FAILED", errorCategory: "UNKNOWN" };
  }
}

/**
 * Map a synthetic cycle outcome to the worker lifecycle event. The 1.5A lifecycle
 * has no dedicated PARTIAL runtime state (that axis lives on the operational
 * `ConnectorSyncState`, where `applySyncOutcome` records the honest PARTIAL and
 * PRESERVES the last good snapshot). So a partial ingest returns the lifecycle to
 * the post-cycle `SUCCESS` state while the operational drive records `PARTIAL`.
 */
function workerEventFor(outcome: SyntheticCycleOutcome): Parameters<typeof reduceWorkerSession>[1] {
  switch (outcome) {
    case "SUCCESS":
    case "PARTIAL":
      return { kind: "SYNC_SUCCEEDED" };
    case "DOWNLOAD_FAILED":
      return { kind: "SYNC_DOWNLOAD_FAILED" };
    case "UPLOAD_FAILED":
      return { kind: "SYNC_UPLOAD_FAILED" };
    case "DELETE_FAILED":
      return { kind: "SYNC_DELETE_FAILED" };
  }
}

/**
 * The offline ESM worker runtime. Manages one persistent-context lifecycle per
 * account: `start` launches exactly one injected context and inspects it, `tick`
 * runs a single guarded synthetic cycle into the SAME context, `stop` closes it
 * once, and `restart` is a brand-new lifecycle that re-inspects (never inherits
 * `READY`). All account-scoped; different accounts are independent.
 */
export class EsmWorkerRuntime {
  private readonly deps: WorkerRuntimeDeps;
  private readonly singleFlight = new AccountSingleFlight();
  private readonly lifecycles = new Map<string, AccountLifecycle>();
  private readonly expectedScope: CandidateScope;
  private readonly cadenceMin: number;

  constructor(deps: WorkerRuntimeDeps) {
    this.deps = deps;
    this.expectedScope = deps.expectedScope ?? DEFAULT_EXPECTED_SCOPE;
    this.cadenceMin = deps.internalSyncCadenceMin ?? DEFAULT_CADENCE_MIN;
  }

  private key(account: SanitizedAccountRef): string {
    return account.connectionId;
  }

  /** True if a lifecycle exists for the account (started, not stopped). */
  isStarted(account: SanitizedAccountRef): boolean {
    return this.lifecycles.has(this.key(account));
  }

  /** Current lifecycle state, or `null` if not started. */
  getState(account: SanitizedAccountRef): WorkerSessionState | null {
    return this.lifecycles.get(this.key(account))?.state ?? null;
  }

  /** The held context's stable id, or `null` if not started — used to prove reuse across ticks. */
  getContextId(account: SanitizedAccountRef): string | null {
    return this.lifecycles.get(this.key(account))?.context.id ?? null;
  }

  /** The current operational `ConnectorSyncState`, or `null` if not started. */
  getOperationalState(account: SanitizedAccountRef): ConnectorSyncState | null {
    return this.lifecycles.get(this.key(account))?.operational ?? null;
  }

  /**
   * Start the worker lifecycle for an account: launch EXACTLY ONE injected
   * persistent context, seed operational state, then perform a no-click session
   * inspection. `LOGGED_IN` → `READY`; any other verdict → `RECONNECT_REQUIRED`.
   * Idempotent guard: throws if a lifecycle already exists (use `restart`).
   */
  async start(account: SanitizedAccountRef, now: Date | string): Promise<WorkerSessionState> {
    const key = this.key(account);
    if (this.lifecycles.has(key)) {
      throw new Error("EsmWorkerRuntime.start: lifecycle already started for this account (use restart)");
    }
    const context = await this.deps.launcher.launch();
    const lifecycle: AccountLifecycle = {
      account,
      context,
      state: "STARTING",
      operational: seedOperationalState(account, this.cadenceMin),
      contextClosed: false,
    };
    this.lifecycles.set(key, lifecycle);
    // Startup ALWAYS inspects (no-click) — the profile is never assumed to have restored auth.
    await this.inspectAndReduce(lifecycle, context, now);
    return lifecycle.state;
  }

  /**
   * Run ONE manual synthetic tick. Held under the account single-flight for its
   * whole duration, so an overlapping tick for the same account returns
   * `SKIPPED_BUSY` with zero cycle execution. The tick re-inspects first (re-arming
   * a post-cycle state or catching session loss), then applies the candidate-signature
   * gate; only a fully-passing gate invokes the synthetic cycle — at most once.
   */
  async tick(account: SanitizedAccountRef, now: Date | string): Promise<TickResult> {
    const lifecycle = this.requireLifecycle(account);

    // Single-flight for the ENTIRE tick — an overlapping same-account tick skips immediately.
    const handle = this.singleFlight.tryAcquire(this.key(account));
    if (handle === null) {
      return { disposition: "SKIPPED_BUSY", state: lifecycle.state, cycleOutcome: null };
    }
    try {
      return await this.runGuardedTick(lifecycle, now);
    } finally {
      handle.release();
    }
  }

  /** The guarded body of a tick — runs only while the account lock is held. */
  private async runGuardedTick(lifecycle: AccountLifecycle, now: Date | string): Promise<TickResult> {
    // 1) No-click re-inspection: re-arms a post-cycle state to READY, or catches loss.
    await this.inspectAndReduce(lifecycle, lifecycle.context, now);
    if (lifecycle.state === "RECONNECT_REQUIRED") {
      return { disposition: "RECONNECT_REQUIRED", state: lifecycle.state, cycleOutcome: null };
    }
    if (!mayScheduleSync(lifecycle.state)) {
      // Not schedulable — e.g. the DELETE_FAILED hard stop (inspection is rejected there).
      return { disposition: "NOT_READY", state: lifecycle.state, cycleOutcome: null };
    }

    // 2) Scheduled-beta opt-in gate.
    if (!this.deps.policy.isOptedIn(lifecycle.account)) {
      this.reduce(lifecycle, { kind: "PAUSE" });
      return { disposition: "NO_OPT_IN", state: lifecycle.state, cycleOutcome: null };
    }

    // 3) Enter SYNCING (an internal lifecycle transition — NOT a real click).
    this.reduce(lifecycle, { kind: "SYNC_STARTED" });

    // 4) Candidate scan gate: exactly one actionable candidate, expected scope, no consent-like.
    const scan = await this.deps.scanner.scan(lifecycle.context);
    if (
      scan.actionableCount !== "one" ||
      scan.scope !== this.expectedScope ||
      scan.consentLikePresent ||
      scan.candidate === null
    ) {
      this.reduce(lifecycle, { kind: "SYNC_UI_CHANGED" });
      return { disposition: "UI_CHANGED", state: lifecycle.state, cycleOutcome: null };
    }

    // 5) Candidate-signature gate: an approved record must exist AND match exactly.
    const record = await this.deps.signatureStore.load(lifecycle.account);
    if (record === null || !candidateSignatureMatches(record, scan.candidate, this.deps.salt)) {
      this.reduce(lifecycle, { kind: "SYNC_UI_CHANGED" });
      return { disposition: "UI_CHANGED", state: lifecycle.state, cycleOutcome: null };
    }

    // 6) The ONE synthetic cycle call. No auto-retry: a failed outcome is reported as-is.
    const outcome = await this.deps.cycle.run(lifecycle.context, lifecycle.account);
    this.reduce(lifecycle, workerEventFor(outcome));

    // 7) Drive operational state ONLY (never CapabilityStatus / schema / dedup verification).
    await this.applyOperational(lifecycle, outcome, now);

    return { disposition: "SYNCED", state: lifecycle.state, cycleOutcome: outcome };
  }

  /**
   * Stop the lifecycle: close the injected context EXACTLY ONCE and mark STOPPED.
   * A second `stop` (or `stop` after `restart`) is a safe no-op — the context is
   * never double-closed.
   */
  async stop(account: SanitizedAccountRef): Promise<void> {
    const lifecycle = this.lifecycles.get(this.key(account));
    if (lifecycle === undefined) return;
    this.reduce(lifecycle, { kind: "STOP" });
    await this.closeContextOnce(lifecycle);
    this.lifecycles.delete(this.key(account));
  }

  /**
   * Restart: a BRAND-NEW worker lifecycle. Closes the current context (once),
   * then launches a fresh context and re-inspects. It can NEVER inherit `READY`
   * without a new inspection — a restart is a potential session break.
   */
  async restart(account: SanitizedAccountRef, now: Date | string): Promise<WorkerSessionState> {
    const existing = this.lifecycles.get(this.key(account));
    if (existing !== undefined) {
      this.reduce(existing, { kind: "RESTART" }); // → STARTING (never READY)
      await this.closeContextOnce(existing);
      this.lifecycles.delete(this.key(account));
    }
    return this.start(account, now);
  }

  // ── internals ──────────────────────────────────────────────────────────────────────────────────

  private requireLifecycle(account: SanitizedAccountRef): AccountLifecycle {
    const lifecycle = this.lifecycles.get(this.key(account));
    if (lifecycle === undefined) {
      throw new Error("EsmWorkerRuntime: account is not started");
    }
    return lifecycle;
  }

  /** Apply an event to the lifecycle's worker state (illegal transitions are safe no-ops). */
  private reduce(lifecycle: AccountLifecycle, event: Parameters<typeof reduceWorkerSession>[1]): void {
    lifecycle.state = reduceWorkerSession(lifecycle.state, event).next;
  }

  /** No-click inspection → reduce with an INSPECTED event. */
  private async inspectAndReduce(
    lifecycle: AccountLifecycle,
    context: WorkerContext,
    _now: Date | string,
  ): Promise<void> {
    const verdict = await this.deps.inspector.inspect(context);
    this.reduce(lifecycle, { kind: "INSPECTED", verdict });
  }

  /** Fold a completed synthetic outcome into operational state and notify the sink. */
  private async applyOperational(
    lifecycle: AccountLifecycle,
    outcome: SyntheticCycleOutcome,
    now: Date | string,
  ): Promise<void> {
    const next = applySyncOutcome(lifecycle.operational, operationalOutcomeFor(outcome), now);
    lifecycle.operational = next;
    await this.deps.operationalSink.record(next);
  }

  /** Close the injected context at most once. */
  private async closeContextOnce(lifecycle: AccountLifecycle): Promise<void> {
    if (lifecycle.contextClosed) return;
    lifecycle.contextClosed = true;
    await lifecycle.context.close();
  }
}
