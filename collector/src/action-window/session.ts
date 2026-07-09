/**
 * **Action Window Runtime session (R2).** The command-driven layer that connects the FE (over a
 * transport) to the pure R1 engine and a browser/synthetic probe driver.
 *
 * R1's `harness.ts` runs the whole loop in one shot (auto-recheck). R2 needs the loop to be
 * *command-reactive*: it advances the automatic stages by itself, then STOPS at the human checkpoint
 * and only proceeds to verification when the FE sends `REQUEST_STEP_RECHECK`. This session owns that
 * choreography while delegating:
 *   - decisions/state to the pure `ActionWindowEngine` (idempotency, revision checks, event ordering);
 *   - side effects (open surface, locate, highlight, observe click, verify) to a `ProbeDriver`.
 *
 * INVARIANT (inherited from R1): the session never clicks the target. It only *arms* observation and
 * reacts to a user action the driver reports. There is no target-click path here.
 *
 * Everything the session puts on the wire is an already-sanitized contract value (event, view, or a
 * command ack). No selector/URL/path/id/credential/page-content ever crosses this boundary.
 */
import {
  validateCommandEnvelope,
  type ActionWindowRunView,
  type EventEnvelope,
} from "../../../contracts/action-window/v1/index";
import type { AwClientFrame, AwServerFrame, AwServerTransport } from "../../../contracts/action-window/v1/transport";
import {
  ActionWindowEngine,
  type ArtifactValidateResult,
  type DownloadDetectResult,
  type Effect,
  type IngestResult,
  type LocateResult,
  type VerifyResult,
} from "./engine";

/**
 * The side-effecting probes the session drives. Two implementations exist: `SyntheticProbeDriver`
 * (below, offline/deterministic) and `BrowserProbeDriver` (`./browser-driver.ts`, RUN_INTEGRATION).
 */
export interface ProbeDriver {
  /** Open/verify the expected surface. Resolves true when it is the expected seller-center surface. */
  prepareSurface(): Promise<boolean>;
  /** Find the single actionable target. `count`/`sig` feed the engine's fail-closed 0/1/many logic. */
  locate(): Promise<LocateResult>;
  /** Spotlight the located target (never intercepts the click). */
  highlight(): Promise<void>;
  /** Begin observing for a *user* action on the target. */
  armObserve(): Promise<void>;
  /** Resolve true once the user (not the Runtime) acted on the target; false on timeout. */
  waitForUserAction(): Promise<boolean>;
  /** Check the expected post-action transition. `expectedSig` is the highlighted target's opaque ref. */
  verify(expectedSig: string): Promise<VerifyResult>;
  /**
   * Detect (read-only, never trigger) whether the verified user action produced a download.
   * Resolves `{detected:false}` on timeout; a detected artifact is reported as an OPAQUE 16-hex
   * `artifactRef` (see `artifact.ts`) — never a filename or path.
   */
  detectDownload(): Promise<DownloadDetectResult>;
  /** Validate the detected artifact (e.g. extension + magic sniff). Partial artifacts → invalid. */
  validateArtifact(artifactRef: string): Promise<ArtifactValidateResult>;
  /** Hand the validated artifact to the existing ingestion path (dedup-safe, idempotent). */
  ingest(artifactRef: string): Promise<IngestResult>;
  /** Tear down overlay/observer. Idempotent. */
  cleanup(): Promise<void>;
}

export class ActionWindowSession {
  private readonly engine: ActionWindowEngine;
  private readonly driver: ProbeDriver;
  private readonly transport: AwServerTransport;
  private readonly runId: string;

  private started = false;
  private publishedSeq = 0;
  /** True while an automatic drive chain is in flight (not at a rest point). */
  private autoBusy = false;
  private unsubscribe: (() => void) | null = null;
  /** Optional R3 persistence hook — invoked after every state publication (verified transition). */
  private readonly onStatePublished: (() => void) | undefined;

  constructor(
    engine: ActionWindowEngine,
    driver: ProbeDriver,
    transport: AwServerTransport,
    opts?: { onStatePublished?: () => void },
  ) {
    this.engine = engine;
    this.driver = driver;
    this.transport = transport;
    this.runId = engine.view().runId;
    this.onStatePublished = opts?.onStatePublished;
    // A session over a RESTORED engine (R3) continues, not restarts: the run counts as started, and
    // only events emitted from now on are pushed — history is served through resync, not re-broadcast.
    this.started = engine.isStarted();
    const restored = engine.events();
    this.publishedSeq = restored.length > 0 ? restored[restored.length - 1]!.sequence : 0;
  }

  /** Attach to the transport and begin handling client frames. Returns a detach function. */
  attach(): () => void {
    if (this.unsubscribe) return this.unsubscribe;
    this.unsubscribe = this.transport.subscribe((frame) => this.handle(frame));
    return this.unsubscribe;
  }

  /**
   * Resolves once the session is at a resting point — a terminal stage or the human-action barrier —
   * with no automatic drive in flight. Drains microtasks so it also covers a just-observed user
   * action (which mutates state synchronously). Test-facing determinism hook; production doesn't need it.
   */
  async whenSettled(): Promise<void> {
    // Yield to the MACROTASK queue each turn (not just microtasks): a real BrowserProbeDriver awaits
    // genuine I/O, which a microtask-only drain would starve. Microtasks still flush before each timer,
    // so a just-observed user action is included. Resolves as soon as no auto-drive is in flight.
    for (let i = 0; i < 100_000; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!this.autoBusy) return;
    }
    throw new Error("action-window session: whenSettled did not converge");
  }

  /* ── inbound frames ─────────────────────────────────────────────────────── */
  private handle(frame: AwClientFrame): void {
    if (frame.kind === "aw_resync") {
      this.resync(frame.runId, frame.sinceSequence);
      return;
    }
    // aw_command
    const command = frame.command;
    const valid = validateCommandEnvelope(command);
    if (!valid.ok) {
      this.transport.send({ kind: "aw_command_result", commandId: safeCommandId(command), accepted: false, reason: "INVALID_ENVELOPE" });
      return;
    }

    const outcome = this.engine.command(command);
    this.transport.send({
      kind: "aw_command_result",
      commandId: command.commandId,
      accepted: outcome.ok,
      ...(outcome.ok ? {} : { reason: outcome.reason }),
    });
    this.publishState();

    if (command.type === "START_RUN" && outcome.ok) this.started = true;

    if (outcome.ok && "effect" in outcome && isDrivingEffect(outcome.effect)) {
      this.autoBusy = true;
      void this.drive(outcome.effect)
        .catch(() => this.fatalCleanup())
        .finally(() => {
          this.autoBusy = false;
        });
    }
  }

  private resync(runId: string, sinceSequence: number): void {
    if (runId !== this.runId || !this.started) {
      this.transport.send({ kind: "aw_resync_result", view: null, events: [] });
      return;
    }
    const events = this.engine.events().filter((e) => e.sequence > sinceSequence);
    this.transport.send({ kind: "aw_resync_result", view: this.engine.view(), events });
  }

  /* ── automatic drive ───────────────────────────────────────────────────── */
  private async drive(effect: Effect): Promise<void> {
    switch (effect) {
      case "PREPARE": {
        const ok = await this.driver.prepareSurface();
        const next = this.engine.onSurfaceReady(ok);
        this.publishState();
        return this.drive(next);
      }
      case "LOCATE": {
        const res = await this.driver.locate();
        const next = this.engine.onLocated(res);
        this.publishState();
        return this.drive(next);
      }
      case "HIGHLIGHT": {
        await this.driver.highlight();
        const next = this.engine.onHighlighted();
        this.publishState();
        return this.drive(next);
      }
      case "OBSERVE": {
        await this.driver.armObserve();
        // Reached the human-action barrier: the FE now shows the checkpoint and the user acts. The
        // observation runs as a separate task so this drive chain rests here (it must not block on a
        // human). The session still never clicks — it only reacts to a reported user action.
        void this.watchUserAction();
        return;
      }
      case "VERIFY": {
        const res = await this.driver.verify(this.highlightedSig());
        const next = this.engine.onVerified(res);
        this.publishState();
        // Verified → continue into the downstream chain; not verified → back to the barrier.
        return this.drive(next);
      }
      case "DETECT_DOWNLOAD": {
        const res = await this.driver.detectDownload();
        const next = this.engine.onDownloadDetected(res);
        this.publishState();
        return this.drive(next);
      }
      case "VALIDATE_ARTIFACT": {
        const res = await this.driver.validateArtifact(this.detectedArtifactRef());
        const next = this.engine.onArtifactValidated(res);
        this.publishState();
        return this.drive(next);
      }
      case "INGEST": {
        const res = await this.driver.ingest(this.detectedArtifactRef());
        const next = this.engine.onIngested(res);
        this.publishState();
        return this.drive(next);
      }
      case "CLEANUP": {
        await this.driver.cleanup();
        return;
      }
      case "NONE":
      default:
        return;
    }
  }

  /** Wait for a *user* action on the target (never clicks), then record it as an observation. */
  private async watchUserAction(): Promise<void> {
    const observed = await this.driver.waitForUserAction();
    if (observed && this.engine.currentStage() === "WAIT_FOR_USER_ACTION") {
      this.engine.onUserActionObserved();
      this.publishState();
    }
  }

  private async fatalCleanup(): Promise<void> {
    await this.driver.cleanup().catch(() => {});
  }

  /* ── outbound publishing ───────────────────────────────────────────────── */
  /** Flush any newly-emitted engine events in order, then the latest sanitized View Model. */
  private publishState(): void {
    const events = this.engine.events();
    for (const e of events) {
      if (e.sequence > this.publishedSeq) {
        this.transport.send({ kind: "aw_event", event: e });
        this.publishedSeq = e.sequence;
      }
    }
    this.transport.send({ kind: "aw_view", view: this.engine.view() });
    // R3: every published state is a persisted state (the hook records the run after each verified
    // transition). Publication order is the persistence order.
    this.onStatePublished?.();
  }

  private highlightedSig(): string {
    const e = this.engine.events().find((ev) => ev.type === "TARGET_HIGHLIGHTED");
    return e?.payload.targetRef ?? "";
  }

  /** The LAST detected artifact ref (a resumed run may detect again — the newest one is current). */
  private detectedArtifactRef(): string {
    const events = this.engine.events();
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]!.type === "DOWNLOAD_DETECTED") return events[i]!.payload.artifactRef ?? "";
    }
    return "";
  }
}

function isDrivingEffect(effect: Effect): boolean {
  return effect !== "NONE";
}

/** Command id that is safe to echo back even when the envelope failed validation. */
function safeCommandId(command: unknown): string {
  const id = (command as { commandId?: unknown })?.commandId;
  return typeof id === "string" ? id : "unknown";
}

/* ────────────────────────── Synthetic probe driver ────────────────────────── */

export interface SyntheticProbeOptions {
  surfaceOk?: boolean;
  locate?: LocateResult;
  verify?: VerifyResult;
  detect?: DownloadDetectResult;
  validate?: ArtifactValidateResult;
  ingestResult?: IngestResult;
}

/** Deterministic default synthetic artifact ref (a valid opaque 16-hex, like a real hashed ref). */
export const SYNTHETIC_ARTIFACT_REF = "0f1e2d3c4b5a6978";

/**
 * Deterministic offline driver. No browser, no download, no backend. Surface/locate/verify and the
 * downstream (detect/validate/ingest) results are configurable, and the "user action" is delivered
 * explicitly via {@link completeUserAction} — the session never clicks.
 */
export class SyntheticProbeDriver implements ProbeDriver {
  private readonly surfaceOk: boolean;
  private readonly locateResult: LocateResult;
  private readonly verifyResult: VerifyResult;
  private readonly detectResult: DownloadDetectResult;
  private readonly validateResult: ArtifactValidateResult;
  private readonly ingestOutcome: IngestResult;

  private userActionResolve: ((observed: boolean) => void) | null = null;
  private pendingUserAction: boolean | null = null;

  constructor(opts: SyntheticProbeOptions = {}) {
    this.surfaceOk = opts.surfaceOk ?? true;
    this.locateResult = opts.locate ?? { count: 1, sig: "a1b2c3d4e5f60718" };
    this.verifyResult = opts.verify ?? { verified: true, drift: false };
    this.detectResult = opts.detect ?? { detected: true, artifactRef: SYNTHETIC_ARTIFACT_REF };
    this.validateResult = opts.validate ?? { valid: true };
    this.ingestOutcome = opts.ingestResult ?? { ok: true, processed: 1 };
  }

  prepareSurface(): Promise<boolean> {
    return Promise.resolve(this.surfaceOk);
  }
  locate(): Promise<LocateResult> {
    return Promise.resolve(this.locateResult);
  }
  highlight(): Promise<void> {
    return Promise.resolve();
  }
  armObserve(): Promise<void> {
    return Promise.resolve();
  }
  waitForUserAction(): Promise<boolean> {
    if (this.pendingUserAction !== null) {
      const v = this.pendingUserAction;
      this.pendingUserAction = null;
      return Promise.resolve(v);
    }
    return new Promise((resolve) => {
      this.userActionResolve = resolve;
    });
  }
  verify(_expectedSig: string): Promise<VerifyResult> {
    return Promise.resolve(this.verifyResult);
  }
  detectDownload(): Promise<DownloadDetectResult> {
    return Promise.resolve(this.detectResult);
  }
  validateArtifact(_artifactRef: string): Promise<ArtifactValidateResult> {
    return Promise.resolve(this.validateResult);
  }
  ingest(_artifactRef: string): Promise<IngestResult> {
    return Promise.resolve(this.ingestOutcome);
  }
  cleanup(): Promise<void> {
    return Promise.resolve();
  }

  /** TEST-ONLY: report that the user acted on (or did not act on) the target. Mirrors a real observation. */
  completeUserAction(observed = true): void {
    if (this.userActionResolve) {
      const resolve = this.userActionResolve;
      this.userActionResolve = null;
      resolve(observed);
    } else {
      this.pendingUserAction = observed;
    }
  }
}

export type { ActionWindowRunView, EventEnvelope, AwServerFrame };
