/**
 * **Initial-review-import session supervisor (ISOLATED, v2).** Connects the FE (over a v2 transport) to the
 * pure {@link ImportSegmentEngine} and an {@link ImportProbeDriver}. The import-side sibling of
 * `ActionWindowSession` (v1 export) and `ReplySubmitSession` (v2 reply).
 *
 * **Why this is more than a copy of the reply session.** A reply run has ONE human barrier; an import
 * segment has six, and each one is followed by more automatic work. That makes `autoBusy` genuinely
 * load-bearing rather than a test convenience: every barrier continuation drives a multi-step chain
 * (locate → highlight → observe, or read-scope → gate → locate export), so the flag has to be held across
 * the whole chain or `whenSettled` returns while the run is mid-flight and a test asserts on a state that
 * is about to change.
 *
 * **It also owns the in-page guidance panel** (2026-07-26). The seller works in the marketplace window, so
 * every transition this session publishes to the frontend is ALSO drawn there — the step, the window to match,
 * and, when the run stops, the cause and the one control that repairs it. The words are the frontend's: they
 * arrive as an `aw_guidance_pack` and this session does lookup and `{param}` substitution, nothing more. A
 * press on that panel comes back as an ordinary operator command, gated twice (see `applyPanelIntent`).
 *
 * **And the panel now outlives the run it belongs to, by one state** (2026-07-26). A segment that COMPLETES
 * leaves a panel saying so, and — when the frontend's pack says a segment remains — a control that starts the
 * next one. That press is the one thing this session cannot answer: a run needs a single-use ticket only the
 * backend mints and only the frontend can ask for, so it is forwarded as an `aw_guidance_intent` and the
 * frontend does exactly what its own button does. The seller never leaves the marketplace window; the
 * authorization path is unchanged.
 *
 * INVARIANTS (inherited, and structural here):
 *  - the session never performs a marketplace action — it arms observation and reacts to what the driver
 *    reports the SELLER did;
 *  - it puts only sanitized v2 contract values on the wire;
 *  - a barrier's watcher only advances a barrier that is still open for that same target, so a late or
 *    duplicated observation cannot skip a step.
 */
import { validateCommandEnvelope, type ActionWindowRunView } from "../../../../contracts/action-window/v2/index";
import {
  AW_GUIDANCE_INTENTS,
  type AwGuidanceIntent,
  type AwGuidancePack,
  type AwClientFrame,
  type AwServerTransport,
} from "../../../../contracts/action-window/v2/transport";
import { guidancePanelStateFrom, isGuidancePack, PANEL_COMMANDS, PANEL_INTENTS } from "../guidance-copy";
import type { GuidancePanelState } from "../guidance-panel";
import { log } from "../../log";
import type { ImportEffect, ImportSegmentEngine } from "./import-engine";
import { IMPORT_TERMINAL_STAGES } from "./import-stages";
import type { ImportProbeDriver, ImportTarget, RequiredRange } from "./import-driver";
import { recordFailure, recordStage } from "./reliability-instrumentation";
import { isReliabilityFailure } from "./reliability-failure";

export interface ImportSessionOptions {
  /** Fires after every published transition — the persistence hook. */
  onStatePublished?: () => void;
  /**
   * Floor delay between barrier re-arms.
   *
   * Not a tuning knob — a safety floor. With a long observation window (the live driver waits two minutes)
   * the loop is naturally slow, but with a driver that returns immediately it would spin at full speed and
   * peg a core. A re-arm is never a hot path, so a pause costs nothing and removes the hazard.
   */
  rearmDelayMs?: number;
  /**
   * How often the in-page guidance panel is checked for a press.
   *
   * A poll rather than a callback because the panel lives in the marketplace page and the only channel back
   * is a value the driver reads. Slow on purpose: this is a human pressing a button, and a press that takes
   * half a second to register costs nothing, while a tight loop would evaluate in the seller's page
   * continuously for the whole sitting.
   */
  panelPollMs?: number;
  /**
   * How long the panel keeps waiting for a press AFTER the run has finished.
   *
   * A finished segment's panel offers to start the next one, so the poll cannot stop the moment the run ends —
   * but it must not keep evaluating in someone's browser for the rest of the day either. When the budget runs
   * out the panel comes down: a control that no longer works must not stay on screen looking like it does, and
   * the SellerOps window can still continue the plan.
   */
  terminalPanelBudgetMs?: number;
  /**
   * **Guided Acquisition Reliability — the PREPARE-start watchdog.**
   *
   * How long after a run is accepted the drive loop has to PRODUCE a surface result before the session
   * concludes the run went silent and parks it as `PREPARE_NOT_STARTED`. This is the exact failure the first
   * live proof hit — the command was accepted, but no `PREPARE` ever completed and the page just sat there. It
   * is the last backstop: a stalled open or settle surfaces sooner as its own reliability failure. `0` disables
   * the watchdog (offline tests that drive the loop by hand set it off so a fake clock never fires).
   */
  prepareStartGuardMs?: number;
}

export class ImportSegmentSession {
  private readonly engine: ImportSegmentEngine;
  private readonly driver: ImportProbeDriver;
  private readonly transport: AwServerTransport;
  private readonly required: RequiredRange;
  private readonly runId: string;
  private readonly onStatePublished: (() => void) | undefined;
  private readonly rearmDelayMs: number;
  private readonly panelPollMs: number;
  private readonly terminalPanelBudgetMs: number;
  private readonly prepareStartGuardMs: number;

  private started = false;
  private publishedSeq = 0;
  private autoBusy = false;
  private unsubscribe: (() => void) | null = null;
  /** The PREPARE-start watchdog handle; cleared the moment the drive loop enters PREPARE. */
  private prepareWatchdog: ReturnType<typeof setTimeout> | null = null;
  /** Monotonic id of the window whose close-watch is current; a stale window's close is ignored. */
  private surfaceCloseToken = 0;
  /** Set once the run has reached the seller with visible guidance, so `READY` is recorded only once. */
  private reachedReady = false;
  /**
   * The frontend's guidance prose, or null until it arrives.
   *
   * Null is not a degraded mode to paper over: with no pack the panel simply does not render, and the run
   * behaves exactly as it did before guidance moved in-page. There is no runtime-authored substitute, which is
   * how contract §6 stays structural (see `../guidance-copy.ts`).
   */
  private pack: AwGuidancePack | null = null;
  private panelStopped = false;
  private panelLoopRunning = false;

  constructor(
    engine: ImportSegmentEngine,
    driver: ImportProbeDriver,
    transport: AwServerTransport,
    required: RequiredRange,
    opts?: ImportSessionOptions,
  ) {
    this.engine = engine;
    this.driver = driver;
    this.transport = transport;
    this.required = required;
    this.runId = engine.view().runId;
    this.started = engine.isStarted();
    this.onStatePublished = opts?.onStatePublished;
    this.rearmDelayMs = opts?.rearmDelayMs ?? 250;
    this.panelPollMs = opts?.panelPollMs ?? 500;
    // Fifteen minutes: long enough that a seller who steps away between two monthly exports still finds the
    // control, short enough that an abandoned sitting stops touching their page the same afternoon.
    this.terminalPanelBudgetMs = opts?.terminalPanelBudgetMs ?? 15 * 60_000;
    // 120s: comfortably longer than the SUM of the driver's own bounded prepare legs (a navigation timeout plus
    // the surface-settle guard), so a healthy-but-slow PREPARE always produces a result — ready, or a specific
    // open/settle-timeout failure — before this fires. Armed per-PREPARE (scoped to the prepare, not to queue
    // time), it is the last backstop for a prepare that neither resolves nor rejects at all. `0` disables it.
    this.prepareStartGuardMs = opts?.prepareStartGuardMs ?? 120_000;
  }

  /**
   * Subscribe to the transport and start watching the in-page panel.
   *
   * The returned function releases BOTH. It has to: the host builds one session per segment and releases the
   * previous one, and a panel poller left running would keep reading a finished run's page and feeding its
   * presses into an engine nobody is publishing.
   */
  attach(): () => void {
    if (this.unsubscribe) return this.unsubscribe;
    const stopTransport = this.transport.subscribe((frame) => this.handle(frame));
    this.panelStopped = false;
    void this.watchPanel();
    this.unsubscribe = () => {
      this.panelStopped = true;
      this.clearPrepareWatchdog();
      // Retire the current window's close watch so a late close after release cannot park a released run.
      this.surfaceCloseToken += 1;
      stopTransport();
    };
    return this.unsubscribe;
  }

  /**
   * **Guided Acquisition Reliability — watch the CURRENT marketplace window for a close.**
   *
   * Armed fresh after each PREPARE, because each PREPARE opens (or re-opens) the window: a driver that owns a
   * real page resolves {@link ImportProbeDriver.whenSurfaceClosed} when the seller closes it. Before this, a
   * close stranded the run — the barrier loop re-armed an observation on a dead page forever while the view
   * still said WAITING_FOR_HUMAN. Now the session parks on `SURFACE_CLOSED` (recoverable: a re-check re-opens
   * the window and re-runs PREPARE). The token makes it window-specific: only the LATEST window's close acts,
   * so a stale promise from a window we already recovered from cannot re-park a healthy run. A driver with no
   * window (every scripted test driver) omits the method and nothing is watched.
   */
  private watchSurfaceClose(): void {
    const whenClosed = this.driver.whenSurfaceClosed?.bind(this.driver);
    if (!whenClosed) return;
    this.surfaceCloseToken += 1;
    const token = this.surfaceCloseToken;
    void whenClosed().then(() => this.onSurfaceClosed(token));
  }

  /** The marketplace window closed. Park the run visibly rather than let the barrier loop spin on a dead page. */
  private onSurfaceClosed(token: number): void {
    // Ignore a close from a window we have already moved past (a reopened run, or a released session).
    if (token !== this.surfaceCloseToken) return;
    if (IMPORT_TERMINAL_STAGES.includes(this.engine.currentStage())) return;
    // A window close is the most accurate reason to show, even if the run was already parked on a DIFFERENT
    // reliability cause (say OVERLAY_NOT_VISIBLE) — `reliabilityPark` replaces a different cause and no-ops on an
    // existing SURFACE_CLOSED, so re-entry is safe and the seller sees "창이 닫혔어요", not a stale reason.
    recordFailure("SURFACE_CLOSED");
    this.engine.reliabilityPark("SURFACE_CLOSED");
    // A parked run points at nothing; drop any stale highlight so the page does not keep a spotlight on a
    // control the seller can no longer reach once they re-open.
    void this.driver
      .clearTargetHighlight()
      .catch((e) => log("aw_import_clear_highlight_failed", { reason: errName(e) }, "warn"));
    this.publishState();
  }

  /**
   * The hosted run's sanitized status — the one enum a HOST needs to answer "is this segment over?".
   *
   * Added for the resident helper's on-demand carrier, which decides whether to release the seller's
   * marketplace window from exactly this reading (plus "no tab is attached"). Deliberately the status ALONE
   * rather than the whole view: a host has no business reading a run's step, target ref, or event log, and a
   * release decision made from more than it needs is a release decision that breaks when the view changes.
   */
  runStatus(): ActionWindowRunView["status"] {
    return this.engine.view().status;
  }

  /** Resolves once no automatic drive is in flight (test-facing determinism hook). */
  async whenSettled(): Promise<void> {
    for (let i = 0; i < 100_000; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!this.autoBusy) return;
    }
    throw new Error("import session: whenSettled did not converge");
  }

  private handle(frame: AwClientFrame): void {
    if (frame.kind === "aw_guidance_pack") {
      if (!isGuidancePack(frame.pack)) {
        // A malformed pack used to be logged and dropped in silence — the run kept going with no panel, and the
        // seller had no way to tell the guidance was missing. Now it is an EXPLICIT, recoverable failure state:
        // rendering half a panel is worse than none, but silently rendering none is worse still. Park it so the
        // seller sees "안내를 불러오지 못했어요" on the SellerOps card (which needs no pack) with one recovery action;
        // a re-check re-runs PREPARE and the frontend re-sends a valid pack.
        log("aw_import_guidance_pack_rejected", { accepted: false });
        recordFailure("GUIDANCE_PACK_REJECTED");
        this.engine.reliabilityPark("GUIDANCE_PACK_REJECTED");
        this.publishState();
        return;
      }
      this.pack = frame.pack;
      recordStage("GUIDANCE_PACK");
      // COUNTS only. The values are the frontend's copy and the seller's own language; a log line is not
      // where they belong, and this line exists to prove a pack arrived, not to say what it said.
      log("aw_import_guidance_pack", {
        steps: Object.keys(frame.pack.steps).length,
        blockers: Object.keys(frame.pack.blockers).length,
        commands: Object.keys(frame.pack.commands).length,
      });
      this.queuePanelRender();
      // Started lazily, and only from here: a run with no pack renders no panel, so there is nothing to
      // press and nothing to poll for. That also keeps every pre-existing run shape byte-identical.
      void this.watchPanel();
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
      this.transport.send({
        kind: "aw_command_result",
        commandId: safeCommandId(command),
        accepted: false,
        reason: "INVALID_ENVELOPE",
      });
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
    if (outcome.ok && "effect" in outcome && !isNoop(outcome.effect)) {
      this.autoBusy = true;
      void this.drive(outcome.effect)
        .catch((e) => this.onDriveError(e))
        .finally(() => {
          this.autoBusy = false;
        });
    }
  }

  /**
   * A drive chain threw. A {@link ReliabilityFailure} is an EXPECTED, recoverable stall (window would not open,
   * surface never settled, overlay failed) — record it and park the run with one recovery action, never tear it
   * down. Anything else is a genuine fault and still fails closed via the fatal cleanup.
   */
  private onDriveError(e: unknown): void {
    // A drive chain that threw has demonstrably run, so the PREPARE watchdog is moot either way.
    this.clearPrepareWatchdog();
    if (isReliabilityFailure(e)) {
      recordFailure(e.code);
      this.engine.reliabilityPark(e.code);
      this.publishState();
      return;
    }
    void this.fatalCleanup();
  }

  /** Arm (or re-arm) the PREPARE watchdog for the current prepare. A `0` guard disables it (offline tests). */
  private armPrepareWatchdog(): void {
    if (this.prepareStartGuardMs <= 0) return;
    this.clearPrepareWatchdog();
    this.prepareWatchdog = setTimeout(() => {
      this.prepareWatchdog = null;
      // The window elapsed and PREPARE never produced a result. If the run has since moved on (PREPARE resolved
      // and cleared this, or it was cancelled), do nothing; otherwise park it visibly. The `PREPARE_SESSION`
      // guard is what makes it safe: a prepare that resolved advances the stage, so a late timer cannot re-park.
      if (IMPORT_TERMINAL_STAGES.includes(this.engine.currentStage())) return;
      if (this.engine.currentStage() !== "PREPARE_SESSION") return;
      recordFailure("PREPARE_NOT_STARTED");
      this.engine.reliabilityPark("PREPARE_NOT_STARTED");
      this.publishState();
    }, this.prepareStartGuardMs);
    // Never keep the process alive just for the watchdog.
    this.prepareWatchdog.unref?.();
  }

  private clearPrepareWatchdog(): void {
    if (this.prepareWatchdog) {
      clearTimeout(this.prepareWatchdog);
      this.prepareWatchdog = null;
    }
  }

  private async drive(effect: ImportEffect): Promise<void> {
    if (typeof effect === "object") {
      if ("locate" in effect) {
        const res = await this.driver.locateTarget(effect.locate);
        const next = this.engine.onTargetLocated(effect.locate, res);
        this.publishState();
        return this.drive(next);
      }
      if ("prefilled" in effect) {
        // The driver compares in-process and answers with a boolean; no date value crosses back, exactly as
        // with the scope read. A driver that cannot tell answers `false`, which asks the seller — the safe
        // direction, since a wrong skip would hand an unchecked field to the gate.
        const satisfied = await this.driver.isTargetPrefilled(effect.prefilled, this.required);
        const next = this.engine.onTargetPrefilled(effect.prefilled, satisfied);
        this.publishState();
        return this.drive(next);
      }
      if ("highlight" in effect) {
        const res = await this.driver.highlightTarget(effect.highlight);
        const next = this.engine.onTargetHighlighted(effect.highlight, res);
        this.publishState();
        return this.drive(next);
      }
      // `observe` rests at a seller barrier. The watcher runs detached so the drive chain unwinds and the
      // run is genuinely idle while the seller works on NAVER. Reaching the first barrier means the guidance is
      // up and the seller can act — the run reached them, which is the pipeline's terminal `READY` marker.
      if (!this.reachedReady) {
        this.reachedReady = true;
        recordStage("READY");
      }
      await this.driver.armTargetObserve(effect.observe);
      void this.watchBarrier(effect.observe);
      return;
    }
    switch (effect) {
      case "PREPARE": {
        // The drive loop entered PREPARE — the run did NOT go silent, so cancel the watchdog. Any stall from
        // here on (window open, surface settle) surfaces as a ReliabilityFailure the driver throws.
        recordStage("PREPARE");
        // Arm the watchdog HERE — scoped to the prepare itself, not to queue time before the loop ran — so it
        // measures only how long PREPARE takes to produce a result. It is the last backstop for a prepare that
        // neither resolves nor rejects (the driver's own open/settle guards catch a bounded stall sooner, with a
        // specific failure state).
        this.armPrepareWatchdog();
        const res = await this.driver.prepareSurface();
        // PREPARE produced a result — the run did not go silent, so cancel the watchdog. A prepare that never
        // resolves never reaches here, and the watchdog is what catches that. An explicit stall is a
        // ReliabilityFailure the driver threw, cleared in `onDriveError`.
        this.clearPrepareWatchdog();
        // The window is up (prepareSurface did not throw) — arm a close-watch for THIS window, replacing any
        // watch on a window we have re-opened past. Do it before onSurfaceReady so a close during the probe is
        // still caught.
        this.watchSurfaceClose();
        const next = this.engine.onSurfaceReady(res);
        // Record where the surface probe stopped, so the trail names it. A login/expired park is
        // `SESSION_NOT_READY`; a not-usable-yet review surface parks recoverably as `SURFACE_SETTLE_TIMEOUT`
        // (the guided-import "you're not on the 리뷰 검색 page yet" case) instead of a stranding terminal.
        if (this.engine.currentStage() === "SESSION_BLOCKED") recordFailure("SESSION_NOT_READY");
        else if (this.engine.currentStage() === "SURFACE_BLOCKED") recordFailure("SURFACE_SETTLE_TIMEOUT");
        this.publishState();
        return this.drive(next);
      }
      case "READ_FACTS": {
        const facts = await this.driver.readSurfaceFacts();
        const next = this.engine.onFactsRead(facts);
        this.publishState();
        return this.drive(next);
      }
      case "READ_SCOPE": {
        // The driver reads the raw selected dates in-process and returns only the verdict; nothing here
        // ever sees a date value, which is what keeps the OPERATOR-LOCAL rule intact by construction.
        const match = await this.driver.readSelectedScope(this.required);
        const next = this.engine.onScopeRead(match);
        this.publishState();
        return this.drive(next);
      }
      case "DETECT_DOWNLOAD": {
        const res = await this.driver.detectDownload();
        const next = this.engine.onDownloadDetected(res);
        this.publishState();
        return this.drive(next);
      }
      case "VALIDATE_ARTIFACT": {
        const ref = this.engine.detectedArtifactRef();
        if (!ref) return;
        const res = await this.driver.validateArtifact(ref);
        const next = this.engine.onArtifactValidated(res);
        this.publishState();
        return this.drive(next);
      }
      case "INGEST": {
        const ref = this.engine.detectedArtifactRef();
        if (!ref) return;
        // The engine is the single authority on how this run's scope was established. The driver no longer
        // derives its own evidence; the session hands the engine's record to the ingest, so the value the
        // backend records can never diverge from the value the engine holds. (Unreachable-null defaults to the
        // operator-confirmed side, exactly as the previous default did.)
        const res = await this.driver.ingest(ref, this.engine.recordedScopeEvidence() ?? "OPERATOR_CONFIRMED");
        const next = this.engine.onIngested(res);
        this.publishState();
        return this.drive(next);
      }
      case "CLEAR_HIGHLIGHT": {
        // The run has stopped pointing at anything. The panel — already rendered with the cause and the
        // repair by the publish that preceded this — is now the only thing on screen claiming attention,
        // which is the honest state (finding 12).
        await this.driver.clearTargetHighlight();
        return;
      }
      case "CLEANUP": {
        await this.driver.cleanup();
        // Re-drawn AFTER cleanup, deliberately. The driver's cleanup takes the panel down with the run's
        // annotations — correct for a run that has nothing more to say, wrong for one that has just finished a
        // segment and is offering the next. The panel is the seller's only surface here, so the last word on it
        // has to be the completion rather than an empty page.
        this.queuePanelRender();
        return;
      }
      case "NONE":
      default:
        return;
    }
  }

  /**
   * Await the seller's own action on one control, then rejoin the chain.
   *
   * Holds `autoBusy` across the continuation because it drives more than one step — a date barrier leads
   * to another locate/highlight, and the last date barrier leads to the scope read and the gate. Without
   * that, `whenSettled` could return between the observation and the work it triggers.
   */
  private async watchBarrier(target: ImportTarget): Promise<void> {
    // A human barrier has no deadline that should kill the run. An observation window expiring means the
    // seller has not acted YET — they are reading, or picking from a calendar, or were interrupted — so the
    // observation is re-armed and we keep watching for as long as the engine is still resting on this
    // target. The first live attempt stranded here: a 15-second window expired while the operator was
    // working, the watcher returned, and nothing was left observing a run that still said
    // WAITING_FOR_HUMAN. A status that claims we are waiting has to mean we are actually watching.
    //
    // Bounded anyway: the loop exits the moment the engine leaves this barrier — a cancel, a pause, a
    // scope block or a completed step all move it — so this cannot spin on a finished run.
    let acted = await this.driver.waitForTargetAction(target);
    while (!acted) {
      if (this.engine.currentStage() !== this.barrierStageFor(target)) return;
      await new Promise<void>((resolve) => setTimeout(resolve, this.rearmDelayMs));
      // Re-check after the pause: the run may have been cancelled or paused while we waited.
      if (this.engine.currentStage() !== this.barrierStageFor(target)) return;
      await this.driver.armTargetObserve(target);
      acted = await this.driver.waitForTargetAction(target);
    }
    this.autoBusy = true;
    try {
      const next = this.engine.onTargetActionObserved(target);
      this.publishState();
      await this.drive(next);
    } catch (e) {
      // Reliability-aware, exactly like the command/panel drive entries: a barrier continuation drives the
      // steps AFTER the first seller barrier — the scope gate, the export highlight, the consent highlight — so
      // an overlay that throws `OVERLAY_MOUNT_FAILED` / `OVERLAY_NOT_VISIBLE` HERE must park recoverably, not be
      // swallowed into a fatal teardown that leaves a stuck, blocker-less ghost run. `onDriveError` parks a
      // ReliabilityFailure and falls back to the fatal cleanup for anything genuinely fatal.
      this.onDriveError(e);
    } finally {
      this.autoBusy = false;
    }
  }

  private barrierStageFor(target: ImportTarget): string {
    return BARRIER_STAGE_FOR[target];
  }

  private async fatalCleanup(): Promise<void> {
    this.clearPrepareWatchdog();
    // Not swallowed silently: a cleanup that fails during fatal teardown is still worth a sanitized line, so a
    // transcript shows the teardown was attempted and what it hit — it just must not throw out of teardown.
    await this.driver.cleanup().catch((e) => log("aw_import_fatal_cleanup_failed", { reason: errName(e) }, "warn"));
  }

  private publishState(): void {
    for (const e of this.engine.events()) {
      if (e.sequence > this.publishedSeq) {
        this.transport.send({ kind: "aw_event", event: e });
        this.publishedSeq = e.sequence;
      }
    }
    this.transport.send({ kind: "aw_view", view: this.engine.view() });
    // The seller is in the marketplace window, so the same transition is drawn there too. Queued rather
    // than awaited: publishing state must not wait on a page evaluate, and it must not fail because of one.
    this.queuePanelRender();
    // The run marker is saved AFTER the sanitized state is published, never before — a persisted record
    // must not lead the wire, or a resumed run could claim progress the frontend never saw.
    this.onStatePublished?.();
  }

  /* ── the in-page panel ─────────────────────────────────────────────────────── */

  /**
   * Draw the current state in the marketplace page.
   *
   * Serialized through one chain so two fast transitions cannot land out of order and leave the seller
   * reading the earlier of the two. Errors are swallowed on purpose: the panel is how the seller is INFORMED,
   * and a page that refused an evaluate (navigating, closed) must not take down a run that is otherwise fine.
   */
  private queuePanelRender(): void {
    if (this.pack === null) return;
    const state = guidancePanelStateFrom(this.engine.view(), this.pack);
    // A render failure must not take down an otherwise-fine run (the page may be navigating or closed), but it
    // is no longer swallowed in silence: a sanitized line records that a panel draw was refused, so a run that
    // shows the seller nothing leaves a reason why instead of looking like it rendered.
    this.panelRender = this.panelRender
      .then(() => this.driver.renderGuidance(state))
      .catch((e) => log("aw_import_panel_render_failed", { reason: errName(e) }, "warn"));
  }

  private panelRender: Promise<void> = Promise.resolve();

  /** What the panel is currently showing, as the same projection the render queue draws. */
  private panelState(): GuidancePanelState | null {
    return this.pack === null ? null : guidancePanelStateFrom(this.engine.view(), this.pack);
  }

  /**
   * Watch the panel for the seller's presses until it has nothing pressable left, or the session is released.
   *
   * A poll, because the panel is in the seller's page and the only way back is a value the driver reads.
   *
   * **It does not stop the instant the run ends.** It used to, and that was right when a finished run took its
   * panel down. A finished segment now offers to start the next one from that same panel (product-owner decision,
   * 2026-07-26 — a seller working through thirteen monthly exports should not have to find the SellerOps tab
   * between each one), and a button nobody is watching is worse than no button. So a terminal run keeps polling
   * only while its panel still offers something, and only for {@link terminalPanelBudgetMs} — after which the
   * panel comes down rather than sit there dead.
   */
  private async watchPanel(): Promise<void> {
    if (this.panelLoopRunning) return;
    this.panelLoopRunning = true;
    let terminalWaitedMs = 0;
    try {
      while (!this.panelStopped) {
        await new Promise<void>((resolve) => setTimeout(resolve, this.panelPollMs));
        if (this.panelStopped) return;
        if (IMPORT_TERMINAL_STAGES.includes(this.engine.currentStage())) {
          const offered = this.panelState()?.actions ?? [];
          // Nothing to press: a run that failed, was cancelled, or finished a plan with nothing left in it.
          if (offered.length === 0) return;
          terminalWaitedMs += this.panelPollMs;
          if (terminalWaitedMs >= this.terminalPanelBudgetMs) {
            log("aw_import_panel_idle_closed", { offered: offered.length });
            this.panelRender = this.panelRender
              .then(() => this.driver.renderGuidance(null))
              .catch((e) => log("aw_import_panel_takedown_failed", { reason: errName(e) }, "warn"));
            return;
          }
        }
        // A failed read of the in-page press flag is "no press this tick", not a run failure — the next poll
        // reads it again. Deliberately not logged: it would fire on every poll of a navigating page and drown
        // the transcript, and it carries no reliability signal (the surface-close watch owns "window is gone").
        const intent = await this.driver.takeGuidanceIntent().catch(() => null);
        if (intent) this.applyPanelIntent(intent);
      }
    } finally {
      this.panelLoopRunning = false;
    }
  }

  /**
   * Apply a press on the in-page panel — as an operator command, or as an intent forwarded to the frontend.
   *
   * **Double-gated, and the first gate is the important one.** The intent arrives from a flag in the seller's
   * own page, so it is treated as untrusted input rather than as our own UI talking to us: only the presses the
   * panel actually renders are accepted, so nothing else in that page can reach the engine through this path —
   * no `SWITCH_TO_MANUAL`, no `START_RUN`, nothing that was not a button the seller saw. The second gate is the
   * runtime's own `allowedCommands`, the same authority the frontend is held to.
   *
   * The two routes are not interchangeable:
   *
   *  - a {@link PANEL_COMMANDS} press acts on THIS run, so the engine answers it locally.
   *    `REQUEST_STEP_RECHECK` still means "I did it, look again": it re-arms or re-reads and completes nothing.
   *  - a {@link PANEL_INTENTS} press asks for something this runtime cannot do. Continuing to the next segment
   *    needs a fresh single-use ticket, and the backend is the only thing that mints one while the frontend is
   *    the only thing that can ask (the wire carries no plan identity, on purpose). So it is forwarded, and the
   *    frontend decides — the authorization path is exactly the one the SellerOps button already uses.
   */
  private applyPanelIntent(type: string): void {
    if (PANEL_INTENTS.includes(type)) {
      this.forwardPanelIntent(type);
      return;
    }
    if (!PANEL_COMMANDS.includes(type)) {
      log("aw_import_panel_intent_refused", { known: false });
      return;
    }
    const view = this.engine.view();
    if (!view.allowedCommands.includes(type as never)) {
      log("aw_import_panel_intent_refused", { allowed: false });
      return;
    }
    // The panel is in-process, so it cannot be stale against the engine it is drawn from — the revision it
    // presents is the one it just read.
    const outcome = this.engine.command({ type, expectedRevision: view.revision });
    log("aw_import_panel_intent", { accepted: outcome.ok });
    this.publishState();
    if (outcome.ok && "effect" in outcome && !isNoop(outcome.effect)) {
      // A panel-triggered re-check re-runs PREPARE, which can hit a reliability stall (the window is still
      // closed, say). Route it through the same reliability-aware handler so it parks visibly rather than
      // tearing the run down.
      this.autoBusy = true;
      void this.drive(outcome.effect)
        .catch((e) => this.onDriveError(e))
        .finally(() => {
          this.autoBusy = false;
        });
    }
  }

  /**
   * Hand a panel press the runtime cannot act on to the frontend.
   *
   * Gated on the panel the seller is ACTUALLY looking at, not on a list of things that might be pressable: the
   * projection is recomputed and the press must appear in its actions. That is the same shape as the
   * `allowedCommands` gate on the command path, and it is the gate that matters here because a finished run
   * allows no commands at all — there is no engine authority to lean on, so the rendered panel is the authority.
   *
   * Forwards a value from the contract's closed set and nothing else: no run state, no ref, no dates. The
   * frontend is free to refuse it.
   */
  private forwardPanelIntent(type: string): void {
    const offered = this.panelState()?.actions ?? [];
    if (!offered.some((action) => action.command === type)) {
      log("aw_import_panel_intent_refused", { offered: false });
      return;
    }
    if (!AW_GUIDANCE_INTENTS.includes(type as AwGuidanceIntent)) {
      // Unreachable while PANEL_INTENTS is a subset of the contract's set, and kept as the thing that makes it
      // one: a press is never forwarded on the strength of a local constant alone.
      log("aw_import_panel_intent_refused", { contract: false });
      return;
    }
    log("aw_import_panel_intent_forwarded", { forwarded: true });
    this.transport.send({ kind: "aw_guidance_intent", intent: type as AwGuidanceIntent });
  }
}

/**
 * The barrier stage the engine sits at while resting on one target. Mirrored here (rather than exported from
 * the engine) so the session can ask "is this barrier still open" without reaching into engine internals.
 */
const BARRIER_STAGE_FOR: Readonly<Record<ImportTarget, string>> = {
  start_date: "WAIT_FOR_START",
  end_date: "WAIT_FOR_END",
  apply_range: "WAIT_FOR_APPLY",
  export: "WAIT_FOR_EXPORT",
  consent: "WAIT_FOR_CONSENT",
};

function isNoop(effect: ImportEffect): boolean {
  return effect === "NONE";
}

function safeCommandId(command: unknown): string {
  const id = (command as { commandId?: unknown })?.commandId;
  return typeof id === "string" ? id : "unknown";
}

/**
 * A sanitized label for a caught error — its constructor name only, never its message. A Playwright page error
 * can carry a URL or selector in `.message`; the class name (`TimeoutError`, `Error`) cannot, so it is the one
 * safe thing to log about a swallowed-but-not-silent failure.
 */
function errName(e: unknown): string {
  if (e instanceof Error) return e.name || "Error";
  return typeof e;
}
