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
import { validateCommandEnvelope } from "../../../../contracts/action-window/v2/index";
import type { AwClientFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import { log } from "../../log";
import type { CoupangIssuanceEffect, CoupangIssuanceEngine } from "./coupang-issuance-engine";
import { COUPANG_TARGET_BARRIER_STAGE, type CoupangIssuanceProbeDriver, type CoupangIssuanceTarget } from "./coupang-issuance-driver";
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
        this.maybeRecoverPark();
        return;
      }
      case "CLEANUP": {
        await this.driver.cleanup();
        return;
      }
      case "NONE":
      default:
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
