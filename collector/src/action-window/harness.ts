/**
 * **Synthetic Action Window harness (R1).** Drives the pure engine against a real (synthetic)
 * Playwright page: prepare → locate → highlight → observe → verify → downstream → complete, with
 * cleanup on every exit.
 *
 * INVARIANT: this module (and all of `collector/src/action-window/**`) contains NO target-click
 * path. The user performs the click. Tests may inject a `simulateUserAction` callback that clicks
 * from TEST code only; in production/headed use it is undefined and the harness merely observes.
 */
import type { Page } from "playwright";
import type { ActionWindowRunView, CommandEnvelope, CommandType, EventEnvelope } from "../../../contracts/action-window/v1/index";
import { ACTION_WINDOW_PROTOCOL_VERSION } from "../../../contracts/action-window/v1/index";
import { ActionWindowEngine } from "./engine";
import { SYNTHETIC_ARTIFACT_REF } from "./session";
import type { Stage } from "./stages";
import { STEP_PLAN, TOTAL_STEPS } from "./stages";
import { fixtureHtml, type FixtureMode } from "./fixture";
import { locateTarget, surfaceIsValid } from "./locator";
import { mountOverlay, refreshOverlay, unmountOverlay, overlayTop } from "./overlay";
import { armObserver, disarmObserver, waitForUserAction } from "./observer";
import { verifyTransition } from "./verifier";

export interface HarnessOptions {
  mode: FixtureMode;
  /** TEST-ONLY: performs the real click on the target. Undefined in production/headed use. */
  simulateUserAction?: (page: Page) => Promise<void>;
  autoRecheck?: boolean;
  triggerDriftBeforeVerify?: boolean;
  shiftLayoutBeforeObserve?: boolean;
  observeTimeoutMs?: number;
  guidanceEnabled?: boolean;
}

export interface HarnessResult {
  view: ActionWindowRunView;
  events: readonly EventEnvelope[];
  finalStage: Stage;
  observed: boolean;
  downstream?: { processed: number };
  overlayRepositioned: boolean;
}

export async function runSyntheticLoop(page: Page, engine: ActionWindowEngine, opts: HarnessOptions): Promise<HarnessResult> {
  const runId = engine.view().runId;
  const channelCode = engine.view().channelCode;
  let cmdSeq = 0;
  const cmd = (type: CommandType, payload?: Record<string, unknown>): CommandEnvelope => ({
    protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
    commandId: `${runId}-c${++cmdSeq}`,
    runId,
    expectedRevision: engine.currentRevision(),
    type,
    ...(payload ? { payload: payload as CommandEnvelope["payload"] } : {}),
  });

  const guidanceEnabled = opts.guidanceEnabled ?? true;
  let observed = false;
  let downstream: { processed: number } | undefined;
  let overlayRepositioned = false;

  const finish = async (): Promise<HarnessResult> => {
    await unmountOverlay(page).catch(() => {});
    await disarmObserver(page).catch(() => {});
    return { view: engine.view(), events: engine.events(), finalStage: engine.currentStage(), observed, downstream, overlayRepositioned };
  };

  await page.setContent(fixtureHtml(opts.mode));
  // Some bundlers (e.g. tsx/esbuild with keepNames) inject a `__name(...)` helper into serialized
  // evaluate bodies. Define an identity shim (as a raw string, itself un-transformed) in the page's
  // main world so those calls resolve in every runtime — vitest and tsx alike.
  await page.evaluate("globalThis.__name = globalThis.__name || function (f) { return f; };");

  engine.command(cmd("START_RUN", { channelCode })); // → PREPARE

  if (engine.onSurfaceReady(await surfaceIsValid(page)) === "CLEANUP") return finish();

  if (engine.onLocated(await locateTarget(page)) === "CLEANUP") return finish();

  const humanStep = STEP_PLAN[1]!;
  await mountOverlay(page, { stepNumber: humanStep.stepNumber, totalSteps: TOTAL_STEPS, copyKey: humanStep.copyKey, guidanceEnabled });
  engine.onHighlighted(); // → OBSERVE
  await armObserver(page);

  if (opts.shiftLayoutBeforeObserve) {
    const before = await overlayTop(page);
    await page.evaluate(() => (window as unknown as { __awShiftLayout?: () => void }).__awShiftLayout?.());
    await refreshOverlay(page);
    const after = await overlayTop(page);
    overlayRepositioned = after !== before;
  }

  if (opts.simulateUserAction) await opts.simulateUserAction(page); // TEST-ONLY click
  observed = await waitForUserAction(page, { timeoutMs: opts.observeTimeoutMs ?? 15_000 });
  if (observed) engine.onUserActionObserved();

  if (opts.autoRecheck === false) return finish();

  if (opts.triggerDriftBeforeVerify) {
    await page.evaluate(() => (window as unknown as { __awReplaceTarget?: () => void }).__awReplaceTarget?.());
  }

  const locateSig = firstTargetRef(engine.events());
  engine.command(cmd("REQUEST_STEP_RECHECK")); // → VERIFY
  const effect = engine.onVerified(await verifyTransition(page, { expectedSig: locateSig }));
  if (effect === "DETECT_DOWNLOAD") {
    // Synthetic downstream: fixture pages fire no real download, so the harness feeds deterministic
    // in-memory probe results through the same engine transitions. No backend, no upload, no file.
    const ingest = { ok: true, processed: 1 };
    if (
      engine.onDownloadDetected({ detected: true, artifactRef: SYNTHETIC_ARTIFACT_REF }) === "VALIDATE_ARTIFACT" &&
      engine.onArtifactValidated({ valid: true }) === "INGEST" &&
      engine.onIngested(ingest) === "CLEANUP"
    ) {
      downstream = { processed: ingest.processed };
    }
  }
  return finish();
}

/** The opaque targetRef carried by TARGET_HIGHLIGHTED — the only place the harness reads the sig back. */
function firstTargetRef(events: readonly EventEnvelope[]): string {
  const e = events.find((ev) => ev.type === "TARGET_HIGHLIGHTED");
  return e?.payload.targetRef ?? "";
}
