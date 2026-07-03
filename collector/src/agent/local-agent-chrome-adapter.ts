/**
 * **Real Local Agent Chrome reconnect adapter** (M-Agent-1C1).
 *
 * Concrete implementations of the merged M-Agent-1A injected interfaces
 * (`ContextLauncher`/`SessionInspector`/`LoginModeNormalizer`/`ReconnectSurface`/
 * `LoginSubmitter`) that drive a real Chrome page through the **`TWO_STEP_
 * FIELD_AND_CREDENTIAL_SELECTION`** reconnect M-Agent-1B proved live, up to `READY`.
 * It does NOT duplicate the 1A state machine — it feeds `LocalAgentRuntime`.
 *
 * All browser I/O sits behind the injected `LocalAgentPage` boundary, so the adapter
 * logic (signature/form/submit gates, single-click / single-submit, sanitization,
 * one-shot handoff) is fully hermetic-testable with a fake page — no Playwright, no
 * launch, no network. The one real page implementation + its launcher live in
 * `local-agent-real-chrome.ts` (live-only, exercised by a later approved smoke).
 *
 * Boundary invariants: the adapter NEVER controls Chrome's autofill dropdown / browser
 * chrome UI / macOS Accessibility / coordinate clicks / AppleScript, and NEVER reads a
 * credential value — the `LocalAgentPage` returns booleans/buckets only. The human does
 * the one field click + saved-credential selection (the `CLICK_USERNAME_FIELD_AND_
 * SELECT_SAVED_CREDENTIAL` request); the agent does at most one mode click + one submit.
 * Nothing here writes CapabilityStatus / schema / dedup, or runs export/download/upload.
 */

import type {
  ContextLauncher,
  SessionInspector,
  SyntheticCycle,
  WorkerContext,
} from "../esm/esm-worker-runtime";
import {
  LocalAgentRuntime,
  type CatchUpRequestSink,
  type CredentialObservationResult,
  type LocalAgentNotification,
  type LocalAgentNotifier,
  type LoginModeNormalizer,
  type LoginModeScan,
  type LoginSubmitter,
  type OperationalStateSink,
  type ReconnectSurface,
  type ReconnectSurfacePrep,
} from "./local-agent-runtime";
import type {
  CredentialPopulationObservation,
  InspectionVerdict,
  LocalAgentConnection,
  LocalAgentState,
  ReconnectInteractionCategory,
  SanitizedAccountRef,
} from "./local-agent-state";
import {
  computeFormSignature,
  modeCandidateShape,
  type LoginModeBindingStore,
  type SanitizedFormShape,
  type SanitizedModeCandidate,
} from "./local-agent-login-mode";
import type { ConnectorSyncState } from "../connection/sync-state";

// ── Injected page boundary (sanitized values only; no Playwright here) ─────────────────────────────

/** Pre-mode-click environment gate signals — booleans only, never a URL/host. */
export interface GateSignals {
  https: boolean;
  hostAllowlisted: boolean;
  challengePresent: boolean;
  unexpectedIframe: boolean;
}

/** A scanned login-mode candidate: sanitized shape + a session-local opaque click `token` (not identity). */
export interface RawModeCandidate extends SanitizedModeCandidate {
  /** Diagnostic-session-local click handle; never stored, never emitted, never identity. */
  token: string;
}

/** Sanitized credential-population read — booleans only; NO field values leave the page. */
export interface RawPopulation {
  usernamePopulated: boolean;
  passwordPopulated: boolean;
  challengePresent: boolean;
}

/**
 * The sanitized browser-page boundary the adapter drives. The real implementation
 * (live-only) runs `page.evaluate` scanners + a session classifier behind these
 * methods; every return value is a boolean / bucket / small enum — NEVER a URL,
 * host, selector, label, DOM text, or credential value.
 */
export interface LocalAgentPage {
  readGateSignals(): Promise<GateSignals>;
  scanLoginModeCandidates(): Promise<RawModeCandidate[]>;
  readFormShape(): Promise<SanitizedFormShape>;
  clickModeCandidate(token: string): Promise<void>;
  focusUsernameField(): Promise<void>;
  submitLoginForm(): Promise<void>;
  readPopulation(): Promise<RawPopulation>;
  classifySessionVerdict(): Promise<InspectionVerdict>;
  close(): Promise<void>;
}

/** A persistent-context handle carrying the sanitized page. Stable `id` proves reuse across calls. */
export interface LocalAgentContext extends WorkerContext {
  readonly page: LocalAgentPage;
}

const NO_CANDIDATE: LoginModeScan = { candidatePresent: false, candidate: null, alreadyActive: false };

/** Dependencies for the single-account Chrome adapter. */
export interface LocalAgentChromeAdapterDeps {
  account: SanitizedAccountRef;
  salt: string;
  bindingStore: LoginModeBindingStore;
  /** Produces one persistent context. Live impl launches Chrome; tests inject a fake page. */
  pageFactory: () => Promise<LocalAgentContext>;
}

/**
 * The concrete adapter — one instance per account. Implements every 1A injected
 * interface over the `LocalAgentPage` boundary. Tracks the sole live context and,
 * per reconnect, the pending mode-click token and the bound post-mode form signature.
 */
export class LocalAgentChromeAdapter
  implements ContextLauncher, SessionInspector, LoginModeNormalizer, ReconnectSurface, LoginSubmitter
{
  private current: LocalAgentContext | null = null;
  private pendingModeToken: string | null = null;
  private boundFormSignature: string | null = null;

  constructor(private readonly deps: LocalAgentChromeAdapterDeps) {}

  // ── ContextLauncher ──────────────────────────────────────────────────────────────────────────────
  async launch(): Promise<WorkerContext> {
    const ctx = await this.deps.pageFactory();
    this.current = ctx;
    this.pendingModeToken = null;
    this.boundFormSignature = null;
    return ctx;
  }

  private pageOf(ctx: WorkerContext): LocalAgentPage {
    return (ctx as LocalAgentContext).page;
  }

  // ── SessionInspector ─────────────────────────────────────────────────────────────────────────────
  async inspect(ctx: WorkerContext): Promise<InspectionVerdict> {
    return this.pageOf(ctx).classifySessionVerdict();
  }

  // ── LoginModeNormalizer ──────────────────────────────────────────────────────────────────────────
  /**
   * Pre-click gate: HTTPS + allowlisted host + top frame + no challenge + no
   * unexpected iframe, AND **exactly one** visible+enabled GMARKET·tab candidate.
   * Absent OR duplicate → fail closed (`candidatePresent:false` → zero clicks). The
   * returned `candidate` shape is what the runtime's exact-signature gate matches;
   * an index alone never authorizes a click.
   */
  async scanModeCandidate(ctx: WorkerContext): Promise<LoginModeScan> {
    const page = this.pageOf(ctx);
    const gate = await page.readGateSignals();
    if (!gate.https || !gate.hostAllowlisted || gate.challengePresent || gate.unexpectedIframe) {
      return NO_CANDIDATE;
    }
    const raw = await page.scanLoginModeCandidates();
    const gmarketTabs = raw.filter(
      (c) => c.modeCategory === "GMARKET" && c.interactiveCategory === "tab" && c.visible && c.enabled && c.topFrame,
    );
    if (gmarketTabs.length !== 1) return NO_CANDIDATE; // absent or ambiguous → fail closed
    const only = gmarketTabs[0]!;
    this.pendingModeToken = only.token;
    const shape = await page.readFormShape();
    return { candidatePresent: true, candidate: modeCandidateShape(only), alreadyActive: shape.gmarketTabActive };
  }

  /** The ONE mode-selection click — only after a matched scan bound a token. */
  async selectMode(ctx: WorkerContext): Promise<void> {
    if (this.pendingModeToken === null) {
      throw new Error("selectMode called without a matched candidate scan");
    }
    const token = this.pendingModeToken;
    this.pendingModeToken = null; // consume — never a second click from one scan
    await this.pageOf(ctx).clickModeCandidate(token);
  }

  // ── ReconnectSurface ─────────────────────────────────────────────────────────────────────────────
  /**
   * Establish + verify the post-mode-click Gmarket login form (1 id / 1 pw / submit,
   * no challenge), bind (or drift-check) its sanitized signature, then perform the ONE
   * agent-driven username field-focus click. Any drift/absence → `formShapeMatches:false`.
   */
  async prepare(ctx: WorkerContext): Promise<ReconnectSurfacePrep> {
    const page = this.pageOf(ctx);
    const shape = await page.readFormShape();
    const established =
      shape.formPresent && shape.idFieldBucket === "one" && shape.pwFieldBucket === "one" && !shape.challengePresent;
    if (!established) return { formShapeMatches: false };

    const liveSignature = computeFormSignature(shape, this.deps.salt);
    const binding = await this.deps.bindingStore.load(this.deps.account);
    if (binding?.postModeFormSignature && binding.postModeFormSignature !== liveSignature) {
      return { formShapeMatches: false }; // post-click form drift → fail closed
    }
    this.boundFormSignature = liveSignature;
    if (binding && !binding.postModeFormSignature) {
      await this.deps.bindingStore.save({ ...binding, postModeFormSignature: liveSignature });
    }
    await page.focusUsernameField(); // the ONE agent-driven username field-focus click
    return { formShapeMatches: true };
  }

  // ── LoginSubmitter ───────────────────────────────────────────────────────────────────────────────
  async submit(ctx: WorkerContext): Promise<void> {
    await this.pageOf(ctx).submitLoginForm();
  }

  // ── Credential-population observation (fed to runtime.submitCredentialObservation) ─────────────────
  /**
   * Read the SANITIZED population booleans + recompute `formSignatureMatch` against
   * the bound post-mode form signature. NO field values ever leave the page.
   */
  async observeCredentialPopulation(): Promise<CredentialPopulationObservation> {
    if (this.current === null) {
      throw new Error("observeCredentialPopulation: no active context");
    }
    const page = this.current.page;
    const pop = await page.readPopulation();
    const shape = await page.readFormShape();
    const formSignatureMatch =
      this.boundFormSignature !== null && computeFormSignature(shape, this.deps.salt) === this.boundFormSignature;
    return {
      usernamePopulated: pop.usernamePopulated,
      passwordPopulated: pop.passwordPopulated,
      challengePresent: pop.challengePresent,
      formSignatureMatch,
    };
  }
}

// ── Human-handoff notifier (sanitized user-action request) ─────────────────────────────────────────

/** The one sanitized user action the two-step reconnect requires. */
export type UserActionCode = "CLICK_USERNAME_FIELD_AND_SELECT_SAVED_CREDENTIAL";

/** A SANITIZED user-action request: an action enum + the hash-only account + the category. */
export interface UserActionRequest {
  action: UserActionCode;
  account: SanitizedAccountRef;
  interactionCategory: ReconnectInteractionCategory;
}

/**
 * Translates the 1A `CREDENTIAL_SELECTION_REQUIRED` notification into the concrete
 * two-step user-action request. Carries ONLY enums + a hash-only account ref.
 */
export class LocalAgentUserActionNotifier implements LocalAgentNotifier {
  readonly userActionRequests: UserActionRequest[] = [];
  readonly humanReconnectNotices: SanitizedAccountRef[] = [];

  constructor(private readonly interactionCategory: ReconnectInteractionCategory) {}

  async notify(notification: LocalAgentNotification): Promise<void> {
    if (notification.kind === "CREDENTIAL_SELECTION_REQUIRED") {
      this.userActionRequests.push({
        action: "CLICK_USERNAME_FIELD_AND_SELECT_SAVED_CREDENTIAL",
        account: notification.account,
        interactionCategory: this.interactionCategory,
      });
    } else {
      this.humanReconnectNotices.push(notification.account);
    }
  }
}

// ── Internal recorders + the export-disabled cycle guard ───────────────────────────────────────────

class CatchUpRecorder implements CatchUpRequestSink {
  readonly requests: SanitizedAccountRef[] = [];
  async request(account: SanitizedAccountRef): Promise<void> {
    this.requests.push(account);
  }
}

class OperationalRecorder implements OperationalStateSink {
  readonly states: ConnectorSyncState[] = [];
  async record(state: ConnectorSyncState): Promise<void> {
    this.states.push(state);
  }
}

/** C1 wires no workday sync — a tick would throw. Review export/download/upload is out of scope. */
const EXPORT_DISABLED_CYCLE: SyntheticCycle = {
  async run() {
    throw new Error("M-Agent-1C1: workday sync / review export is out of scope");
  },
};

// ── The reconnect service: wires the adapter into the merged 1A runtime ────────────────────────────

/**
 * Drives the real adapter through the merged `LocalAgentRuntime` up to `READY`:
 * `start` launches + inspects (assisted reconnect on a logged-out session);
 * `probeCredentialSelection` is the EXPLICIT/MANUAL poll (no background timer) that
 * reads the sanitized population and feeds the single-submit gate + verification.
 * Review export / download / upload / workday scheduling are NOT wired (out of scope).
 */
export class LocalAgentReconnectService {
  private readonly runtime: LocalAgentRuntime;
  private readonly catchUpRecorder = new CatchUpRecorder();
  private readonly operationalRecorder = new OperationalRecorder();
  readonly notifier: LocalAgentUserActionNotifier;

  constructor(
    private readonly adapter: LocalAgentChromeAdapter,
    opts: { salt: string; interactionCategory: ReconnectInteractionCategory },
  ) {
    this.notifier = new LocalAgentUserActionNotifier(opts.interactionCategory);
    this.runtime = new LocalAgentRuntime({
      launcher: adapter,
      inspector: adapter,
      loginModeNormalizer: adapter,
      reconnectSurface: adapter,
      submitter: adapter,
      notifier: this.notifier,
      catchUp: this.catchUpRecorder,
      cycle: EXPORT_DISABLED_CYCLE,
      operationalSink: this.operationalRecorder,
      salt: opts.salt,
    });
  }

  /** Launch + no-click inspect; on a logged-out session, run the assisted-reconnect preparation. */
  start(connection: LocalAgentConnection, now: Date | string): Promise<LocalAgentState> {
    return this.runtime.start(connection, now);
  }

  /**
   * Explicit/manual poll of the credential-selection surface (NO background timer):
   * read the sanitized observation and feed the 1A single-submit gate + verification.
   */
  async probeCredentialSelection(account: SanitizedAccountRef, now: Date | string): Promise<CredentialObservationResult> {
    const observation = await this.adapter.observeCredentialPopulation();
    return this.runtime.submitCredentialObservation(account, observation, now);
  }

  reinspect(account: SanitizedAccountRef, now: Date | string): Promise<LocalAgentState> {
    return this.runtime.reinspect(account, now);
  }
  restart(account: SanitizedAccountRef, now: Date | string): Promise<LocalAgentState> {
    return this.runtime.restart(account, now);
  }
  stop(account: SanitizedAccountRef): Promise<void> {
    return this.runtime.stop(account);
  }

  getState(account: SanitizedAccountRef): LocalAgentState | null {
    return this.runtime.getState(account);
  }
  getContextId(account: SanitizedAccountRef): string | null {
    return this.runtime.getContextId(account);
  }
  getOperationalState(account: SanitizedAccountRef): ConnectorSyncState | null {
    return this.runtime.getOperationalState(account);
  }

  get userActionRequests(): readonly UserActionRequest[] {
    return this.notifier.userActionRequests;
  }
  get catchUpRequests(): readonly SanitizedAccountRef[] {
    return this.catchUpRecorder.requests;
  }
  get operationalStates(): readonly ConnectorSyncState[] {
    return this.operationalRecorder.states;
  }
}
