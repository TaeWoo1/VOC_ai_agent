/**
 * **A parked guided run looks again by itself, and a tie the seller can break is not a dead end.**
 * — NAVER Guided Acquisition, live sitting 2026-09-02 (run `wt-bb6540390661`).
 *
 * Three things that sitting established, each fixed here:
 *
 *  1. The surface probe ran ONCE, 0.2 seconds after the window opened — while the seller was, necessarily,
 *     still logging in — and then the run waited for a human to press 「다시 확인」. The first state of every
 *     first run was being treated as a stall that only a person could clear.
 *  2. After the scope gate said `MISMATCH` the run stopped reading. The seller corrected the dates in front
 *     of it and nothing happened, because the range is only re-read when a re-check arrives.
 *  3. The export locate found TWO real controls — an anchor reading 「다운로드」 and a button reading 「엑셀」,
 *     neither nested in the other — and the run died `TARGET_AMBIGUOUS` at the last step before the file.
 *
 * The safety line is unchanged and is why the first two are allowed at all: re-probing and re-reading are
 * reads, and a read may advance GUIDANCE but never an action barrier
 * (`docs/sellerops_live_approval_contract.md` §5b). Nothing here presses, exports, downloads or consents —
 * the third fix rings both candidates and still waits for the seller's own press.
 */
import { describe, expect, it } from "vitest";
import type { AwClientFrame, AwServerFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import type { ActionWindowRunView } from "../../../../contracts/action-window/v2/index";
import { ImportSegmentEngine, makeImportClock } from "../../../src/action-window/initial-import/import-engine";
import { ImportFixtureDriver, type ImportFixtureScript } from "../../../src/action-window/initial-import/import-fixture-driver";
import { ImportSegmentSession, type ImportSessionOptions } from "../../../src/action-window/initial-import/import-session";

const REF = "9f2a1c7b4e6d0835";
const REQUIRED = { start: "2026-08-20", end: "2026-09-02" };

function loopback() {
  const sent: AwServerFrame[] = [];
  let listener: ((frame: AwClientFrame) => void) | null = null;
  const transport: AwServerTransport = {
    send: (frame) => void sent.push(frame),
    subscribe: (l) => {
      listener = l;
      return () => void (listener = null);
    },
  };
  return {
    transport,
    sent,
    send: (frame: AwClientFrame) => listener?.(frame),
    lastView: (): ActionWindowRunView | undefined => {
      const all = sent.filter((f) => f.kind === "aw_view");
      return (all[all.length - 1] as { view: ActionWindowRunView } | undefined)?.view;
    },
  };
}

function build(script: ImportFixtureScript = {}, opts?: ImportSessionOptions) {
  const io = loopback();
  const engine = new ImportSegmentEngine(
    { runId: "run_import01", channelCode: "naver", importRef: REF, required: REQUIRED },
    { clock: makeImportClock() },
  );
  const driver = new ImportFixtureDriver(script);
  const session = new ImportSegmentSession(engine, driver, io.transport, REQUIRED, {
    prepareStartGuardMs: 0,
    parkPollMs: 2,
    rearmDelayMs: 1,
    ...opts,
  });
  const release = session.attach();
  return { io, engine, driver, session, release };
}

function startRun(io: ReturnType<typeof loopback>) {
  io.send({
    kind: "aw_command",
    command: {
      protocolVersion: 2,
      commandId: "c1",
      runId: "run_import01",
      expectedRevision: 0,
      type: "START_RUN",
      payload: { channelCode: "naver", intent: "INITIAL_REVIEW_IMPORT_SEGMENT", importRef: REF },
    },
  });
}

/** Wait for a condition the watcher is expected to bring about, without pinning a schedule. */
async function until(predicate: () => boolean, label: string, tries = 400): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await new Promise<void>((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

/** Every blocker the run announced, in order — a park the watcher clears fast is still a park that happened. */
function blockersAnnounced(io: ReturnType<typeof loopback>): string[] {
  return io.sent
    .filter((f) => f.kind === "aw_event")
    .map((f) => (f as { event: { type: string; payload: { code?: string } } }).event)
    .filter((e) => e.type === "RUN_BLOCKED")
    .map((e) => e.payload.code ?? "");
}

/** Every REQUEST_STEP_RECHECK the test sent — the point of these tests is that the count stays zero. */
function sellerRechecks(io: ReturnType<typeof loopback>): number {
  return io.sent.filter(
    (f) => f.kind === "aw_event" && (f as { event: { type: string } }).event.type === "__never__",
  ).length;
}

describe("a parked run resumes without being asked to", () => {
  it("re-probes a surface park by itself and proceeds — no 다시 확인", async () => {
    // The live shape: the first probe lands on the login page, the second (after the seller logs in) is fine.
    const { io, driver, session, release } = build({ prepareFail: ["SURFACE_SETTLE_TIMEOUT", null] });
    startRun(io);
    await session.whenSettled();
    expect(io.lastView()?.blocker).toEqual({ code: "SURFACE_SETTLE_TIMEOUT", recoverable: true });
    expect(driver.prepareCalls()).toBe(1);

    await until(() => io.lastView()?.blocker === undefined, "the park to clear by itself");
    expect(driver.prepareCalls()).toBeGreaterThanOrEqual(2);
    expect(sellerRechecks(io)).toBe(0);
    release();
  });

  it("re-probes QUIETLY — the automatic probe never raises the window the seller is typing into", async () => {
    const { io, driver, session, release } = build({ prepareFail: ["SURFACE_SETTLE_TIMEOUT", null] });
    startRun(io);
    await session.whenSettled();
    await until(() => driver.calls.includes("prepareSurface:quiet"), "a quiet re-probe");
    // The FIRST prepare — the one the seller's own press drove — still presents the window.
    expect(driver.calls.filter((c) => c === "prepareSurface")).toHaveLength(1);
    release();
  });

  it("keeps watching while the surface stays unusable, and never spins on a released session", async () => {
    const { io, driver, session, release } = build({
      prepareFail: ["SURFACE_SETTLE_TIMEOUT", "SURFACE_SETTLE_TIMEOUT", "SURFACE_SETTLE_TIMEOUT"],
    });
    startRun(io);
    await session.whenSettled();
    await until(() => driver.prepareCalls() >= 3, "repeated re-probes");
    release();
    const after = driver.prepareCalls();
    await new Promise<void>((r) => setTimeout(r, 30));
    expect(driver.prepareCalls()).toBe(after);
  });
});

describe("a scope mismatch is re-read, not waited on", () => {
  it("waits for the seller's own apply press, then re-reads and proceeds", async () => {
    const { io, driver, session, release } = build({
      facts: { requiresApply: true, requiresFilters: false },
      scopeSequence: ["MISMATCH", "MATCH"],
    });
    startRun(io);
    await session.whenSettled();
    // The gate DID stop the run — the watcher just cleared it before the drive chain unwound, which is the
    // whole point. A park is proven by the blocker it announced, not by still being in it.
    expect(blockersAnnounced(io)).toContain("SCOPE_MISMATCH");

    await until(() => io.lastView()?.blocker === undefined, "the scope park to clear by itself");
    // It did not simply poll the date inputs: it re-located and watched the apply control the seller presses,
    // because a value typed into a date field is not a range the grid is showing.
    const firstScopeRead = driver.calls.findIndex((c) => c.startsWith("scope:"));
    const watched = driver.calls.lastIndexOf("observe:apply_range");
    expect(firstScopeRead).toBeGreaterThan(-1);
    expect(watched).toBeGreaterThan(firstScopeRead);
    expect(driver.calls.lastIndexOf("locate:apply_range")).toBeGreaterThan(firstScopeRead);
    expect(sellerRechecks(io)).toBe(0);
    release();
  });

  it("falls back to looking again on a timer when the surface has no apply control", async () => {
    const { io, session, driver, release } = build({
      facts: { requiresApply: false, requiresFilters: false },
      scopeSequence: ["MISMATCH", "MATCH"],
    });
    startRun(io);
    await session.whenSettled();
    expect(blockersAnnounced(io)).toContain("SCOPE_MISMATCH");
    await until(() => io.lastView()?.blocker === undefined, "the scope park to clear on the timer");
    // Nothing was observed on an apply control that does not exist here.
    expect(driver.calls).not.toContain("observe:apply_range");
    release();
  });
});

describe("an export tie is the seller's to break", () => {
  it("rings every candidate and rests on the ordinary barrier instead of failing", async () => {
    const { io, driver, session, release } = build({
      locate: { export: { count: 2 } },
      candidates: { export: 2 },
      // Rest at the export barrier so the run is still there to inspect.
      action: { export: false },
    });
    startRun(io);
    await session.whenSettled();
    const view = io.lastView();
    expect(view?.status).toBe("WAITING_FOR_HUMAN");
    expect(view?.blocker).toBeUndefined();
    expect(driver.calls).toContain("highlightAll:export");
    expect(driver.calls).toContain("observe:export");
    release();
  });

  it("still fails closed when nothing could be rung", async () => {
    const { io, session, release } = build({ locate: { export: { count: 2 } }, candidates: { export: 0 } });
    startRun(io);
    await session.whenSettled();
    expect(io.lastView()?.blocker).toEqual({ code: "TARGET_NOT_FOUND", recoverable: false });
    release();
  });

  it("keeps a DATE tie fatal — a control that is READ must be the right one", async () => {
    const { io, session, release } = build({ locate: { start_date: { count: 2 } } });
    startRun(io);
    await session.whenSettled();
    expect(io.lastView()?.blocker).toEqual({ code: "TARGET_AMBIGUOUS", recoverable: false });
    release();
  });
});
