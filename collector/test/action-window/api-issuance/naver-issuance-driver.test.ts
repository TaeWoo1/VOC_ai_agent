/**
 * The LIVE `NaverIssuanceDriver` driven end-to-end over a FAKE Playwright `Page` — no browser, no network,
 * no live NAVER. The real driver is wired to the REAL `IssuanceEngine` + `IssuanceGuidanceSession` (exactly
 * as the gated CLI would), so the whole guided walk is exercised through the production runtime, only the
 * page is scripted.
 *
 * The fake Page records EVERY evaluate script (string snippets AND the function-form overlay/observer
 * primitives, stringified), so the tests can assert directly that:
 *   - no evaluate ever reads a credential value (`.value` / `inputValue` / clipboard / screenshot);  and
 *   - the driver never invokes a marketplace action (the fake's `click` spy stays at 0).
 *
 * **Calibration reality this file pins (see `issuance-highlight-selectors`):** the NEW-app path
 * (create_app → api_group → credentials → return) is calibrated by fixed labels and completes. The
 * EXISTING-app path also completes: `open_app` is NAVIGATION guidance — the driver shows text guidance and
 * OBSERVES the seller's own `app_list → app_detail` transition (a page-category poll, no highlighted row),
 * the engine verifies the detail page, then reuses the calibrated api_group/credentials highlights. A wrong
 * landing page parks recoverably. `return` is guidance-only (a fixed synthetic signature; no NAVER control).
 */
import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import type {
  AwClientFrame,
  AwServerFrame,
  AwServerTransport,
} from "../../../../contracts/action-window/v2/transport";
import type { ActionWindowRunView } from "../../../../contracts/action-window/v2/index";
import { IssuanceEngine, makeIssuanceClock } from "../../../src/action-window/api-issuance/issuance-engine";
import { IssuanceGuidanceSession } from "../../../src/action-window/api-issuance/issuance-session";
import { NaverIssuanceDriver } from "../../../src/action-window/naver-issuance-driver";
import { getLogSink, clearLogSink } from "../../../src/log";
import type { ApiCenterStructuralCensus } from "../../../src/cli/observe-api-center";
import type { LocateResult } from "../../../src/action-window/engine";

const RUN_ID = "run_issuance_live01";
const HEX16 = /^[0-9a-f]{16}$/;
/** overlay.ts caps a sanitized mount message at 120 chars; the truncation ellipsis adds at most one. */
const MAX_MOUNT_MESSAGE_ASSERT = 121;
const API_CENTER_URL = "https://apicenter.commerce.naver.com/";

const APP_LIST_CENSUS: ApiCenterStructuralCensus = {
  passwordFieldPresent: false,
  submitAffordancePresent: false,
  formCount: 0,
  editableTextInputCount: 0,
  readonlyFieldCount: 0,
  listLikeContainerCount: 1, // list-like present, nothing else → app_list
};
const LOGIN_CENSUS: ApiCenterStructuralCensus = { ...APP_LIST_CENSUS, passwordFieldPresent: true };
// editable input present (no read-only) → app_detail: the page the seller lands on after opening their app.
const APP_DETAIL_CENSUS: ApiCenterStructuralCensus = { ...APP_LIST_CENSUS, listLikeContainerCount: 0, editableTextInputCount: 1 };
// nothing recognizable → unknown: a wrong page the seller might reach instead of the app detail.
const UNKNOWN_CENSUS: ApiCenterStructuralCensus = { ...APP_LIST_CENSUS, listLikeContainerCount: 0 };
// read-only fields present → credential_issuance: an EXISTING app's detail page shows its issued Application ID /
// Secret read-only, so the classifier's precedence (read-only wins over editable) lands it here, not app_detail.
const CREDENTIAL_CENSUS: ApiCenterStructuralCensus = { ...APP_LIST_CENSUS, listLikeContainerCount: 0, readonlyFieldCount: 1 };

interface FakePageOptions {
  url?: string;
  census?: ApiCenterStructuralCensus;
  locate?: LocateResult;
  appEntryCount?: number;
  observed?: boolean;
  /**
   * The census reported AFTER the seller opens their existing app (i.e. once the app-entry rows have been read).
   * Models the `app_list → app_detail` navigation the `open_app` step observes. Defaults to app_detail (the
   * happy landing); set to `UNKNOWN_CENSUS` / `LOGIN_CENSUS` to model a wrong page / expired session.
   */
  postOpenCensus?: ApiCenterStructuralCensus;
  /**
   * A HYDRATION sequence of censuses reported on successive reads AFTER the app is opened (last entry sticks).
   * Models the app-detail SPA classifying as a transient `unknown` for a beat before it settles to `app_detail`,
   * so VERIFY_OPEN's bounded polling can be proven to ride out the transient. Overrides `postOpenCensus`.
   */
  postOpenCensusSequence?: ApiCenterStructuralCensus[];
  /** Throw an execution-context error on the first N fixed-label tag/sig reads (models a soft-nav mid-annotation). */
  throwLocateTimes?: number;
  /** When true, the Playwright locator's `waitFor` always TIMES OUT (models a label that never renders → park). */
  locatorTimeout?: boolean;
  /**
   * Throw a TRANSIENT nav error on the first N api_group OVERLAY MOUNTS (the function-form overlay `evaluate`,
   * targeted by its `api_group` copyKey) — models the SPA destroying the context under the mount (the live-#5
   * blocker). The overlay's own bounded retry absorbs a few; past that the driver's atomic re-tag+re-mount does.
   */
  apiGroupMountThrowTimes?: number;
  /**
   * The first N api_group mounts RUN WITHOUT THROWING but PAINT NOTHING — models `mountOverlay`'s silent
   * `if(!target) return` no-op when the tag was lost to a soft-nav (the review's HIGH: a fail-OPEN success). The
   * driver's post-mount `overlayMounted` verify must catch this and force the atomic re-tag+re-mount.
   */
  apiGroupMountNoPaintTimes?: number;
  /** The locator's `scrollIntoViewIfNeeded` REJECTS (best-effort scroll fault) — models a scroll that can't complete. */
  scrollThrows?: boolean;
  /**
   * The first N api_group OVERLAY MOUNTS throw a NON-TRANSIENT generic `Error` (name "Error") carrying
   * {@link apiGroupMountFaultMessage} — models the live `reason=OTHER` mount fault the identification unit
   * localizes (a generic Error that is NOT a soft-nav context-destroy). The driver's mount-fault observation
   * seam must localize it (sub-stage + fingerprint) and re-throw unchanged.
   */
  apiGroupMountFaultTimes?: number;
  /** The message the non-transient api_group mount fault throws (default a truly unrecognized string). */
  apiGroupMountFaultMessage?: string;
  /** The sub-stage breadcrumb the in-page `readMountSubStage` probe reads back after a mount fault. */
  mountSubStage?: string;
  /**
   * Decouples the in-page TAG count from the locator's uniqueness count: the fixed-label tag/locate script returns
   * this result even though the locator resolved uniquely (count 1). Models real drift where the Playwright locator
   * narrows to one match but the in-page exact-label scan counts differently → the `tag`-stage non-unique path.
   */
  tagResult?: LocateResult;
}

/** A minimal fake Playwright Locator: enough of the surface the SPA-stable resolver uses (never a click/type). */
class FakeLocator {
  /** How many times `waitFor` was invoked — lets a test prove the locator wait is BOUNDED. */
  static waitForCalls = 0;
  constructor(private readonly page: FakePage) {}
  first(): FakeLocator {
    return this;
  }
  async waitFor(_opts?: unknown): Promise<void> {
    FakeLocator.waitForCalls += 1;
    if (this.page.locatorTimeout) {
      throw Object.assign(new Error("locator waitFor timeout"), { name: "TimeoutError" });
    }
  }
  async count(): Promise<number> {
    return typeof this.page.locate.count === "number" ? this.page.locate.count : 1;
  }
  async scrollIntoViewIfNeeded(_opts?: unknown): Promise<void> {
    // Read-only native scroll (not a click). Recorded so a test can prove the resolver scrolled the section.
    this.page.scripts.push("[locator] scrollIntoViewIfNeeded");
    if (this.page.scrollThrows) {
      throw new Error("Execution context was destroyed, most likely because of a navigation");
    }
  }
}

/** A scripted, browser-free Page: records every evaluate, returns scripted values, and spies on `click`. */
class FakePage {
  urlValue: string;
  census: ApiCenterStructuralCensus;
  locate: LocateResult;
  appEntryCount: number;
  observed: boolean;
  postOpenCensus: ApiCenterStructuralCensus;
  postOpenCensusSequence: ApiCenterStructuralCensus[] | undefined;
  locatorTimeout: boolean;
  scrollThrows: boolean;
  tagResult: LocateResult | undefined;
  apiGroupMountFaultMessage: string;
  mountSubStage: string | undefined;
  /** Latches once the app-entry rows have been read — the seller then opens their app, so census → postOpen. */
  private opened = false;
  /** Index into `postOpenCensusSequence` — advances per post-open census read (last entry sticks). */
  private postOpenPoll = 0;

  readonly scripts: string[] = [];
  clickCalls = 0;
  private throwLocateLeft: number;
  private apiGroupMountThrowLeft: number;
  private apiGroupMountNoPaintLeft: number;
  private apiGroupMountFaultLeft: number;
  /** Whether the most recent overlay mount actually PAINTED — what the driver's `overlayMounted` verify reads. */
  private overlayPainted = false;
  private readonly closeHandlers: Array<() => void> = [];

  constructor(o: FakePageOptions = {}) {
    this.urlValue = o.url ?? API_CENTER_URL;
    this.census = o.census ?? APP_LIST_CENSUS;
    this.locate = o.locate ?? { count: 1, sig: "abcd1234abcd1234" };
    this.appEntryCount = o.appEntryCount ?? 0; // default = EMPTY app list → the calibrated new-app (create) path
    this.observed = o.observed ?? true;
    this.postOpenCensus = o.postOpenCensus ?? APP_DETAIL_CENSUS;
    this.postOpenCensusSequence = o.postOpenCensusSequence;
    this.locatorTimeout = o.locatorTimeout ?? false;
    this.scrollThrows = o.scrollThrows ?? false;
    this.tagResult = o.tagResult;
    this.apiGroupMountFaultMessage = o.apiGroupMountFaultMessage ?? "boom weird mount failure";
    this.mountSubStage = o.mountSubStage;
    this.throwLocateLeft = o.throwLocateTimes ?? 0;
    this.apiGroupMountThrowLeft = o.apiGroupMountThrowTimes ?? 0;
    this.apiGroupMountNoPaintLeft = o.apiGroupMountNoPaintTimes ?? 0;
    this.apiGroupMountFaultLeft = o.apiGroupMountFaultTimes ?? 0;
  }

  url(): string {
    return this.urlValue;
  }

  /** The SPA-stable resolver's Playwright entrypoint — returns a fake Locator over this page. */
  locator(_selector: string, _opts?: unknown): FakeLocator {
    return new FakeLocator(this);
  }

  /** The census reported after the app is opened — a hydration sequence if scripted, else the single postOpen. */
  private postOpenCensusRead(): ApiCenterStructuralCensus {
    const seq = this.postOpenCensusSequence;
    if (seq && seq.length > 0) {
      const c = seq[Math.min(this.postOpenPoll, seq.length - 1)]!;
      this.postOpenPoll += 1;
      return c;
    }
    return this.postOpenCensus;
  }

  async evaluate(fnOrStr: unknown, _arg?: unknown): Promise<unknown> {
    // Record the STRING for string snippets, and the function SOURCE for the overlay/observer primitives,
    // so a single sweep proves no evaluate ever reads a credential value.
    const s = typeof fnOrStr === "string" ? fnOrStr : `[fn] ${String(fnOrStr)}`;
    this.scripts.push(s);
    if (typeof fnOrStr !== "string") {
      const copyKey = (_arg as { copyKey?: string } | undefined)?.copyKey ?? "";
      // The overlay MOUNT is the function-form evaluate carrying scrollIntoView; the `overlayMounted` verify is the
      // one carrying getElementById WITHOUT scrollIntoView/untrack. Model the api_group mount's live failure modes.
      const isMount = s.includes("scrollIntoView");
      const isOverlayVerify = s.includes("getElementById") && !s.includes("scrollIntoView") && !s.includes("untrack");
      // The `readMountSubStage` probe is the ONE function-form evaluate that reads the mount breadcrumb global
      // WITHOUT being the mount itself (the mount also references the global, but it carries scrollIntoView).
      const isSubStageRead = s.includes("__aw_mount_stage__") && !isMount;
      if (isMount) {
        if (copyKey.includes("api_group") && this.apiGroupMountThrowLeft > 0) {
          this.apiGroupMountThrowLeft -= 1;
          throw new Error("Execution context was destroyed, most likely because of a navigation");
        }
        // A NON-TRANSIENT generic Error (name "Error", not a soft-nav message) — the live `reason=OTHER` shape the
        // identification unit localizes. The driver must observe (sub-stage + fingerprint) and re-throw unchanged.
        if (copyKey.includes("api_group") && this.apiGroupMountFaultLeft > 0) {
          this.apiGroupMountFaultLeft -= 1;
          throw new Error(this.apiGroupMountFaultMessage);
        }
        if (copyKey.includes("api_group") && this.apiGroupMountNoPaintLeft > 0) {
          this.apiGroupMountNoPaintLeft -= 1;
          this.overlayPainted = false; // ran without throwing, but painted nothing (tag lost) — the fail-open case
          return undefined;
        }
        this.overlayPainted = true; // a real mount paints the overlay
        return undefined;
      }
      if (isSubStageRead) return this.mountSubStage; // the driver's post-fault readMountSubStage(page) breadcrumb read
      if (isOverlayVerify) return this.overlayPainted; // the driver's post-mount overlayMounted(page) read
      return undefined; // other overlay/observer function-form → no-op
    }
    // Once the applications list has been read, the seller opens their app → the surface becomes the detail page
    // (or a scripted wrong page). This is what the open_app navigation observe + VERIFY_OPEN re-probe read.
    if (s.includes("passwordFieldPresent")) return this.opened ? this.postOpenCensusRead() : this.census; // census
    if (s.includes("issuance-appcount")) {
      this.opened = true;
      return this.appEntryCount;
    }
    if (s.includes("issuance-fixed-label-tag") || s.includes("issuance-fixed-label-locate")) {
      // Model a post-navigation re-render destroying the execution context under the fixed-label read.
      if (this.throwLocateLeft > 0) {
        this.throwLocateLeft -= 1;
        throw new Error("execution context was destroyed");
      }
      // Decoupled tag count (drift): the in-page exact-label scan may count differently than the locator did.
      if (this.tagResult) return this.tagResult;
      return this.locate;
    }
    if (s.includes("issuance-cleartag")) return true;
    return undefined;
  }

  async waitForFunction(_fn: unknown, _arg?: unknown, _opts?: unknown): Promise<unknown> {
    if (this.observed) return true;
    throw new Error("observe timeout"); // → observer.waitForUserAction returns false
  }

  // A spy the driver must NEVER call. Its presence lets a test prove automatic-action = 0.
  click(): void {
    this.clickCalls += 1;
  }

  on(event: string, handler: () => void): void {
    if (event === "close") this.closeHandlers.push(handler);
  }

  triggerClose(): void {
    for (const h of this.closeHandlers) h();
  }
}

function asPage(fake: FakePage): Page {
  return fake as unknown as Page;
}

/** A loopback transport that records everything the runtime published (mirrors issuance-session.test.ts). */
function loopback() {
  const sent: AwServerFrame[] = [];
  let listener: ((frame: AwClientFrame) => void) | null = null;
  const transport: AwServerTransport = {
    send: (frame) => {
      sent.push(frame);
    },
    subscribe: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
  };
  return {
    transport,
    send: (frame: AwClientFrame) => listener?.(frame),
    lastView: (): ActionWindowRunView | undefined => {
      const all = sent.filter((f) => f.kind === "aw_view");
      return (all[all.length - 1] as { view: ActionWindowRunView } | undefined)?.view;
    },
    views: (): ActionWindowRunView[] =>
      sent.filter((f) => f.kind === "aw_view").map((f) => (f as { view: ActionWindowRunView }).view),
    events: () =>
      sent
        .filter((f) => f.kind === "aw_event")
        .map((f) => (f as unknown as { event: { type: string; payload: Record<string, unknown> } }).event),
  };
}

interface BuildOptions extends FakePageOptions {
  context?: { pages(): Page[]; on?(e: "close", h: () => void): void };
  observeTimeoutMs?: number;
}

function build(o: BuildOptions = {}) {
  const io = loopback();
  const page = new FakePage(o);
  const engine = new IssuanceEngine({ runId: RUN_ID, channelCode: "naver" }, { clock: makeIssuanceClock() });
  const driver = new NaverIssuanceDriver(asPage(page), {
    observeTimeoutMs: o.observeTimeoutMs ?? 50,
    inpageRetryMs: 0,
    verifyPollMs: 0,
    ...(o.context ? { context: o.context } : {}),
  });
  const session = new IssuanceGuidanceSession(engine, driver, io.transport, { rearmDelayMs: 1 });
  session.attach();
  return { io, engine, driver, session, page };
}

function startRun(io: ReturnType<typeof loopback>, expectedRevision = 0): void {
  io.send({
    kind: "aw_command",
    command: {
      protocolVersion: 2,
      commandId: "c1",
      runId: RUN_ID,
      expectedRevision,
      type: "START_RUN",
      payload: { channelCode: "naver", intent: "API_ISSUANCE_GUIDANCE" },
    },
  });
}

function command(io: ReturnType<typeof loopback>, type: string, revision: number, id = "cx"): void {
  io.send({
    kind: "aw_command",
    command: { protocolVersion: 2, commandId: id, runId: RUN_ID, expectedRevision: revision, type: type as never },
  });
}

/** Every string/function passed to the fake's evaluate, across one or more pages. */
function allScripts(...pages: FakePage[]): string[] {
  return pages.flatMap((p) => p.scripts);
}

/**
 * Press SellerOps's "다음" (a REQUEST_STEP_RECHECK) through every remaining viewport checkpoint until the run
 * completes — api_group / credentials / create_app / return no longer wait for a NAVER click, so the operator
 * advances each. Bounded so a stuck run can't spin the test. (At a recoverable park this also re-probes.)
 */
async function pressNextToComplete(
  io: ReturnType<typeof loopback>,
  engine: IssuanceEngine,
  session: IssuanceGuidanceSession,
): Promise<void> {
  for (let i = 0; i < 8 && engine.currentStage() !== "guidance_complete"; i++) {
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision, `nx${i}`);
    await session.whenSettled();
  }
}

describe("NaverIssuanceDriver over a fake Page — the calibrated NEW-app (create) happy path (end-to-end)", () => {
  it("walks probe → read → create_app → api_group → credentials → return → COMPLETED, never clicking", async () => {
    const { io, engine, session, page } = build({ appEntryCount: 0 });
    startRun(io);
    await session.whenSettled();
    // create_app / api_group / credentials / return are same-page checkpoints now — advance each with "다음".
    await pressNextToComplete(io, engine, session);

    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.lastView()?.status).toBe("COMPLETED");
    // Empty application list → the step-2 control is CREATE (the calibrated new-app path).
    const step2 = io.views().find((v) => v.currentStep?.stepNumber === 2)?.currentStep;
    expect(step2?.copyParams?.targetKind).toBe("create_app");

    // Every highlighted target ref is an opaque 16-hex — never a selector or value. Five barriers highlight:
    // create_app, api_group, application_id, application_secret, and the guidance-only `return`.
    const refs = io.events().filter((e) => e.type === "TARGET_HIGHLIGHTED").map((e) => e.payload.targetRef as string);
    expect(refs.length).toBe(5);
    for (const ref of refs) expect(ref).toMatch(HEX16);

    // AUTOMATIC ACTION = 0: the driver never invoked the page's click.
    expect(page.clickCalls).toBe(0);
  });

  it("annotates read-only (data-aw-target set then cleared) and mounts then unmounts the overlay", async () => {
    const { io, engine, session, page } = build({ appEntryCount: 0 });
    startRun(io);
    await session.whenSettled();
    await pressNextToComplete(io, engine, session); // walk to completion so cleanup (clear-tag / untrack) runs

    const scripts = allScripts(page);
    // The read-only tag is set by the fixed-label locate/tag script…
    expect(scripts.some((s) => s.includes("setAttribute('data-aw-target'"))).toBe(true);
    // …and cleared on cleanup (the value-free clear-tag snippet ran).
    expect(scripts.some((s) => s.includes("issuance-cleartag"))).toBe(true);
    // Overlay reused (mount carries scrollIntoView; unmount carries the untrack teardown) — not reimplemented.
    expect(scripts.some((s) => s.includes("scrollIntoView"))).toBe(true);
    expect(scripts.some((s) => s.includes("untrack"))).toBe(true);
  });

  it("locates by a FIXED NAVER LABEL, never the synthetic [data-aw-target] fixture selector", async () => {
    const { io, session, page } = build({ appEntryCount: 0 });
    startRun(io);
    await session.whenSettled();
    const scripts = allScripts(page);
    // The calibrated locate is the fixed-label script (structural query + exact label), not the old fixture CSS.
    expect(scripts.some((s) => s.includes("issuance-fixed-label"))).toBe(true);
    expect(scripts.some((s) => s.includes("[data-aw-target='create_app']"))).toBe(false);
  });

  it("SECRET READ = 0: no evaluate — string snippet or overlay/observer function — ever reads/exfiltrates a value", async () => {
    const { io, session, page } = build({ appEntryCount: 0 });
    startRun(io);
    await session.whenSettled();

    for (const s of page.scripts) {
      // Value-exfiltration is forbidden EVERYWHERE (incl. the reused overlay/observer function bodies).
      for (const tok of [".value", "inputValue", "clipboard", "readText(", ".screenshot("]) {
        expect(s, `leaked ${tok}`).not.toContain(tok);
      }
      // Any evaluated snippet that reads element TEXT must be one of the AUDITED value-free label-comparison
      // scripts — never some other, unaudited text read. Two are allowed, both of which read text SOLELY to
      // compare against KNOWN fixed labels and emit ONLY a count/sig/boolean (their value-free OUTPUT is guarded
      // separately — the fixed-label locate in visual-recon-guard, the census in observe-api-center's
      // "emits only enums/buckets/booleans" test):
      //   - the fixed-label locate/tag script (`issuance-fixed-label`), and
      //   - the API-center census (`appDetailMarkerPresent` — the structural app-detail marker, a boolean).
      // This still catches a future driver change that started reading DOM text outside those audited paths.
      if (!s.startsWith("[fn]") && (s.includes(".textContent") || s.includes(".getAttribute("))) {
        const audited = s.includes("issuance-fixed-label") || s.includes("appDetailMarkerPresent");
        expect(audited, "text read must be an audited value-free label-comparison script").toBe(true);
      }
    }
  });

  it("no sanitized wire value ever carries the raw API-center URL host", async () => {
    const { io, session } = build({ appEntryCount: 0 });
    startRun(io);
    await session.whenSettled();
    const wire = JSON.stringify({ views: io.views(), events: io.events() });
    expect(wire).not.toContain("apicenter.commerce.naver.com");
  });
});

describe("NaverIssuanceDriver — the EXISTING-app branch (open_app = navigation guidance) completes", () => {
  it("guides the seller to open their app, OBSERVES the app_detail transition, then reuses api_group/credentials to COMPLETE", async () => {
    // One app in the list → step 2 is OPEN. The driver highlights NO app row — it shows guidance and observes
    // the seller's own app_list → app_detail navigation (postOpenCensus defaults to app_detail), verifies it,
    // and reuses the calibrated highlights. The whole walk completes without ever clicking.
    const { io, engine, session, page } = build({ appEntryCount: 1 });
    startRun(io);
    await session.whenSettled();
    // open_app is the ONLY observed transition; api_group / credentials / return are checkpoints — advance them.
    await pressNextToComplete(io, engine, session);

    const step2 = io.views().find((v) => v.currentStep?.stepNumber === 2)?.currentStep;
    expect(step2?.copyParams?.targetKind).toBe("open_app");
    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.lastView()?.status).toBe("COMPLETED");
    expect(io.events().map((e) => e.type)).not.toContain("RUN_FAILED");
    // open_app never located/highlighted a NAVER control (no fixed-label or structural locate ran for it) — the
    // only fixed-label locates are for api_group + credentials, plus the guidance overlays.
    const highlightedSteps = io.events().filter((e) => e.type === "TARGET_HIGHLIGHTED").map((e) => e.payload.stepId);
    expect(highlightedSteps).toContain("aw.issuance_api_group");
    expect(highlightedSteps).toContain("aw.issuance_application_id");
    expect(highlightedSteps).toContain("aw.issuance_application_secret");
    expect(page.scripts.some((s) => s.includes("issuance-structural"))).toBe(false);
    expect(page.clickCalls).toBe(0);
  });

  /**
   * **`open_app` must PAINT something.** It is the first guided step of the walk and it has no anchor to ring
   * (a live row anchor measured 44 matches), so it mounts the DOCKED panel. Without `dockedPanelOnly` the
   * mount finds no `[data-aw-target]`, returns from `if (!target && !o.dockedPanelOnly) return;`, and paints
   * NOTHING — silently. Live 2026-08-19: the API-center window opened, the app list was read, and the seller
   * saw no overlay for the entire walk.
   */
  it("open_app clears the prior tag, mounts the DOCKED panel, and verifies it painted", async () => {
    const { io, session, page } = build({ appEntryCount: 1 });
    startRun(io);
    await session.whenSettled();

    const mounts = page.scripts.filter((x) => x.includes("scrollIntoView") && x.includes("[fn]"));
    expect(mounts.length, "the walk mounted at least one overlay").toBeGreaterThan(0);
    // The step's own presentation exists: a TARGET_HIGHLIGHTED for step 2 means highlightTarget returned count 1,
    // which now REQUIRES a verified paint.
    const highlighted = io.events().filter((e) => e.type === "TARGET_HIGHLIGHTED").map((e) => e.payload.stepId);
    expect(highlighted).toContain("aw.issuance_open_or_create_app");
    // A step that claims no locator must leave no anchor behind, or the mount rings the PREVIOUS step's control.
    expect(page.scripts.some((x) => x.includes("issuance-cleartag"))).toBe(true);
  });

  /**
   * And the paint check is load-bearing in the other direction: a mount that ran but painted nothing must read
   * back as NOT highlighted, so the run parks recoverably instead of reporting a highlight that is not on screen.
   */
  it("open_app reports NOT highlighted when the mount painted nothing — never a fail-open highlight", async () => {
    const { io, session, page } = build({ appEntryCount: 1 });
    // Model "the mount ran but painted nothing" (the tag was lost to a soft-nav between tag and mount) by
    // answering the FIRST post-mount paint verify with `false`. `open_app` is the first step that mounts and
    // verifies, so this is its verify — reached through the public `evaluate` seam, not the fake's internals.
    const realEvaluate = page.evaluate.bind(page);
    let firstVerifyAnswered = false;
    page.evaluate = async (fnOrStr: unknown, arg?: unknown): Promise<unknown> => {
      const src = typeof fnOrStr === "string" ? fnOrStr : `[fn] ${String(fnOrStr)}`;
      const isOverlayVerify =
        typeof fnOrStr !== "string" &&
        src.includes("getElementById") &&
        !src.includes("scrollIntoView") &&
        !src.includes("untrack");
      const result = await realEvaluate(fnOrStr, arg);
      if (isOverlayVerify && !firstVerifyAnswered) {
        firstVerifyAnswered = true;
        return false;
      }
      return result;
    };
    startRun(io);
    await session.whenSettled();

    const highlighted = io.events().filter((e) => e.type === "TARGET_HIGHLIGHTED").map((e) => e.payload.stepId);
    expect(highlighted).not.toContain("aw.issuance_open_or_create_app");
  });

  it("COMPLETES when the existing-app detail page classifies as credential_issuance (issued keys shown read-only)", async () => {
    // The seller opens their EXISTING app; its detail page already shows the issued Application ID/Secret read-only,
    // so the shared classifier lands it on `credential_issuance` (read-only wins over the editable app_detail
    // signal). VERIFY_OPEN must accept that as the app-detail landing — rejecting it would dead-end exactly the
    // existing-app seller this path serves — then reuse api_group/credentials to COMPLETE.
    const { io, engine, session } = build({ appEntryCount: 1, postOpenCensus: CREDENTIAL_CENSUS });
    startRun(io);
    await session.whenSettled();
    await pressNextToComplete(io, engine, session);

    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.lastView()?.status).toBe("COMPLETED");
    expect(io.events().map((e) => e.type)).not.toContain("RUN_FAILED");
    const step2 = io.views().find((v) => v.currentStep?.stepNumber === 2)?.currentStep;
    expect(step2?.copyParams?.targetKind).toBe("open_app");
  });

  it("parks recoverably on page_mismatch when the seller lands on the WRONG page (not app_detail)", async () => {
    // The seller navigates off the applications list but not to the app detail (postOpenCensus = unknown). The
    // VERIFY_OPEN re-probe finds a non-detail page → recoverable page_mismatch, and api_group is never reached.
    const { io, engine, session, page } = build({ appEntryCount: 1, postOpenCensus: UNKNOWN_CENSUS });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("page_mismatch");
    expect(io.lastView()?.blocker).toEqual({ code: "UI_DRIFT", recoverable: true });
    expect(io.events().map((e) => e.type)).not.toContain("RUN_FAILED");
    expect(io.events().some((e) => e.type === "TARGET_HIGHLIGHTED" && e.payload.stepId === "aw.issuance_api_group")).toBe(false);
    expect(page.clickCalls).toBe(0);
  });
});

describe("NaverIssuanceDriver — login wait (recoverable park)", () => {
  it("parks on LOGIN_REQUIRED for a login page; a re-check after the seller logs in advances the run", async () => {
    const { io, engine, session, page } = build({ census: LOGIN_CENSUS, appEntryCount: 0 });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("waiting_login");
    expect(io.lastView()?.blocker).toEqual({ code: "LOGIN_REQUIRED", recoverable: true });
    expect(io.events().map((e) => e.type)).not.toContain("RUN_FAILED");

    // The seller logs in on their own screen; the page is now the (empty) app list. Re-check → re-probe → drive
    // to the create checkpoint, then "다음" through the remaining checkpoints to completion.
    page.census = APP_LIST_CENSUS;
    await pressNextToComplete(io, engine, session);

    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.lastView()?.blocker).toBeUndefined();
  });
});

describe("NaverIssuanceDriver — newest-tab handling", () => {
  it("reads the NEWEST tab when a context is injected (a stale tab is never read)", async () => {
    const stale = new FakePage({ census: LOGIN_CENSUS }); // an old login tab left behind
    const fresh = new FakePage({ census: APP_LIST_CENSUS, appEntryCount: 0 });
    const context = { pages: (): Page[] => [asPage(stale), asPage(fresh)], on: () => undefined };
    const io = loopback();
    const engine = new IssuanceEngine({ runId: RUN_ID, channelCode: "naver" }, { clock: makeIssuanceClock() });
    const driver = new NaverIssuanceDriver(asPage(fresh), { observeTimeoutMs: 50, context });
    const session = new IssuanceGuidanceSession(engine, driver, io.transport, { rearmDelayMs: 1 });
    session.attach();

    startRun(io);
    await session.whenSettled();
    await pressNextToComplete(io, engine, session);

    // The run completed off the FRESH (newest) tab; the stale tab was never read.
    expect(engine.currentStage()).toBe("guidance_complete");
    expect(fresh.scripts.length).toBeGreaterThan(0);
    expect(stale.scripts.length).toBe(0);
  });
});

describe("NaverIssuanceDriver — abort / recovery", () => {
  it("cleanup is idempotent (safe to call twice, even before any run)", async () => {
    const page = new FakePage();
    const driver = new NaverIssuanceDriver(asPage(page));
    await expect(driver.cleanup()).resolves.toBeUndefined();
    await expect(driver.cleanup()).resolves.toBeUndefined();
    expect(page.clickCalls).toBe(0);
  });

  it("a closed API-center window parks the run recoverably on page_mismatch (never re-arms a dead page)", async () => {
    // observed:false → the run rests at the first barrier (create_app) after highlighting.
    const { io, engine, session, page } = build({ appEntryCount: 0, observed: false });
    startRun(io);
    await session.whenSettled();
    expect(engine.isAtBarrier()).toBe(true);

    // The seller closes the window.
    page.triggerClose();
    await session.whenSettled();

    expect(engine.currentStage()).toBe("page_mismatch");
    expect(io.lastView()?.blocker).toEqual({ code: "UI_DRIFT", recoverable: true });
    expect(io.events().map((e) => e.type)).not.toContain("RUN_FAILED");
    expect(page.clickCalls).toBe(0);
  });
});

describe("NaverIssuanceDriver — read-only probeTargetMatch (Phase-B selector probe mechanism)", () => {
  it("reports matchCount + canHighlight for a calibrated target WITHOUT tagging or overlaying (read-only)", async () => {
    const page = new FakePage({ locate: { count: 1, sig: "abcd1234abcd1234" } });
    const driver = new NaverIssuanceDriver(asPage(page));
    const res = await driver.probeTargetMatch("create_app");
    expect(res).toEqual({ matchCount: 1, canHighlight: true });
    // Read-only: the probe ran the LOCATE (never the TAG) script — no data-aw-target write, and no overlay mount.
    expect(page.scripts.some((s) => s.includes("issuance-fixed-label-locate"))).toBe(true);
    expect(page.scripts.some((s) => s.includes("issuance-fixed-label-tag"))).toBe(false);
    expect(page.scripts.some((s) => s.includes("scrollIntoView"))).toBe(false);
    expect(page.clickCalls).toBe(0);
  });

  it("reports a non-unique match as not highlightable", async () => {
    const page = new FakePage({ locate: { count: 3 } });
    const driver = new NaverIssuanceDriver(asPage(page));
    const res = await driver.probeTargetMatch("api_group");
    expect(res).toEqual({ matchCount: 3, canHighlight: false });
  });
});

describe("NaverIssuanceDriver — bounded in-page retry on an execution-context race", () => {
  it("RECOVERS a transient execution-context error on a locate (settle + bounded retry), no park needed", async () => {
    // The app-detail SPA re-rendered under the FIRST fixed-label read; the driver settles and retries and the
    // second read succeeds — so a one-off post-navigation race never reaches the engine as a fault.
    const page = new FakePage({ locate: { count: 1, sig: "abcd1234abcd1234" }, throwLocateTimes: 1 });
    const driver = new NaverIssuanceDriver(asPage(page), { inpageRetryMs: 0 });
    const res = await driver.locateTarget("api_group");
    expect(res).toEqual({ count: 1, sig: "abcd1234abcd1234" });
  });

  it("GIVES UP after the bounded retries and throws (→ the engine parks recoverably), never looping forever", async () => {
    // A page that destroys the execution context on EVERY read is a genuine fault: after the bounded retries the
    // driver throws, and the session/engine turn that into a recoverable page_mismatch park (tested elsewhere).
    const page = new FakePage({ throwLocateTimes: 99 });
    const driver = new NaverIssuanceDriver(asPage(page), { inpageRetryMs: 0 });
    await expect(driver.locateTarget("api_group")).rejects.toThrow();
    // Bounded: MAX_INPAGE_RETRIES(2) + 1 = 3 attempts, never more.
    expect(page.scripts.filter((s) => s.includes("issuance-fixed-label")).length).toBe(3);
  });

  it("a locator that never resolves the label TIMES OUT to a bounded target_not_found (count 0), no infinite wait", async () => {
    // The SPA-stable resolution is Playwright-locator based: when the fixed label never renders, the locator's
    // bounded `waitFor` TIMES OUT and the driver returns `{ count: 0 }` (→ engine parks target_not_found,
    // recoverable) rather than running the audited `.evaluate` blind or waiting forever.
    FakeLocator.waitForCalls = 0;
    const page = new FakePage({ locatorTimeout: true });
    const driver = new NaverIssuanceDriver(asPage(page), { inpageRetryMs: 0 });
    const res = await driver.locateTarget("api_group");
    expect(res).toEqual({ count: 0 });
    // A timeout is a bounded miss, returned on the FIRST attempt — the resolver does not retry a timeout.
    expect(FakeLocator.waitForCalls).toBe(1);
    // The audited fixed-label `.evaluate` never ran (the locator gated it): resolution stayed off `.evaluate`.
    expect(page.scripts.some((s) => s.includes("issuance-fixed-label"))).toBe(false);
  });
});

describe("NaverIssuanceDriver — SPA-safe overlay mount (api_group overlay renders despite a soft-nav)", () => {
  it("recovers a transient context-destroy during the api_group OVERLAY MOUNT → overlay renders, run completes", async () => {
    // The overlay mount was the remaining raw `.evaluate` that raced the SPA soft-nav (live-#5). THREE transient
    // throws exhaust the overlay's own bounded retry, so the driver's ATOMIC re-tag + re-mount must recover — the
    // api_group section is highlighted (its overlay mounts) and the walk completes, instead of parking with no overlay.
    const { io, engine, session } = build({ appEntryCount: 1, apiGroupMountThrowTimes: 3 });
    startRun(io);
    await session.whenSettled();
    await pressNextToComplete(io, engine, session);

    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.lastView()?.status).toBe("COMPLETED");
    expect(io.events().map((e) => e.type)).not.toContain("RUN_FAILED");
    // api_group WAS highlighted (its overlay mounted) despite the transient mount throws — not a page_mismatch park.
    expect(io.events().some((e) => e.type === "TARGET_HIGHLIGHTED" && e.payload.stepId === "aw.issuance_api_group")).toBe(true);
  });

  it("a PERMANENT overlay-mount fault parks recoverably (never loops, never RUN_FAILED)", async () => {
    // A page that destroys the context on EVERY api_group mount is a genuine fault: after the overlay retry AND
    // the driver's bounded re-tag+re-mount both exhaust, it parks page_mismatch (recoverable), never a dead loop.
    const { io, engine, session } = build({ appEntryCount: 1, apiGroupMountThrowTimes: 99 });
    startRun(io);
    await session.whenSettled();
    // Clear the text-only step-3 usage-state advisory so the api_group guide (which mount-throws) is reached.
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision, "usage");
    await session.whenSettled();

    expect(engine.currentStage()).toBe("page_mismatch");
    expect(io.lastView()?.blocker).toEqual({ code: "UI_DRIFT", recoverable: true });
    expect(io.events().map((e) => e.type)).not.toContain("RUN_FAILED");
  });

  it("a SILENT no-op mount (ran, painted nothing) is CAUGHT by the overlayMounted verify → atomic re-mount recovers", async () => {
    // The review's HIGH: the mount can run WITHOUT throwing yet paint nothing (mountOverlay's `if(!target) return`
    // when the tag was lost to a soft-nav — including when the mount's own retry ran against a fresh context). The
    // post-mount `overlayMounted` verify must catch that and force the atomic re-tag+re-mount, so the run does NOT
    // report a highlighted control with no overlay (fail-OPEN). Two silent no-ops, then it paints and completes.
    const { io, engine, session } = build({ appEntryCount: 1, apiGroupMountNoPaintTimes: 2 });
    startRun(io);
    await session.whenSettled();
    await pressNextToComplete(io, engine, session);

    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.lastView()?.status).toBe("COMPLETED");
    // api_group WAS truly highlighted (overlay painted) only after the verify forced a re-mount — not fail-open.
    expect(io.events().some((e) => e.type === "TARGET_HIGHLIGHTED" && e.payload.stepId === "aw.issuance_api_group")).toBe(true);
  });

  it("a PERMANENT silent no-op mount parks recoverably — never a fail-OPEN highlight with no overlay", async () => {
    // If the mount NEVER paints, the verify keeps failing; after the bounded re-tag+re-mount exhausts it parks
    // page_mismatch (recoverable) rather than emitting TARGET_HIGHLIGHTED for a control with no overlay on screen.
    const { io, engine, session } = build({ appEntryCount: 1, apiGroupMountNoPaintTimes: 99 });
    startRun(io);
    await session.whenSettled();
    // Clear the text-only step-3 usage-state advisory so the api_group guide (which never paints) is reached.
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision, "usage");
    await session.whenSettled();

    expect(engine.currentStage()).toBe("page_mismatch");
    expect(io.lastView()?.blocker).toEqual({ code: "UI_DRIFT", recoverable: true });
    // Fail-CLOSED: api_group was NOT reported highlighted, because its overlay never painted.
    expect(io.events().some((e) => e.type === "TARGET_HIGHLIGHTED" && e.payload.stepId === "aw.issuance_api_group")).toBe(false);
    expect(io.events().map((e) => e.type)).not.toContain("RUN_FAILED");
  });
});

describe("NaverIssuanceDriver — VERIFY_OPEN rides out a mid-hydration unknown (bounded polling)", () => {
  it("completes step 2 when the app-detail SPA hydrates unknown → unknown → app_detail (no premature park)", async () => {
    // The seller opens their existing app; the detail SPA classifies as a transient `unknown` for two reads before
    // it settles to `app_detail`. The old single-read VERIFY would have parked page_mismatch on the first unknown;
    // the bounded-polling probe rides it out and step 2 completes, then "다음" walks the checkpoints to COMPLETED.
    const { io, engine, session } = build({
      appEntryCount: 1,
      postOpenCensusSequence: [UNKNOWN_CENSUS, UNKNOWN_CENSUS, APP_DETAIL_CENSUS],
    });
    startRun(io);
    await session.whenSettled();
    await pressNextToComplete(io, engine, session);

    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.lastView()?.status).toBe("COMPLETED");
    // It did NOT dead-end on the transient unknown: no RUN_FAILED, and step 2 (open) did complete.
    expect(io.events().map((e) => e.type)).not.toContain("RUN_FAILED");
    const step2 = io.views().find((v) => v.currentStep?.stepNumber === 2)?.currentStep;
    expect(step2?.copyParams?.targetKind).toBe("open_app");
  });

  it("still parks recoverably when the landing NEVER settles to app_detail (stable wrong page)", async () => {
    // A wrong page that stays `unknown` for the whole bounded window must still park page_mismatch (fail-closed) —
    // the polling adds latency, never a false pass. `postOpenCensus` (single stable unknown) drives every poll.
    const { io, engine, session } = build({ appEntryCount: 1, postOpenCensus: UNKNOWN_CENSUS });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("page_mismatch");
    expect(io.lastView()?.blocker).toEqual({ code: "UI_DRIFT", recoverable: true });
    expect(io.events().map((e) => e.type)).not.toContain("RUN_FAILED");
  });
});

describe("NaverIssuanceDriver — Overlay Root-Cause Isolation: per-stage sanitized fault telemetry", () => {
  const REASONS = ["TIMEOUT", "CONTEXT_DESTROYED", "FRAME_DETACHED", "TARGET_CLOSED", "NO_PAINT", "OTHER"];
  const faults = () => getLogSink().filter((e) => e.event === "aw_issuance_stage_fault");

  it("names stage=resolve reason=TIMEOUT on a locator timeout — behaviour still count 0 (bounded miss)", async () => {
    clearLogSink();
    const page = new FakePage({ locatorTimeout: true });
    const driver = new NaverIssuanceDriver(asPage(page), { inpageRetryMs: 0 });
    const res = await driver.locateTarget("api_group");
    expect(res).toEqual({ count: 0 }); // unchanged control flow
    const f = faults();
    expect(f.length).toBe(1); // a timeout is not retried
    expect(f[0]!.meta).toMatchObject({ target: "api_group", stage: "resolve", reason: "TIMEOUT", timeout: true });
  });

  it("names stage=tag reason=CONTEXT_DESTROYED when the fixed-label evaluate loses its context (every attempt)", async () => {
    clearLogSink();
    const page = new FakePage({ throwLocateTimes: 99 });
    const driver = new NaverIssuanceDriver(asPage(page), { inpageRetryMs: 0 });
    await expect(driver.locateTarget("api_group")).rejects.toThrow();
    const f = faults();
    expect(f.length).toBe(3); // MAX_INPAGE_RETRIES(2) + 1
    for (const e of f) expect(e.meta).toMatchObject({ stage: "tag", reason: "CONTEXT_DESTROYED" });
  });

  it("names stage=mount reason=CONTEXT_DESTROYED when the OVERLAY MOUNT loses its context", async () => {
    clearLogSink();
    const page = new FakePage({ apiGroupMountThrowTimes: 99 });
    const driver = new NaverIssuanceDriver(asPage(page), { inpageRetryMs: 0 });
    await expect(driver.highlightTarget("api_group")).rejects.toThrow();
    const f = faults();
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f.every((e) => e.meta.stage === "mount")).toBe(true);
    expect(f.every((e) => e.meta.reason === "CONTEXT_DESTROYED")).toBe(true);
  });

  it("names stage=visible_check reason=NO_PAINT for a silent no-op mount — DISTINCT from a context-destroy", async () => {
    clearLogSink();
    const page = new FakePage({ apiGroupMountNoPaintTimes: 99 });
    const driver = new NaverIssuanceDriver(asPage(page), { inpageRetryMs: 0 });
    await expect(driver.highlightTarget("api_group")).rejects.toThrow();
    const f = faults();
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f.every((e) => e.meta.stage === "visible_check")).toBe(true);
    expect(f.every((e) => e.meta.reason === "NO_PAINT")).toBe(true);
  });

  it("telemetry is SANITIZED: closed reason enum + error NAME only, never a raw fault message", async () => {
    clearLogSink();
    const page = new FakePage({ apiGroupMountThrowTimes: 99 });
    const driver = new NaverIssuanceDriver(asPage(page), { inpageRetryMs: 0 });
    await expect(driver.highlightTarget("api_group")).rejects.toThrow();
    for (const e of faults()) {
      expect(REASONS).toContain(e.meta.reason as string);
      expect(e.meta.errorName).toBe("Error"); // NAME only — no message
      const blob = JSON.stringify(e.meta);
      // The raw Playwright message ("…most likely because of a navigation") must never ride out in the meta.
      expect(blob).not.toContain("most likely");
      expect(blob).not.toContain("navigation");
    }
  });

  it("emits stage_ok (no stage_fault) on the calibrated happy path", async () => {
    clearLogSink();
    const { io, engine, session } = build({ appEntryCount: 0 });
    startRun(io);
    await session.whenSettled();
    await pressNextToComplete(io, engine, session);
    expect(getLogSink().some((e) => e.event === "aw_issuance_stage_ok")).toBe(true);
    expect(faults().length).toBe(0);
  });

  it("a swallowed SCROLL fault emits a DISTINCT event (not a terminal fault) and the resolve still succeeds", async () => {
    clearLogSink();
    // Scroll rejects, but it is best-effort: the resolve proceeds to tag+ok. The scroll fault is recorded under
    // its own event so a diagnostic counting `aw_issuance_stage_fault` never conflates it with a drive fault.
    const page = new FakePage({ scrollThrows: true });
    const driver = new NaverIssuanceDriver(asPage(page), { inpageRetryMs: 0 });
    const res = await driver.locateTarget("api_group");
    expect(res).toEqual({ count: 1, sig: "abcd1234abcd1234" }); // resolve unaffected by the swallowed scroll
    expect(faults().length).toBe(0); // NOT counted as a terminal fault
    const swallowed = getLogSink().filter((e) => e.event === "aw_issuance_stage_scroll_swallowed");
    expect(swallowed.length).toBe(1);
    expect(swallowed[0]!.meta).toMatchObject({ target: "api_group", stage: "scroll", reason: "CONTEXT_DESTROYED" });
  });

  it("a tag-stage non-unique result is recorded (aw_issuance_stage_nonunique) and returned as count, not a fault", async () => {
    clearLogSink();
    // Locator resolved uniquely, but the in-page exact-label scan counted 2 → the tag-stage non-unique path: a
    // sanitized nonunique record + a plain {count:2} return (engine parks target_not_found), never a stage fault.
    const page = new FakePage({ tagResult: { count: 2 } });
    const driver = new NaverIssuanceDriver(asPage(page), { inpageRetryMs: 0 });
    const res = await driver.locateTarget("api_group");
    expect(res).toEqual({ count: 2 });
    expect(faults().length).toBe(0);
    const nonunique = getLogSink().filter((e) => e.event === "aw_issuance_stage_nonunique");
    expect(nonunique.length).toBe(1);
    expect(nonunique[0]!.meta).toMatchObject({ target: "api_group", stage: "tag", count: 2 });
  });
});

describe("NaverIssuanceDriver — Overlay Mount Fault Identification: sub-stage + fingerprinted mount fault", () => {
  const substageFaults = () => getLogSink().filter((e) => e.event === "aw_issuance_mount_substage_fault");

  it("localizes a generic mount fault to its sub-stage breadcrumb + a fixed fingerprint (control flow unchanged)", async () => {
    clearLogSink();
    // A NON-TRANSIENT generic Error whose message IS a recognized shape ("… is not defined") thrown from the
    // append_overlay sub-stage — models the live reason=OTHER mount fault, now localizable.
    const page = new FakePage({
      apiGroupMountFaultTimes: 99,
      apiGroupMountFaultMessage: "__name is not defined",
      mountSubStage: "reveal_target",
    });
    const driver = new NaverIssuanceDriver(asPage(page), { inpageRetryMs: 0 });
    await expect(driver.highlightTarget("api_group")).rejects.toThrow(); // SAME rejection as before — unchanged

    const subs = substageFaults();
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs.every((e) => e.meta.target === "api_group")).toBe(true);
    expect(subs.every((e) => e.meta.subStage === "reveal_target")).toBe(true); // monotonic breadcrumb localized it
    expect(subs.every((e) => e.meta.reason === "SYMBOL_NOT_DEFINED")).toBe(true); // code-fingerprinted, not "OTHER"
    expect(subs.every((e) => e.meta.errorName === "Error")).toBe(true);
    // A RECOGNIZED fingerprint never attaches a message — the enum alone carries the cause.
    expect(subs.every((e) => !("message" in e.meta))).toBe(true);

    // Control flow byte-unchanged: the OUTER stage telemetry still fires (stage=mount) and the run still rejects.
    const stageFaults = getLogSink().filter((e) => e.event === "aw_issuance_stage_fault");
    expect(stageFaults.length).toBeGreaterThanOrEqual(1);
    expect(stageFaults.every((e) => e.meta.stage === "mount")).toBe(true);
  });

  it("attaches a SANITIZED message ONLY for an UNKNOWN cause — digits/URL/quoted spans all scrubbed", async () => {
    clearLogSink();
    const page = new FakePage({
      apiGroupMountFaultTimes: 99,
      apiGroupMountFaultMessage: "kaboom at line 42 https://apicenter.commerce.naver.com/x 'div.secret-value'",
      mountSubStage: "position_overlay",
    });
    const driver = new NaverIssuanceDriver(asPage(page), { inpageRetryMs: 0 });
    await expect(driver.highlightTarget("api_group")).rejects.toThrow();

    const subs = substageFaults();
    expect(subs.length).toBeGreaterThanOrEqual(1);
    for (const e of subs) {
      expect(e.meta.reason).toBe("UNKNOWN"); // no known fingerprint → the one case that may carry a message
      expect(e.meta.subStage).toBe("position_overlay");
      const msg = e.meta.message as string;
      expect(typeof msg).toBe("string");
      // Sanitized: the raw URL, the digits, and the quoted (potentially value-bearing) span are all gone.
      expect(msg).not.toContain("42");
      expect(msg).not.toContain("http");
      expect(msg).not.toContain("apicenter");
      expect(msg).not.toContain("secret-value");
      expect(msg).not.toContain("naver");
      expect(msg.length).toBeLessThanOrEqual(MAX_MOUNT_MESSAGE_ASSERT);
      // The framework shape survives so the diagnostic is still useful.
      expect(msg).toContain("kaboom");
    }
  });

  it("a transient context-destroy mount fault is fingerprinted CONTEXT_DESTROYED (still no message)", async () => {
    clearLogSink();
    const page = new FakePage({ apiGroupMountThrowTimes: 99, mountSubStage: "append_overlay" });
    const driver = new NaverIssuanceDriver(asPage(page), { inpageRetryMs: 0 });
    await expect(driver.highlightTarget("api_group")).rejects.toThrow();

    const subs = substageFaults();
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs.every((e) => e.meta.reason === "CONTEXT_DESTROYED")).toBe(true);
    expect(subs.every((e) => !("message" in e.meta))).toBe(true);
  });

  it("reads back `unknown` when the breadcrumb is unreadable (fault predated the first stamp / context gone)", async () => {
    clearLogSink();
    const page = new FakePage({ apiGroupMountFaultTimes: 99, mountSubStage: undefined });
    const driver = new NaverIssuanceDriver(asPage(page), { inpageRetryMs: 0 });
    await expect(driver.highlightTarget("api_group")).rejects.toThrow();

    const subs = substageFaults();
    expect(subs.length).toBeGreaterThanOrEqual(1);
    expect(subs.every((e) => e.meta.subStage === "unknown")).toBe(true);
  });

  it("emits NO mount-substage fault on the calibrated happy path", async () => {
    clearLogSink();
    const { io, engine, session } = build({ appEntryCount: 0 });
    startRun(io);
    await session.whenSettled();
    await pressNextToComplete(io, engine, session);
    expect(substageFaults().length).toBe(0);
  });
});
