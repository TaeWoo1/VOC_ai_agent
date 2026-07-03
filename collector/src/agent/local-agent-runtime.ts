/**
 * **Offline Local Agent orchestration** (M-Agent-1A).
 *
 * Composes the pure `reduceLocalAgent` lifecycle with the shared, already-merged
 * primitives — `AccountSingleFlight`, the candidate/login-mode signature
 * (`computeCandidateSignature`), the injected persistent-context seam
 * (`WorkerContext`/`ContextLauncher`/`SessionInspector`/`SyntheticCycle`/
 * `OperationalStateSink`, re-used from the server worker), and the dormant
 * operational reducer `applySyncOutcome` — into ONE device-local workday lifecycle:
 *
 *   *"assisted reconnect at the start of the workday, followed by unattended review
 *    collection while the seller's PC and browser context remain alive."*
 *
 * It is an **additive layer**, not a fork of `EsmWorkerRuntime`: the workday sync
 * leg re-uses the same `SyntheticCycle` + `applySyncOutcome` drive; the net-new
 * concern is the human-assisted reconnect (login-mode normalization → credential
 * selection handoff → one gated submit → one verification), which the server path
 * does not have.
 *
 * **Injected end-to-end — owns NO real browser.** No Playwright, no Chromium, no
 * page, no click/download/upload, no filesystem, no timer/scheduler, no real clock:
 * every timestamp is an explicit `now` argument, and every browser interaction is an
 * interface. The whole lifecycle runs offline under fakes.
 *
 * **Safety invariants enforced here (beyond the reducer's structural ones):**
 *  - The agent NEVER types credentials. The reconnect path stops at the human's
 *    saved-credential selection; the agent only observes four booleans.
 *  - At most ONE login-mode click and at most ONE login submit per reconnect
 *    lifecycle. A signature mismatch fires ZERO clicks. A challenge / form drift /
 *    incomplete population fires ZERO submits.
 *  - A failed verification → `HUMAN_RECONNECT_REQUIRED` with NO automatic retry.
 *  - Duplicate population/ready events never cause a duplicate submit / catch-up.
 *  - No sync while a reconnect is required, and none before the catch-up request is
 *    acknowledged. Overlapping ticks for one account never double-run.
 *  - NOTHING here writes `CapabilityStatus` / schema / dedup verification.
 */

import {
  isReconnectState,
  mayScheduleSync,
  reduceLocalAgent,
  type CredentialPopulationObservation,
  type InspectionVerdict,
  type LocalAgentConnection,
  type LocalAgentEvent,
  type LocalAgentState,
  type ReconnectInteractionCategory,
  type SanitizedAccountRef,
} from "./local-agent-state";
import { AccountSingleFlight } from "../esm/account-single-flight";
import {
  CANDIDATE_SIGNATURE_SCHEMA_VERSION,
  computeCandidateSignature,
  type CandidateShape,
} from "../esm/esm-candidate-signature";
import type {
  ContextLauncher,
  OperationalStateSink,
  SessionInspector,
  SyntheticCycle,
  SyntheticCycleOutcome,
  WorkerContext,
} from "../esm/esm-worker-runtime";
import { applySyncOutcome, type SyncOutcome } from "../connection/sync-state-reduce";
import type { ConnectorSyncState } from "../connection/sync-state";

// ── Net-new injected interfaces (sanitized values only; no real browser) ──────────────────────────

/**
 * A SANITIZED scan of the login-mode selector on the held context. Carries only the
 * sole candidate's coarse `CandidateShape` (or `null`) and whether the configured
 * mode is already active — never DOM text / selector / label / URL.
 */
export interface LoginModeScan {
  /** A single login-mode selector candidate was located. */
  candidatePresent: boolean;
  /** Its sanitized shape, present iff `candidatePresent`. */
  candidate: CandidateShape | null;
  /** The configured login mode is already the active one (no click needed). */
  alreadyActive: boolean;
}

/** Normalizes the login surface to the configured mode. Injected; fires at most one click. */
export interface LoginModeNormalizer {
  /** No-click scan of the login-mode selector. */
  scanModeCandidate(context: WorkerContext): Promise<LoginModeScan>;
  /** The single trusted click that selects the configured mode. Called at most once. */
  selectMode(context: WorkerContext): Promise<void>;
}

/** Result of preparing the credential-selection surface — a boolean form-shape gate only. */
export interface ReconnectSurfacePrep {
  /** The expected login-form shape is present after normalization. */
  formShapeMatches: boolean;
}

/** Prepares the human-facing credential-selection surface. Injected; no credential access. */
export interface ReconnectSurface {
  prepare(context: WorkerContext): Promise<ReconnectSurfacePrep>;
}

/** Fires the ONE login submit after the human selects saved credentials. Injected; no typing. */
export interface LoginSubmitter {
  submit(context: WorkerContext): Promise<void>;
}

/** Sanitized notification kinds — a fixed enum, never raw data. */
export type LocalAgentNotificationKind =
  /** The human must select saved credentials to continue the assisted reconnect. */
  | "CREDENTIAL_SELECTION_REQUIRED"
  /** Assisted reconnect cannot proceed automatically; a human must reconnect. */
  | "HUMAN_RECONNECT_REQUIRED";

/** A SANITIZED user notification — only a kind + the hash-only account reference. */
export interface LocalAgentNotification {
  kind: LocalAgentNotificationKind;
  account: SanitizedAccountRef;
}

/** Emits sanitized user notifications. Injected. */
export interface LocalAgentNotifier {
  notify(notification: LocalAgentNotification): Promise<void>;
}

/** Receives the "please run one immediate catch-up sync" request. Injected; runs no sync itself. */
export interface CatchUpRequestSink {
  request(account: SanitizedAccountRef): Promise<void>;
}

/** Receives each applied operational `ConnectorSyncState`. Injected; no real persistence. */
export type { OperationalStateSink };

/** The full injected dependency set for the offline Local Agent runtime. */
export interface LocalAgentDeps {
  launcher: ContextLauncher;
  inspector: SessionInspector;
  loginModeNormalizer: LoginModeNormalizer;
  reconnectSurface: ReconnectSurface;
  submitter: LoginSubmitter;
  notifier: LocalAgentNotifier;
  catchUp: CatchUpRequestSink;
  cycle: SyntheticCycle;
  operationalSink: OperationalStateSink;
  /** Salt for login-mode signature comparison (the `storageProbeSalt` convention). */
  salt: string;
  /** Internal sync cadence (minutes) seeded into the operational state. Defaults to 120. */
  internalSyncCadenceMin?: number;
}

// ── Sanitized result enums ─────────────────────────────────────────────────────────────────────────

/** Why a credential observation ended — a fixed sanitized enum. */
export type CredentialObservationDisposition =
  /** Not in `WAITING_FOR_CREDENTIAL_SELECTION`; the observation was ignored. */
  | "IGNORED_NOT_WAITING"
  /** Fields not both populated yet — remain waiting, zero submit. */
  | "AWAITING_POPULATION"
  /** A challenge appeared — zero submit, human reconnect. */
  | "CHALLENGE"
  /** The live form signature drifted — zero submit, human reconnect. */
  | "FORM_DRIFT"
  /** Both populated but auto-submit consent is absent — zero submit, human must finish. */
  | "NO_SUBMIT_CONSENT"
  /** All gates passed, one submit fired, verification says LOGGED_IN. */
  | "LOGGED_IN"
  /** All gates passed, one submit fired, verification failed — human reconnect, no retry. */
  | "VERIFY_FAILED";

/** The sanitized outcome of one credential observation. Only enums/booleans. */
export interface CredentialObservationResult {
  disposition: CredentialObservationDisposition;
  state: LocalAgentState;
  /** Whether THIS observation fired the single submit. */
  submitted: boolean;
}

/** Why a workday tick ended — a fixed sanitized enum. */
export type TickDisposition =
  /** The gate passed and the single synthetic cycle ran. */
  | "SYNCED"
  /** An overlapping tick for the same account was in flight; zero cycle. */
  | "SKIPPED_BUSY"
  /** The catch-up request has not been acknowledged yet; zero cycle. */
  | "SKIPPED_CATCHUP_PENDING"
  /** A human-assisted reconnect is in progress/required; zero cycle. */
  | "RECONNECT_REQUIRED"
  /** State is not schedulable (paused/degraded/booting); zero cycle. */
  | "NOT_READY";

/** The sanitized outcome of one workday tick. Only enums. */
export interface TickResult {
  disposition: TickDisposition;
  state: LocalAgentState;
  /** The synthetic cycle's sanitized outcome, present only when `disposition === "SYNCED"`. */
  cycleOutcome: SyntheticCycleOutcome | null;
}

// ── Internal per-account lifecycle record ─────────────────────────────────────────────────────────

interface AgentLifecycle {
  connection: LocalAgentConnection;
  context: WorkerContext;
  state: LocalAgentState;
  operational: ConnectorSyncState;
  contextClosed: boolean;
  reconnectInteractionCategory: ReconnectInteractionCategory;
  // Per-reconnect-lifecycle idempotency flags (reset when a reconnect begins).
  modeNormalized: boolean;
  reconnectNotified: boolean;
  submitFired: boolean;
  // Per-logged-in-session flags (reset when leaving the logged-in session).
  catchUpRequested: boolean;
  catchUpAcknowledged: boolean;
}

const DEFAULT_CADENCE_MIN = 120;

/** Seed a fresh operational state. `CapabilityStatus` starts — and stays — NEEDS_DISCOVERY. */
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
 * The offline Local Agent runtime. Manages one device-local lifecycle per account:
 * `start` launches exactly one injected context and inspects it (assisted reconnect
 * on a logged-out session); `submitCredentialObservation` drives the gated single
 * submit + verification; `acknowledgeCatchUp` + `tick` run the workday collection
 * seam into the SAME context; `restart` is a brand-new lifecycle that re-inspects
 * (never inherits `READY`); `stop` closes the context once.
 */
export class LocalAgentRuntime {
  private readonly deps: LocalAgentDeps;
  private readonly singleFlight = new AccountSingleFlight();
  private readonly lifecycles = new Map<string, AgentLifecycle>();
  private readonly cadenceMin: number;

  constructor(deps: LocalAgentDeps) {
    this.deps = deps;
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
  getState(account: SanitizedAccountRef): LocalAgentState | null {
    return this.lifecycles.get(this.key(account))?.state ?? null;
  }

  /** The held context's stable id, or `null` — used to prove reuse across ticks. */
  getContextId(account: SanitizedAccountRef): string | null {
    return this.lifecycles.get(this.key(account))?.context.id ?? null;
  }

  /** The current operational `ConnectorSyncState`, or `null` if not started. */
  getOperationalState(account: SanitizedAccountRef): ConnectorSyncState | null {
    return this.lifecycles.get(this.key(account))?.operational ?? null;
  }

  /**
   * The modeled reconnect-interaction category. Stays `UNKNOWN` throughout 1A —
   * the agent never claims a specific category; M-Agent-1B determines it live.
   */
  getReconnectInteractionCategory(account: SanitizedAccountRef): ReconnectInteractionCategory | null {
    return this.lifecycles.get(this.key(account))?.reconnectInteractionCategory ?? null;
  }

  /** Whether the pending catch-up request has been acknowledged (a workday-tick prerequisite). */
  hasAcknowledgedCatchUp(account: SanitizedAccountRef): boolean {
    return this.lifecycles.get(this.key(account))?.catchUpAcknowledged ?? false;
  }

  /**
   * Start the Local Agent for an account: launch EXACTLY ONE injected context, seed
   * operational state, then (if consented) perform a no-click session inspection.
   * `LOGGED_IN` → `READY` + one catch-up request; otherwise → the assisted-reconnect
   * preparation. Throws if a lifecycle already exists (use `restart`).
   */
  async start(connection: LocalAgentConnection, now: Date | string): Promise<LocalAgentState> {
    const key = this.key(connection.account);
    if (this.lifecycles.has(key)) {
      throw new Error("LocalAgentRuntime.start: lifecycle already started for this account (use restart)");
    }
    const context = await this.deps.launcher.launch();
    const lifecycle: AgentLifecycle = {
      connection,
      context,
      state: "STOPPED",
      operational: seedOperationalState(connection.account, this.cadenceMin),
      contextClosed: false,
      reconnectInteractionCategory: "UNKNOWN",
      modeNormalized: false,
      reconnectNotified: false,
      submitFired: false,
      catchUpRequested: false,
      catchUpAcknowledged: false,
    };
    this.lifecycles.set(key, lifecycle);
    this.reduce(lifecycle, { kind: "START" }); // STOPPED → STARTING (the reducer is the single source of truth)

    if (!connection.sessionInspectionConsent) {
      // No consent to even inspect — halt without touching the browser session.
      this.reduce(lifecycle, { kind: "PAUSE" });
      return lifecycle.state;
    }
    await this.inspectFromBoot(lifecycle, now);
    return lifecycle.state;
  }

  /**
   * Re-run a no-click session inspection on the held context (workday re-check or
   * post-human-reconnect check). Legal from `READY`/`PAUSED`/`DEGRADED`/
   * `HUMAN_RECONNECT_REQUIRED`; a no-op elsewhere. A `LOGGED_IN` verdict re-arms
   * `READY` (catch-up is requested at most once per session); a logged-out verdict
   * enters the assisted-reconnect preparation.
   */
  async reinspect(account: SanitizedAccountRef, now: Date | string): Promise<LocalAgentState> {
    const lifecycle = this.requireLifecycle(account);
    const before = lifecycle.state;
    this.reduce(lifecycle, { kind: "INSPECT" });
    if (lifecycle.state !== "INSPECTING_SESSION") {
      // Illegal from `before` — safe no-op.
      return before;
    }
    await this.runInspection(lifecycle, now);
    return lifecycle.state;
  }

  /**
   * Push a SANITIZED credential-population observation while in
   * `WAITING_FOR_CREDENTIAL_SELECTION`. Applies the submit gates and, only when ALL
   * pass, fires the ONE login submit + one verification. Idempotent: a duplicate
   * observation never fires a second submit.
   */
  async submitCredentialObservation(
    account: SanitizedAccountRef,
    observation: CredentialPopulationObservation,
    now: Date | string,
  ): Promise<CredentialObservationResult> {
    const lifecycle = this.requireLifecycle(account);
    if (lifecycle.state !== "WAITING_FOR_CREDENTIAL_SELECTION") {
      return { disposition: "IGNORED_NOT_WAITING", state: lifecycle.state, submitted: false };
    }

    // Fail-closed gates FIRST — a challenge or form drift fires zero submit.
    if (observation.challengePresent) {
      await this.failReconnect(lifecycle);
      return { disposition: "CHALLENGE", state: lifecycle.state, submitted: false };
    }
    if (!observation.formSignatureMatch) {
      await this.failReconnect(lifecycle);
      return { disposition: "FORM_DRIFT", state: lifecycle.state, submitted: false };
    }

    // Population gate — incomplete population stays waiting, zero submit.
    if (!(observation.usernamePopulated && observation.passwordPopulated)) {
      return { disposition: "AWAITING_POPULATION", state: lifecycle.state, submitted: false };
    }

    // Consent gate — both fields populated but no auto-submit grant: the human must
    // finish the login. Zero submit; require human action.
    if (!lifecycle.connection.autoSubmitAfterCredentialSelectionConsent) {
      await this.failReconnect(lifecycle);
      return { disposition: "NO_SUBMIT_CONSENT", state: lifecycle.state, submitted: false };
    }

    // Idempotency backstop: never a second submit in one reconnect lifecycle.
    if (lifecycle.submitFired) {
      return { disposition: "IGNORED_NOT_WAITING", state: lifecycle.state, submitted: false };
    }

    // All gates pass → the ONE gated submit, then transition + one verification.
    lifecycle.submitFired = true;
    await this.deps.submitter.submit(lifecycle.context);
    this.reduce(lifecycle, { kind: "CREDENTIALS_SUBMITTED" }); // → VERIFYING_LOGIN

    const verdict = await this.deps.inspector.inspect(lifecycle.context);
    const verified = this.reduce(lifecycle, { kind: "LOGIN_VERIFIED", verdict }); // → READY | HUMAN_RECONNECT_REQUIRED
    if (verified === "READY") {
      await this.onEnterReady(lifecycle);
      return { disposition: "LOGGED_IN", state: verified, submitted: true };
    }
    // Verification failed — NO automatic retry (reducer already routed to human).
    await this.deps.notifier.notify({ kind: "HUMAN_RECONNECT_REQUIRED", account: lifecycle.connection.account });
    return { disposition: "VERIFY_FAILED", state: verified, submitted: true };
  }

  /** Acknowledge the pending catch-up request — a prerequisite for any workday tick. Idempotent. */
  acknowledgeCatchUp(account: SanitizedAccountRef): void {
    const lifecycle = this.requireLifecycle(account);
    lifecycle.catchUpAcknowledged = true;
  }

  /**
   * Run ONE manual workday sync tick into the SAME held context. Held under the
   * account single-flight for its whole duration, so an overlapping tick for the
   * same account returns `SKIPPED_BUSY` with zero cycle. Refuses to sync during a
   * reconnect, before the catch-up is acknowledged, or from any non-`READY` state.
   * No auto-retry: a failed outcome is recorded operationally and reported as-is.
   */
  async tick(account: SanitizedAccountRef, now: Date | string): Promise<TickResult> {
    const lifecycle = this.requireLifecycle(account);

    const handle = this.singleFlight.tryAcquire(this.key(account));
    if (handle === null) {
      return { disposition: "SKIPPED_BUSY", state: lifecycle.state, cycleOutcome: null };
    }
    try {
      if (isReconnectState(lifecycle.state)) {
        return { disposition: "RECONNECT_REQUIRED", state: lifecycle.state, cycleOutcome: null };
      }
      if (!lifecycle.catchUpAcknowledged) {
        return { disposition: "SKIPPED_CATCHUP_PENDING", state: lifecycle.state, cycleOutcome: null };
      }
      if (!mayScheduleSync(lifecycle.state)) {
        return { disposition: "NOT_READY", state: lifecycle.state, cycleOutcome: null };
      }

      this.reduce(lifecycle, { kind: "SYNC_STARTED" }); // → SYNCING
      const outcome = await this.deps.cycle.run(lifecycle.context, lifecycle.connection.account);
      this.reduce(lifecycle, { kind: "SYNC_FINISHED" }); // → READY (operational axis records the outcome)
      await this.applyOperational(lifecycle, outcome, now);
      return { disposition: "SYNCED", state: lifecycle.state, cycleOutcome: outcome };
    } finally {
      handle.release();
    }
  }

  /**
   * Restart: a BRAND-NEW lifecycle. Closes the current context (once), relaunches a
   * fresh context and re-inspects. It can NEVER inherit `READY` without a new
   * inspection — a restart is a potential session break.
   */
  async restart(account: SanitizedAccountRef, now: Date | string): Promise<LocalAgentState> {
    const existing = this.lifecycles.get(this.key(account));
    if (existing === undefined) {
      throw new Error("LocalAgentRuntime.restart: account is not started");
    }
    const connection = existing.connection;
    this.reduce(existing, { kind: "RESTART" }); // → STARTING (never READY)
    await this.closeContextOnce(existing);
    this.lifecycles.delete(this.key(account));
    return this.start(connection, now);
  }

  /** Stop the lifecycle: close the injected context EXACTLY ONCE and mark STOPPED. */
  async stop(account: SanitizedAccountRef): Promise<void> {
    const lifecycle = this.lifecycles.get(this.key(account));
    if (lifecycle === undefined) return;
    this.reduce(lifecycle, { kind: "STOP" });
    await this.closeContextOnce(lifecycle);
    this.lifecycles.delete(this.key(account));
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────────

  private requireLifecycle(account: SanitizedAccountRef): AgentLifecycle {
    const lifecycle = this.lifecycles.get(this.key(account));
    if (lifecycle === undefined) {
      throw new Error("LocalAgentRuntime: account is not started");
    }
    return lifecycle;
  }

  /** Apply an event to the lifecycle state (illegal transitions are safe no-ops); returns the new state. */
  private reduce(lifecycle: AgentLifecycle, event: LocalAgentEvent): LocalAgentState {
    lifecycle.state = reduceLocalAgent(lifecycle.state, event).next;
    return lifecycle.state;
  }

  /** Startup inspection: STARTING → INSPECTING_SESSION → (READY | reconnect). */
  private async inspectFromBoot(lifecycle: AgentLifecycle, now: Date | string): Promise<void> {
    this.reduce(lifecycle, { kind: "INSPECT" });
    await this.runInspection(lifecycle, now);
  }

  /** Run the no-click inspection and branch: LOGGED_IN → READY; else → reconnect prep. */
  private async runInspection(lifecycle: AgentLifecycle, now: Date | string): Promise<void> {
    const verdict: InspectionVerdict = await this.deps.inspector.inspect(lifecycle.context);
    this.reduce(lifecycle, { kind: "SESSION_INSPECTED", verdict }); // → READY | PREPARING_RECONNECT
    if (lifecycle.state === "READY") {
      await this.onEnterReady(lifecycle);
      return;
    }
    if (lifecycle.state === "PREPARING_RECONNECT") {
      await this.prepareAssistedReconnect(lifecycle, now);
    }
  }

  /**
   * The assisted-reconnect preparation (plan "Assisted reconnect" §1–7). Runs the
   * consent + signature + normalization + form-shape gates, notifies once, and lands
   * in `WAITING_FOR_CREDENTIAL_SELECTION` — OR fails closed to `HUMAN_RECONNECT_REQUIRED`.
   * The agent NEVER types credentials.
   */
  private async prepareAssistedReconnect(lifecycle: AgentLifecycle, _now: Date | string): Promise<void> {
    // A new reconnect lifecycle — reset its idempotency flags and clear the session's
    // catch-up state (a fresh READY later will request exactly one catch-up).
    lifecycle.modeNormalized = false;
    lifecycle.reconnectNotified = false;
    lifecycle.submitFired = false;
    lifecycle.catchUpRequested = false;
    lifecycle.catchUpAcknowledged = false;

    const conn = lifecycle.connection;

    // Gate: assisted-reconnect consent.
    if (!conn.assistedReconnectConsent) {
      await this.failReconnect(lifecycle);
      return;
    }

    // Gate: exactly one login-mode candidate whose signature matches EXACTLY.
    const scan = await this.deps.loginModeNormalizer.scanModeCandidate(lifecycle.context);
    if (!scan.candidatePresent || scan.candidate === null || !this.loginModeSignatureMatches(conn, scan.candidate)) {
      await this.failReconnect(lifecycle); // signature mismatch / absent → ZERO clicks
      return;
    }

    // Gate: consent to auto-select the mode. Without it, no click — human must reconnect.
    if (!conn.loginModeAutoSelectionConsent) {
      await this.failReconnect(lifecycle);
      return;
    }

    // Normalize at most once (skip the click if the mode is already active).
    if (!lifecycle.modeNormalized) {
      lifecycle.modeNormalized = true;
      if (!scan.alreadyActive) {
        await this.deps.loginModeNormalizer.selectMode(lifecycle.context); // the ONE mode click
      }
    }

    // Gate: the expected login-form shape must be present after normalization.
    const prep = await this.deps.reconnectSurface.prepare(lifecycle.context);
    if (!prep.formShapeMatches) {
      await this.failReconnect(lifecycle);
      return;
    }

    // Notify the human that saved-credential selection is required (exactly once).
    if (!lifecycle.reconnectNotified) {
      lifecycle.reconnectNotified = true;
      await this.deps.notifier.notify({ kind: "CREDENTIAL_SELECTION_REQUIRED", account: conn.account });
    }

    this.reduce(lifecycle, { kind: "RECONNECT_PREPARED" }); // → WAITING_FOR_CREDENTIAL_SELECTION
  }

  /** Exact login-mode signature match: schema version + salted fingerprint both equal. */
  private loginModeSignatureMatches(conn: LocalAgentConnection, liveShape: CandidateShape): boolean {
    if (conn.loginModeSignatureVersion !== CANDIDATE_SIGNATURE_SCHEMA_VERSION) return false;
    return conn.loginModeSignature === computeCandidateSignature(liveShape, this.deps.salt);
  }

  /** Fail the reconnect closed → HUMAN_RECONNECT_REQUIRED + one sanitized notification. */
  private async failReconnect(lifecycle: AgentLifecycle): Promise<void> {
    this.reduce(lifecycle, { kind: "RECONNECT_FAILED" });
    await this.deps.notifier.notify({
      kind: "HUMAN_RECONNECT_REQUIRED",
      account: lifecycle.connection.account,
    });
  }

  /**
   * On entering `READY` from a fresh inspection or verification, request exactly ONE
   * catch-up sync for this logged-in session. Idempotent: re-entering `READY` (e.g. a
   * re-inspection or a post-sync return) never re-requests.
   */
  private async onEnterReady(lifecycle: AgentLifecycle): Promise<void> {
    if (lifecycle.catchUpRequested) return;
    lifecycle.catchUpRequested = true;
    await this.deps.catchUp.request(lifecycle.connection.account);
  }

  /** Fold a completed synthetic outcome into operational state and notify the sink. */
  private async applyOperational(
    lifecycle: AgentLifecycle,
    outcome: SyntheticCycleOutcome,
    now: Date | string,
  ): Promise<void> {
    const next = applySyncOutcome(lifecycle.operational, operationalOutcomeFor(outcome), now);
    lifecycle.operational = next;
    await this.deps.operationalSink.record(next);
  }

  /** Close the injected context at most once. */
  private async closeContextOnce(lifecycle: AgentLifecycle): Promise<void> {
    if (lifecycle.contextClosed) return;
    lifecycle.contextClosed = true;
    await lifecycle.context.close();
  }
}
