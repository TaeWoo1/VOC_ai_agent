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
 * (create_app → api_group → credentials → return) is calibrated by fixed labels and completes; the
 * EXISTING-app path is NOT ready — `open_app` has no fixed label, so it parks `target_not_found`
 * recoverably. `return` is guidance-only (a fixed synthetic signature; no NAVER control queried).
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
import type { ApiCenterStructuralCensus } from "../../../src/cli/observe-api-center";
import type { LocateResult } from "../../../src/action-window/engine";

const RUN_ID = "run_issuance_live01";
const HEX16 = /^[0-9a-f]{16}$/;
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

interface FakePageOptions {
  url?: string;
  census?: ApiCenterStructuralCensus;
  locate?: LocateResult;
  /** Override the result of the value-free STRUCTURAL locate (open_app's app-entry-row anchor). Defaults to `locate`. */
  structuralLocate?: LocateResult;
  appEntryCount?: number;
  observed?: boolean;
}

/** A scripted, browser-free Page: records every evaluate, returns scripted values, and spies on `click`. */
class FakePage {
  urlValue: string;
  census: ApiCenterStructuralCensus;
  locate: LocateResult;
  structuralLocate: LocateResult;
  appEntryCount: number;
  observed: boolean;

  readonly scripts: string[] = [];
  clickCalls = 0;
  private readonly closeHandlers: Array<() => void> = [];

  constructor(o: FakePageOptions = {}) {
    this.urlValue = o.url ?? API_CENTER_URL;
    this.census = o.census ?? APP_LIST_CENSUS;
    this.locate = o.locate ?? { count: 1, sig: "abcd1234abcd1234" };
    this.structuralLocate = o.structuralLocate ?? this.locate;
    this.appEntryCount = o.appEntryCount ?? 0; // default = EMPTY app list → the calibrated new-app (create) path
    this.observed = o.observed ?? true;
  }

  url(): string {
    return this.urlValue;
  }

  async evaluate(fnOrStr: unknown, _arg?: unknown): Promise<unknown> {
    // Record the STRING for string snippets, and the function SOURCE for the overlay/observer primitives,
    // so a single sweep proves no evaluate ever reads a credential value.
    const s = typeof fnOrStr === "string" ? fnOrStr : `[fn] ${String(fnOrStr)}`;
    this.scripts.push(s);
    if (typeof fnOrStr !== "string") return undefined; // overlay/observer function-form → no-op
    if (s.includes("passwordFieldPresent")) return this.census; // EXTRACT_API_CENTER_CENSUS
    if (s.includes("issuance-appcount")) return this.appEntryCount;
    if (s.includes("issuance-fixed-label-tag") || s.includes("issuance-fixed-label-locate")) return this.locate;
    if (s.includes("issuance-structural-tag") || s.includes("issuance-structural-locate")) return this.structuralLocate;
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

describe("NaverIssuanceDriver over a fake Page — the calibrated NEW-app (create) happy path (end-to-end)", () => {
  it("walks probe → read → create_app → api_group → credentials → return → COMPLETED, never clicking", async () => {
    const { io, engine, session, page } = build({ appEntryCount: 0 });
    startRun(io);
    await session.whenSettled();

    expect(engine.currentStage()).toBe("guidance_complete");
    expect(io.lastView()?.status).toBe("COMPLETED");
    // Empty application list → the step-2 control is CREATE (the calibrated new-app path).
    const step2 = io.views().find((v) => v.currentStep?.stepNumber === 2)?.currentStep;
    expect(step2?.copyParams?.targetKind).toBe("create_app");

    // Every highlighted target ref is an opaque 16-hex — never a selector or value. Four barriers highlight:
    // create_app, api_group, credentials, and the guidance-only `return`.
    const refs = io.events().filter((e) => e.type === "TARGET_HIGHLIGHTED").map((e) => e.payload.targetRef as string);
    expect(refs.length).toBe(4);
    for (const ref of refs) expect(ref).toMatch(HEX16);

    // AUTOMATIC ACTION = 0: the driver never invoked the page's click.
    expect(page.clickCalls).toBe(0);
  });

  it("annotates read-only (data-aw-target set then cleared) and mounts then unmounts the overlay", async () => {
    const { io, session, page } = build({ appEntryCount: 0 });
    startRun(io);
    await session.whenSettled();

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
      // Any evaluated snippet that reads element TEXT must be the AUDITED value-free fixed-label locate script
      // (guarded for value-free OUTPUT in visual-recon-guard) — never some other, unaudited text read. This
      // catches a future driver change that started reading DOM text outside that one audited path.
      if (!s.startsWith("[fn]") && (s.includes(".textContent") || s.includes(".getAttribute("))) {
        expect(s, "text read must be the audited fixed-label locate script").toContain("issuance-fixed-label");
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

describe("NaverIssuanceDriver — the EXISTING-app branch fails closed on open_app's UNMEASURED structural candidate", () => {
  it("parks target_not_found at open_app (a structural_candidate is not guided-highlightable), never a wrong highlight or click", async () => {
    // One app in the list → step 2 is OPEN. Even if the structural anchor WOULD resolve to a single row
    // (fake default count:1), the GUIDED walk must not highlight an unconfirmed candidate — it parks.
    const { io, engine, session, page } = build({ appEntryCount: 1 });
    startRun(io);
    await session.whenSettled();

    const step2 = io.views().find((v) => v.currentStep?.stepNumber === 2)?.currentStep;
    expect(step2?.copyParams?.targetKind).toBe("open_app");
    expect(engine.currentStage()).toBe("target_not_found");
    expect(io.lastView()?.blocker).toEqual({ code: "TARGET_NOT_FOUND", recoverable: true });
    expect(io.events().map((e) => e.type)).not.toContain("RUN_FAILED");
    // Nothing was highlighted and — crucially — the guided walk never even ran the structural locate script.
    expect(io.events().some((e) => e.type === "TARGET_HIGHLIGHTED")).toBe(false);
    expect(page.scripts.some((s) => s.includes("issuance-structural"))).toBe(false);
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

    // The seller logs in on their own screen; the page is now the (empty) app list. Re-check → re-probe → drive on.
    page.census = APP_LIST_CENSUS;
    command(io, "REQUEST_STEP_RECHECK", io.lastView()!.revision);
    await session.whenSettled();

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

  it("measures open_app's value-free STRUCTURAL anchor read-only (unique → highlightable)", async () => {
    const page = new FakePage({ structuralLocate: { count: 1, sig: "abcd1234abcd1234" } });
    const driver = new NaverIssuanceDriver(asPage(page));
    const res = await driver.probeTargetMatch("open_app");
    expect(res).toEqual({ matchCount: 1, canHighlight: true });
    // It ran the value-free STRUCTURAL locate (no fixed label, no text read) and never the tag/overlay path.
    expect(page.scripts.some((s) => s.includes("issuance-structural-locate"))).toBe(true);
    expect(page.scripts.some((s) => s.includes("issuance-structural-tag"))).toBe(false);
    expect(page.clickCalls).toBe(0);
  });

  it("reports open_app as not highlightable when its structural anchor is non-unique", async () => {
    const page = new FakePage({ structuralLocate: { count: 5 } });
    const driver = new NaverIssuanceDriver(asPage(page));
    const res = await driver.probeTargetMatch("open_app");
    expect(res).toEqual({ matchCount: 5, canHighlight: false });
  });

  it("reports a non-unique match as not highlightable", async () => {
    const page = new FakePage({ locate: { count: 3 } });
    const driver = new NaverIssuanceDriver(asPage(page));
    const res = await driver.probeTargetMatch("api_group");
    expect(res).toEqual({ matchCount: 3, canHighlight: false });
  });
});
