/**
 * **Coupang WING API-issuance guidance session supervisor (ISOLATED, v2).** Connects the FE (over a v2
 * transport) to the pure {@link CoupangIssuanceEngine} and a {@link CoupangIssuanceProbeDriver}. The Coupang-side
 * sibling of the NAVER `IssuanceGuidanceSession`.
 *
 * An issuance agent hosts exactly ONE run for its lifetime (no per-segment re-arming, no launch ref, no in-page
 * guidance panel). It arms observation and reacts to what the driver reports the SELLER did, it never performs a
 * marketplace action, and it puts only sanitized v2 contract values on the wire.
 *
 * A `{ guide }` effect is handled here as ONE batched unit — locate, then (if the control was found) highlight —
 * publishing only once, so the frontend never sees a half-armed intermediate view.
 */
import { validateCommandEnvelope, type CommandEnvelope } from "../../../../contracts/action-window/v2/index";
import type { AwClientFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import { log } from "../../log";
import type { CoupangIssuanceEffect, CoupangIssuanceEngine } from "./coupang-issuance-engine";
import {
  COUPANG_TARGET_BARRIER_STAGE,
  coupangIssuanceParkNotice,
  type CoupangIssuanceProbeDriver,
  type CoupangIssuanceTarget,
} from "./coupang-issuance-driver";
import { isCoupangIssuancePark, isCoupangIssuanceTerminal } from "./coupang-issuance-stages";

export interface CoupangIssuanceSessionOptions {
  /** Fires after every published transition — the persistence hook. */
  onStatePublished?: () => void;
  /** Floor delay between barrier re-arms. A safety floor, not a tuning knob. */
  rearmDelayMs?: number;
  /** How often an observed wait re-reads WING while the seller logs in / navigates. Tests set 0. */
  surfaceWaitPollMs?: number;
  /** How long an observed wait keeps looking. The seated-operator window — never unbounded. */
  surfaceWaitTimeoutMs?: number;
  /**
   * **Perform the credential handoff for this run**, with the seller's one-shot capability.
   *
   * Injected rather than imported so this session holds no backend origin, no account slot and no credential
   * reader — it decides WHEN a handoff may run and never how. Absent ⇒ the capability is refused, which is what
   * every scripted test driver and every non-Coupang host gets.
   *
   * The seam returns a value-free outcome. It must never return a secret, and by its type it cannot.
   */
  credentialHandoff?: (capability: string) => Promise<CredentialHandoffSeamResult>;
}

/** What a handoff attempt reports back. Value-free by construction — no field here can hold a secret. */
export interface CredentialHandoffSeamResult {
  /** Whether the credential reached the vault. Only `true` lets the walk complete its final step. */
  readonly stored: boolean;
  /** The backend's safe connection status, when it answered one. Never a provider body. */
  readonly connectionStatus?: string;
  /** A safe reason code for a handoff that did not store. Never a value, never page text. */
  readonly reason?: string;
}

export class CoupangIssuanceGuidanceSession {
  private readonly engine: CoupangIssuanceEngine;
  private readonly driver: CoupangIssuanceProbeDriver;
  private readonly transport: AwServerTransport;
  private readonly runId: string;
  private readonly onStatePublished: (() => void) | undefined;
  private readonly rearmDelayMs: number;
  private readonly surfaceWaitPollMs: number;
  private readonly surfaceWaitTimeoutMs: number;
  private readonly credentialHandoff: ((capability: string) => Promise<CredentialHandoffSeamResult>) | undefined;
  /** One handoff per run, latched here as well as at the backend — a second press must not read a screen again. */
  private handoffAttempted = false;
  /** At most ONE park-recovery loop at a time — several would each issue their own recheck. */
  private recovering = false;
  /** At most ONE surface-wait loop at a time — several would each probe and each advance the run. */
  private awaitingSurface = false;
  /**
   * The seller closed the WING window and has not asked for anything since.
   *
   * Latched so no TIMER can re-open it: every automatic recovery this session has goes through a drive, and a
   * drive brings the lazy window up. Cleared by the seller's next command, which is the one re-open that was
   * ever theirs to ask for.
   */
  private surfaceClosed = false;
  /** The park notice currently on the WING window, so it is drawn once per park and not once per recovery tick. */
  private parkNoticeShown: string | null = null;

  /**
   * **Stopped for good** — the host tore this session down (the resident helper releasing the walk, or the agent
   * shutting down). Every automatic loop checks it at each poll and every drive refuses.
   *
   * Without it a released session kept its own timers: `awaitSurface` polls `probeSurface()` once a second, the
   * lazy driver re-opens a window it has been told to forget, and the marketplace window the host had just
   * closed came straight back (observed 2026-08-19, on the first on-demand release). `isPaused` / terminal were
   * the only exits those loops had, and neither describes "nobody is hosting this run any more".
   */
  private stopped = false;

  private started = false;
  private publishedSeq = 0;
  /** Refcount of automatic drives in flight — NOT a boolean (the START drive and a detached watchBarrier run
   * concurrently and each own a unit of "busy"; only when EVERY drive settles does `whenSettled` return). */
  private busyCount = 0;
  private unsubscribe: (() => void) | null = null;
  private surfaceCloseToken = 0;

  constructor(
    engine: CoupangIssuanceEngine,
    driver: CoupangIssuanceProbeDriver,
    transport: AwServerTransport,
    opts?: CoupangIssuanceSessionOptions,
  ) {
    this.engine = engine;
    this.driver = driver;
    this.transport = transport;
    this.runId = engine.view().runId;
    this.started = engine.isStarted();
    this.onStatePublished = opts?.onStatePublished;
    this.rearmDelayMs = opts?.rearmDelayMs ?? 250;
    this.surfaceWaitPollMs = opts?.surfaceWaitPollMs ?? 1_000;
    this.surfaceWaitTimeoutMs = opts?.surfaceWaitTimeoutMs ?? 10 * 60_000;
    this.credentialHandoff = opts?.credentialHandoff;
  }

  attach(): () => void {
    if (this.unsubscribe) return this.unsubscribe;
    const stopTransport = this.transport.subscribe((frame) => this.handle(frame));
    this.unsubscribe = () => {
      this.surfaceCloseToken += 1;
      this.stopped = true;
      stopTransport();
    };
    return this.unsubscribe;
  }

  /** Whether this session has been torn down. Sanitized boolean, for the host and for tests. */
  isStopped(): boolean {
    return this.stopped;
  }

  /** Resolves once no automatic drive is in flight (test-facing determinism hook). */
  async whenSettled(): Promise<void> {
    for (let i = 0; i < 100_000; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (this.busyCount === 0) return;
    }
    throw new Error("coupang issuance session: whenSettled did not converge");
  }

  private handle(frame: AwClientFrame): void {
    if (frame.kind === "aw_guidance_pack") {
      // Coupang issuance has no in-page guidance panel (the seller works in the WING window), so a pack is
      // accepted-and-ignored rather than driving anything.
      log("aw_coupang_issuance_guidance_pack_ignored", { accepted: true });
      return;
    }
    if (frame.kind === "aw_resync") {
      if (frame.runId !== this.runId || !this.started) {
        this.transport.send({ kind: "aw_resync_result", view: null, events: [] });
        return;
      }
      const events = this.engine.events().filter((e) => e.sequence > frame.sinceSequence);
      this.transport.send({ kind: "aw_resync_result", view: this.engine.view(), events });
      return;
    }
    const command = frame.command;
    const valid = validateCommandEnvelope(command);
    if (!valid.ok) {
      this.transport.send({ kind: "aw_command_result", commandId: safeCommandId(command), accepted: false, reason: "INVALID_ENVELOPE" });
      return;
    }
    // **The one command that may carry a credential-handoff capability**, and the only place it is read.
    //
    // The seller pressed "저장하기" in SellerOps, which minted a one-shot capability bound to them, this
    // account and this run. The press is the barrier: it discloses that SellerOps will READ the three values
    // from the WING screen, SEND them to the vault, and VERIFY the connection — the same chain the operator's
    // own action barrier discloses. Nothing here reads anything until it has arrived.
    const capability = credentialHandoffCapabilityOf(command);
    if (capability !== null) {
      void this.runCredentialHandoff(command, capability);
      return;
    }
    const outcome = this.engine.command(command);
    // An accepted command is the SELLER asking for something, which is the one thing that may re-open a window
    // they closed. Cleared before the drive, so the chain this command starts is allowed to bring it back up.
    if (outcome.ok) this.surfaceClosed = false;
    this.transport.send({
      kind: "aw_command_result",
      commandId: command.commandId,
      accepted: outcome.ok,
      ...(outcome.ok ? {} : { reason: outcome.reason }),
    });
    this.publishState();
    if (command.type === "START_RUN" && outcome.ok) this.started = true;
    // **"현재 단계 다시 찾기" = put the WING window back in front of the seller.**
    //
    // The walk lives in a window SellerOps opened and the seller then loses behind everything else — reported
    // 2026-08-12 as "FE에서 해당 창을 찾아들어가기 어렵다". The engine treats this command as a no-op, and it
    // stays one: nothing is navigated, nothing is clicked, no window is opened. It RAISES the surface that
    // already exists, and a run with no window does nothing at all rather than bringing one up (that is what
    // starting the walk is for).
    if (command.type === "FIND_CURRENT_STEP" && outcome.ok) {
      void this.driver
        .focusSurface?.()
        .then((raised) => log("aw_coupang_surface_focus", { raised }))
        .catch(() => log("aw_coupang_surface_focus", { raised: false }, "warn"));
    }
    if (outcome.ok && "effect" in outcome && !isNoop(outcome.effect)) {
      this.busyCount += 1;
      void this.drive(outcome.effect)
        .catch((e) => this.onDriveError(e))
        .finally(() => {
          this.busyCount -= 1;
        });
    }
  }

  /**
   * **Read the credential the seller just issued, hand it to the vault, and only then complete the step.**
   *
   * Every refusal here happens BEFORE anything is read. The order is the whole safety argument:
   *
   *  1. this host must actually be able to perform a handoff (a scripted or non-Coupang host cannot);
   *  2. the run must be resting on the credentials step — the walk's own evidence that the seller reached the
   *      screen where the keys are, which is a stronger claim than any flag a caller could send;
   *  3. one per run, latched here as well as at the backend — a second press must not read a screen again;
   *  4. the marketplace window must be open, because a read needs a screen to read.
   *
   * The step completes only on a STORED credential. A handoff that did not store leaves the walk exactly where
   * it was, with a safe reason on the command result — so the seller sees "저장하지 못했어요", not a finished
   * walk with nothing in the vault.
   */
  private async runCredentialHandoff(command: CommandEnvelope, capability: string): Promise<void> {
    const refuse = (reason: string): void => {
      log("aw_coupang_issuance_handoff_refused", { runId: this.runId, reason });
      this.transport.send({ kind: "aw_command_result", commandId: command.commandId, accepted: false, reason });
    };
    if (!this.credentialHandoff) return refuse("HANDOFF_NOT_SUPPORTED_HERE");
    if (this.engine.activeTarget() !== "credentials") return refuse("HANDOFF_NOT_AT_CREDENTIAL_STEP");
    if (this.handoffAttempted) return refuse("HANDOFF_ALREADY_ATTEMPTED");
    if (this.surfaceClosed) return refuse("HANDOFF_SURFACE_CLOSED");
    this.handoffAttempted = true;

    this.busyCount += 1;
    try {
      // From here the seam owns the read. It is given the capability and nothing else, and it answers with an
      // outcome that has no field a secret could travel in.
      const result = await this.credentialHandoff(capability);
      log("aw_coupang_issuance_handoff", {
        runId: this.runId,
        stored: result.stored,
        ...(result.connectionStatus ? { connectionStatus: result.connectionStatus } : {}),
        ...(result.reason ? { reason: result.reason } : {}),
      });
      if (!result.stored) {
        this.transport.send({
          kind: "aw_command_result",
          commandId: command.commandId,
          accepted: false,
          reason: result.reason ?? "HANDOFF_STORE_FAILED",
        });
        return;
      }
      this.transport.send({ kind: "aw_command_result", commandId: command.commandId, accepted: true });
      // Stored. NOW the checkpoint may complete — the walk's last step is "the credential is with SellerOps",
      // and completing it before the store would say so while the vault was empty.
      // Re-issued to the engine WITHOUT the payload: the capability has been spent and the engine's job is the
      // ordinary checkpoint advance, which takes no payload and must not learn about capabilities at all.
      const outcome = this.engine.command({ type: command.type, expectedRevision: command.expectedRevision });
      this.publishState();
      if (outcome.ok && "effect" in outcome && !isNoop(outcome.effect)) {
        await this.drive(outcome.effect);
      }
    } catch (e) {
      // The error is NOT echoed: a transport failure can quote the request it failed on.
      log("aw_coupang_issuance_handoff", { runId: this.runId, stored: false, reason: errName(e) }, "warn");
      this.transport.send({
        kind: "aw_command_result",
        commandId: command.commandId,
        accepted: false,
        reason: "HANDOFF_TRANSPORT_FAILED",
      });
    } finally {
      this.busyCount -= 1;
    }
  }

  private async onDriveError(e: unknown): Promise<void> {
    // A fault on a torn-down session is the teardown itself — the retired driver refusing a call from a loop
    // that was still unwinding. There is nobody to publish a park to, and parking a released run would be a lie.
    if (this.stopped) return;
    // A drive fault is most often a NAVIGATION RACE — an in-page locate/highlight read fired while the seller's
    // own page was still moving, destroying the execution context. Do NOT fail closed and leave the run idle:
    // ask the engine to PARK recoverably on page_mismatch, so a `REQUEST_STEP_RECHECK` re-settles and re-guides.
    log("aw_coupang_issuance_drive_error", { reason: errName(e) }, "warn");
    const effect = this.engine.onDriveFault();
    this.publishState();
    if (!isNoop(effect)) {
      try {
        await this.drive(effect);
      } catch (err) {
        void this.driver.cleanup().catch(() => undefined);
        log("aw_coupang_issuance_cleanup_failed", { reason: errName(err) }, "warn");
      }
    }
  }

  private async drive(effect: CoupangIssuanceEffect): Promise<void> {
    // A torn-down session drives nothing: every effect below either touches the driver (which would re-open a
    // window the host just closed) or publishes to a transport nobody is subscribed to.
    if (this.stopped) return;
    // **THE choke point for a closed surface.** Every effect below reaches the driver, and the lazy driver
    // brings a window up on ANY call — so "does this particular path re-open the window?" has to be answered
    // once here, not per call site. It had been answered per call site three times (`awaitSurface`,
    // `maybeRecoverPark`, and the close handler's own `CLEAR_HIGHLIGHT`) and a fourth path was always going to
    // be missed: live 2026-08-20, a park-recovery loop that had STARTED before the close kept driving after it
    // (`aw_coupang_walk_surface_closed` 06:48:49.756 → `landing_skipped ALREADY_NAVIGATED_ONCE` 06:48:50.014),
    // and because the landing is once-per-carrier the window it brought back was blank.
    //
    // The latch is cleared in exactly one place — an ACCEPTED seller command (`handleFrame`) — so re-opening
    // stays something the seller asks for and never something a timer does.
    if (this.surfaceClosed) return;
    if (typeof effect === "object") {
      if ("guide" in effect) return this.guide(effect.guide);
      // `observe` rests at a seller barrier. The watcher runs detached so the drive chain unwinds and the run is
      // genuinely idle while the seller works in the WING window.
      await this.driver.armObserve(effect.observe);
      // Detached, but never UNHANDLED: the barrier's first `observeUserAction` is awaited outside its own
      // try, so a driver that is retired mid-await (the host released this walk) would reject a floating
      // promise and, on this Node major, take the agent down with it. A released session's `onDriveError`
      // returns at once, so this catch is a teardown sink, not a second park path.
      void this.watchBarrier(effect.observe).catch((e) => this.onDriveError(e));
      return;
    }
    switch (effect) {
      case "PROBE": {
        const probe = await this.driver.probeSurface();
        this.watchSurfaceClose();
        const next = this.engine.onSurfaceProbed(probe);
        this.publishState();
        return this.drive(next);
      }
      case "CHECK_CREDENTIAL_STATE": {
        // **A driver that cannot answer answers UNKNOWN**, which parks. The alternative — treating a missing
        // capability as "no key" — is the one wrong answer that walks a seller into creating a second one, and
        // it would be given by a driver that is merely OLD rather than by a page that is ambiguous.
        const probe = this.driver.probeCredentialState;
        const state = probe ? await probe.call(this.driver).catch(() => "UNKNOWN" as const) : ("UNKNOWN" as const);
        // The enum, and nothing else. It is derived from a value-free census plus one non-emptiness bit per
        // cell; no credential value exists on this path to be logged.
        log("aw_coupang_issuance_credential_state", { runId: this.runId, state });
        const next = this.engine.onCredentialStateProbed(state);
        this.publishState();
        return this.drive(next);
      }
      case "VERIFY_REACH": {
        // The seller navigated to the issuance page (a navigation the driver observed). Re-read the sanitized page
        // category and let the engine confirm it is open_api_issuance before guiding 자체개발. BOUNDED POLLING: the
        // SPA can classify as a transient `unknown` mid-hydration, so use the driver's settled probe if present.
        const probe = await (this.driver.probeSurfaceSettled?.() ?? this.driver.probeSurface());
        const next = this.engine.onReachVerified(probe);
        this.publishState();
        return this.drive(next);
      }
      case "AWAIT_SURFACE": {
        // SINGLE-FLIGHT, like `recovering` already does for park recovery. `waiting_login` is a park, so while
        // one loop polls the FE is offered `REQUEST_STEP_RECHECK`; pressing it re-probed, read login again, and
        // asked for a SECOND loop beside the first. Both then reported the issuance page before either narrowed
        // the stage — duplicate `STEP_COMPLETED`, two `{guide:"issue"}` chains, two observers on one target.
        // (The engine's own probe guard now stops the duplicate advance; this stops the duplicate WATCHER.)
        if (this.awaitingSurface) return;
        this.awaitingSurface = true;
        let next: CoupangIssuanceEffect;
        try {
          next = await this.awaitSurface();
        } finally {
          this.awaitingSurface = false;
        }
        // Driven OUTSIDE the single-flight window, so a chain that comes back through here is not refused by the
        // loop that is unwinding to start it. `NONE` ends the chain here rather than falling into
        // `maybeRecoverPark`: the watch has just STOPPED, and re-entering it on a timer is what the bound exists
        // to prevent (see `onSurfaceWaitExpired`).
        if (isNoop(next)) return;
        return this.drive(next);
      }
      case "CLEAR_HIGHLIGHT": {
        await this.driver.clearHighlight();
        this.showParkNoticeIfParked();
        this.maybeRecoverPark();
        return;
      }
      case "CLEANUP": {
        await this.driver.cleanup();
        return;
      }
      case "NONE":
      default:
        this.showParkNoticeIfParked();
        this.maybeRecoverPark();
        return;
    }
  }

  /**
   * Keep looking, inside WING, until the seller gets somewhere we recognize. This is the loop that lets a run
   * start on a blank tab and survive a login without anyone touching the SellerOps tab.
   *
   * The engine's wait states are idempotent, so re-reading the same page emits nothing; only a CHANGE produces a
   * transition. Bounded by the same seated-operator window every other observation uses — an unbounded loop
   * would outlive the run and keep polling a page nobody is looking at.
   * Counted in POLLS, not in accumulated milliseconds: a zero-delay cadence (which tests use, and which a caller
   * could pass) would advance an elapsed-time accumulator by zero and loop forever.
   *
   * Returns the effect to drive AFTER the watch ends — driven by the caller, outside the single-flight window,
   * so a chain that comes back through here is not refused by the loop that is unwinding to start it.
   */
  private async awaitSurface(): Promise<CoupangIssuanceEffect> {
    const maxPolls = Math.max(1, Math.ceil(this.surfaceWaitTimeoutMs / Math.max(1, this.surfaceWaitPollMs)));
    for (let i = 0; i < maxPolls; i++) {
      if (this.stopped || this.engine.isPaused() || isCoupangIssuanceTerminal(this.engine.currentStage())) return "NONE";
      await new Promise<void>((resolve) => setTimeout(resolve, this.surfaceWaitPollMs));
      if (this.stopped || this.engine.isPaused() || isCoupangIssuanceTerminal(this.engine.currentStage())) return "NONE";
      /**
       * **NEVER poll a surface the seller CLOSED.** The same rule `maybeRecoverPark` states and guards on, and
       * this loop was the one place missing it — which is what made it visible.
       *
       * `probeSurface` goes through the LAZY driver, and a lazy driver's contract is "re-open on the next
       * call". So once the seller closed the WING window, every tick of this loop re-opened one — and because
       * the landing is once-per-carrier (`aw_coupang_walk_landing_skipped: ALREADY_NAVIGATED_ONCE`), what it
       * re-opened was a BLANK tab. Live 2026-08-19: 13 `aw_coupang_walk_surface_closed` events, each followed
       * within a second by a re-open, 696 of 744 probes reading `unknown` — a seller closing a tab and getting
       * an empty one back, once a second, for as long as the run lived.
       *
       * Closing the window is already a first-class outcome: `onSurfaceClosed` latches this flag and parks the
       * run, and the park's recovery is the seller's own `REQUEST_STEP_RECHECK` (which clears the latch at
       * `command`). Returning here hands the loop back to that park instead of racing it.
       */
      if (this.surfaceClosed) return "NONE";
      const again = await this.driver.probeSurface();
      const next = this.engine.onSurfaceProbed(again);
      this.publishState();
      if (next !== "AWAIT_SURFACE") return next;
    }
    // The window is over and NOTHING is watching WING any more. Returning here left the run reporting RUNNING
    // with no blocker, no recheck offered and no recovery loop — the one state on this walk a seller could not
    // get out of. Hand it to the engine, which converts the wait into a recoverable park.
    const expired = this.engine.onSurfaceWaitExpired();
    this.publishState();
    return expired;
  }

  /**
   * **A parked run still says so ON the marketplace window.**
   *
   * Fail-closed took the guidance down and left nothing behind: the seller reached the API-key page, the
   * credential read came back `UNKNOWN`, the run parked exactly as it should — and the tutorial vanished, with
   * the explanation sitting in a tab they were not looking at (live 2026-08-20). Parking is right; parking
   * INVISIBLY is the defect. So the docked panel stays up, carrying what SellerOps could not do.
   *
   * It is deliberately not a step: no ring, no button, no next action. `showParkNotice` on the driver is what
   * enforces that; this only decides WHEN.
   *
   * Mounted once per park, not once per recovery tick — the recovery loop re-parks on the same code every
   * second, and re-drawing the panel at 1 Hz would make it flicker on the seller's screen.
   */
  private showParkNoticeIfParked(): void {
    if (this.stopped || this.surfaceClosed) return;
    const show = this.driver.showParkNotice;
    if (!show) return;
    const parked = isCoupangIssuancePark(this.engine.currentStage()) && !this.engine.isPaused();
    const code = parked ? coupangIssuanceParkNotice(this.engine.view().blocker?.code) : null;
    if (code === this.parkNoticeShown) return;
    this.parkNoticeShown = code;
    if (code === null) return;
    void show
      .call(this.driver, code)
      .then((painted) => log("aw_coupang_issuance_park_notice", { code, painted }))
      .catch((e) => log("aw_coupang_issuance_park_notice_failed", { code, reason: errName(e) }, "warn"));
  }

  /**
   * **Take the seller's declaration off the WING panel and let the walk continue.**
   *
   * The runtime could not tell whether this account already holds a key, so it parked — and for a page whose
   * label census refuses (live 2026-08-20: `LABEL_NOT_UNIQUE` on 업체코드) that park had no exit at all: every
   * re-check re-read the same ambiguity. The exit is the seller answering, on the page where the answer is
   * written, with a SellerOps button that presses nothing on the marketplace.
   *
   * Returns whether the run MOVED, so the recovery loop stops rather than issuing a recheck into a walk that is
   * now guiding a step.
   */
  private async consumeParkConfirmation(): Promise<boolean> {
    const read = this.driver.readParkNoticeConfirmed;
    if (!read || this.surfaceClosed) return false;
    const code = coupangIssuanceParkNotice(this.engine.view().blocker?.code);
    if (code !== "CREDENTIAL_STATE_UNKNOWN") return false;
    const pressed = await read.call(this.driver, code).catch(() => false);
    if (!pressed) return false;
    // Sanitized: WHAT was declared and that a human declared it — never a page reading, because there is none.
    log("aw_coupang_issuance_credential_declared", { runId: this.runId, by: "SELLER_ON_SURFACE", state: "NO_KEY" });
    const next = this.engine.confirmCredentialAbsent();
    // The notice is being replaced by the step's own guidance; forget it so a later park re-draws.
    this.parkNoticeShown = null;
    this.publishState();
    if (isNoop(next)) return false;
    await this.drive(next);
    return true;
  }

  /**
   * Start the park recovery loop if the run has settled into one, and only one loop at a time.
   *
   * Called where a drive chain ENDS, because that is where a park becomes visible: the effect that produced it
   * has been applied and nothing else is going to move the run.
   */
  private maybeRecoverPark(): void {
    if (this.recovering || this.stopped) return;
    // **NEVER auto-recover a surface the seller CLOSED.** Self-recovery drives a `{guide}`, which settles and
    // locates — and the lazy driver brings a window up on its first call, so a timer-issued recheck would
    // re-open the marketplace window the seller had just deliberately closed, once a second for ten minutes.
    // The engine's own note on this park says how it recovers: "re-opening and a `REQUEST_STEP_RECHECK`". Both
    // of those are the SELLER's, and a run that re-opens their window on its own has taken an action nobody
    // granted — `agentNavigations: 1` says the walk opens one window, at open, and never again.
    if (this.surfaceClosed) return;
    if (!isCoupangIssuancePark(this.engine.currentStage())) return;
    if (this.engine.isPaused()) return;
    this.recovering = true;
    this.busyCount += 1;
    void this.recoverPark()
      .catch(() => undefined)
      .finally(() => {
        this.recovering = false;
        this.busyCount -= 1;
      });
  }

  /**
   * Guide one control to a seller barrier as a single batched unit: locate, then — only if the engine says the
   * locate was clean — highlight. Publishing once at the end means the frontend never sees the barrier stage
   * before its `TARGET_HIGHLIGHTED` event exists.
   */
  private async guide(target: CoupangIssuanceTarget): Promise<void> {
    if (this.stopped) return;
    // Settle the surface BEFORE the locate so a fixed-label locate/highlight never fires on a still-settling
    // post-navigation page. Best-effort and value-free; a driver without a real page omits it. If a read still
    // races a navigation and throws, `onDriveError → engine.onDriveFault` parks recoverably.
    await this.driver.settleSurface?.();
    // Re-arm the closure watch on whatever page this guide is now working against. It used to be armed only on
    // the `PROBE` branch, so a window brought up by a guide (a seller-commanded re-open after they closed the
    // first one) was never watched again — closing THAT one changed nothing and the run went on driving a dead
    // page. Token-guarded, so the newest arm is the only one that can report.
    this.watchSurfaceClose();
    const loc = await this.driver.locateTarget(target);
    const afterLoc = this.engine.onTargetLocated(target, loc);
    if (typeof afterLoc === "object" && "guide" in afterLoc) {
      const hl = await this.driver.highlightTarget(target);
      const afterHl = this.engine.onTargetHighlighted(target, hl);
      this.publishState();
      return this.drive(afterHl);
    }
    // Locate parked (target_not_found) — publish the park and follow whatever it returned.
    this.publishState();
    return this.drive(afterLoc);
  }

  /**
   * Await the seller's own action on one control, then rejoin the chain. Re-arms while the engine is still
   * resting on this barrier — an expired observation window means the seller has not acted YET, not that the run
   * should be abandoned. Bounded: the loop exits the moment the engine leaves this barrier.
   */
  private async watchBarrier(target: CoupangIssuanceTarget): Promise<void> {
    if (this.stopped) return;
    let acted = await this.driver.observeUserAction(target);
    while (!acted) {
      if (this.stopped || !this.stillWaitingOn(target)) return;
      await new Promise<void>((resolve) => setTimeout(resolve, this.rearmDelayMs));
      if (this.stopped || !this.stillWaitingOn(target)) return;
      await this.driver.armObserve(target);
      acted = await this.driver.observeUserAction(target);
    }
    this.busyCount += 1;
    try {
      const next = this.engine.onUserActionObserved(target);
      // Publish the observation before driving on — otherwise a terminal `CLEANUP` effect, which does not itself
      // publish, would never send the completion view.
      this.publishState();
      await this.drive(next);
    } catch (e) {
      await this.onDriveError(e);
    } finally {
      this.busyCount -= 1;
    }
  }

  /**
   * Recover a RECOVERABLE PARK by itself, inside WING.
   *
   * The remaining parks — a control that is not on the page yet, a page that moved between the locate and the
   * highlight, a window that was closed and reopened — all cleared only on a `REQUEST_STEP_RECHECK`, which the
   * seller can only send from the SellerOps tab. That is the tab this walk exists to keep them out of, so each
   * of those parks was a silent instruction to go back.
   *
   * A recheck is what the frontend's button would have sent; issuing it here on a timer is the same recovery
   * without the round trip. Bounded, and it stops the moment the run leaves the park (or the engine reports
   * there is nothing to redo), so a genuinely stuck run does not spin forever.
   *
   * The button remains: this removes the NEED to press it, never the ability.
   */
  private async recoverPark(): Promise<void> {
    const maxPolls = Math.max(1, Math.ceil(this.surfaceWaitTimeoutMs / Math.max(1, this.surfaceWaitPollMs)));
    for (let i = 0; i < maxPolls; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.surfaceWaitPollMs));
      if (this.stopped || this.engine.isPaused() || isCoupangIssuanceTerminal(this.engine.currentStage())) return;
      // Checked EVERY iteration, not only at entry. `maybeRecoverPark` guards on the latch before starting a
      // loop, which stops a loop from being born after a close — and does nothing about the loop already
      // running, which is the one that fired on 2026-08-20. A window the seller closed must end this loop, not
      // merely fail to start another.
      if (this.surfaceClosed) return;
      // **The seller's own answer beats another re-read.** On the one park that asks a question, check for the
      // press BEFORE spending the tick on a recheck that would re-read the same ambiguity it already refused.
      if (await this.consumeParkConfirmation()) return;
      if (!isCoupangIssuancePark(this.engine.currentStage())) return;
      const outcome = this.engine.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: this.engine.view().revision });
      if (!outcome.ok) return;
      this.publishState();
      if ("effect" in outcome && !isNoop(outcome.effect)) {
        // Through `onDriveError`, NOT bare. Self-recovery exists FOR the navigation race, so a locate that
        // throws here is the expected case — and `maybeRecoverPark` swallows what escapes this loop, so a bare
        // await meant that throw ended the recovery silently: no `onDriveFault`, no published state, and
        // nothing to restart it (this loop only starts at the end of a drive chain, and this WAS that chain).
        try {
          await this.drive(outcome.effect);
        } catch (e) {
          await this.onDriveError(e);
        }
        // The drive either recovered the run or parked it again; either way the loop's own check decides.
      }
    }
  }

  /** True while the engine is resting on exactly this target's barrier and not paused. */
  private stillWaitingOn(target: CoupangIssuanceTarget): boolean {
    return !this.engine.isPaused() && this.engine.currentStage() === COUPANG_TARGET_BARRIER_STAGE[target] && this.engine.activeTarget() === target;
  }

  private watchSurfaceClose(): void {
    const whenClosed = this.driver.whenSurfaceClosed?.bind(this.driver);
    if (!whenClosed) return;
    this.surfaceCloseToken += 1;
    const token = this.surfaceCloseToken;
    void whenClosed().then(() => this.onSurfaceClosed(token));
  }

  private onSurfaceClosed(token: number): void {
    if (this.stopped) return;
    if (token !== this.surfaceCloseToken) return;
    if (isCoupangIssuanceTerminal(this.engine.currentStage())) return;
    // Latched BEFORE the park is driven, so the `CLEAR_HIGHLIGHT` chain that follows cannot end in a recovery
    // loop that re-opens the window on a timer.
    this.surfaceClosed = true;
    const effect = this.engine.onSurfaceClosed();
    this.publishState();
    if (!isNoop(effect)) {
      this.busyCount += 1;
      void this.drive(effect)
        .catch((e) => this.onDriveError(e))
        .finally(() => {
          this.busyCount -= 1;
        });
    }
  }

  private publishState(): void {
    for (const e of this.engine.events()) {
      if (e.sequence > this.publishedSeq) {
        this.transport.send({ kind: "aw_event", event: e });
        this.publishedSeq = e.sequence;
      }
    }
    this.transport.send({ kind: "aw_view", view: this.engine.view() });
    this.onStatePublished?.();
  }
}

function isNoop(effect: CoupangIssuanceEffect): boolean {
  return effect === "NONE";
}

function safeCommandId(command: unknown): string {
  const id = (command as { commandId?: unknown })?.commandId;
  return typeof id === "string" ? id : "unknown";
}

/** A sanitized label for a caught error — its constructor name only, never its message. */
function errName(e: unknown): string {
  if (e instanceof Error) return e.name || "Error";
  return typeof e;
}

/**
 * The capability, if this command carries one. Read from the payload's own field and nowhere else — not from a
 * header, not from the envelope, not from a bag of arbitrary auth. One field, one step, one walk.
 */
function credentialHandoffCapabilityOf(command: CommandEnvelope): string | null {
  const payload = (command as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as { credentialHandoffAuthorization?: unknown }).credentialHandoffAuthorization;
  return typeof value === "string" && value.length > 0 ? value : null;
}
