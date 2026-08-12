/**
 * **Where the step-⑥ advance broke, separated into four facts that can each be measured.**
 *
 * On the 2026-08-12 live walk the guided walk sat at step ⑥ (`vendor_method`) with a live-looking panel. The
 * seller pressed `선택했어요 · 다음` repeatedly; the disclosure toggle beside it worked every time, which proves
 * the page was alive and the click reached the panel. The walk never advanced, and the log said NOTHING at all —
 * a step that watches only a button probes no screen, so it had never had anything to say.
 *
 * Four things have to be separable, because they need four different fixes:
 *
 *   1. did the click handler run?          → an in-page press COUNT, kept beside the latch
 *   2. did the latch write land?           → `latched` against this step's own token
 *   3. did the watcher ever start?         → `aw_coupang_observe_start`, and a watchdog when it does not
 *   4. is the poll still alive?            → a heartbeat carrying (1) and (2)
 *
 * The mechanism this file pins is the one that fits every observation: the session `await`s `armObserve` and
 * only THEN starts the barrier watcher, so an in-page write that never settles inside the arm means the watcher
 * is never started at all. The panel stays up, the seller's presses are faithfully recorded into the page, and
 * nothing ever reads them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoupangWingIssuanceDriver } from "../../../src/action-window/coupang-wing-issuance-driver";
import { clearLogSink, getLogSink } from "../../../src/log";

/** Never settles — the shape of an `evaluate` against a page this run has lost. */
const NEVER = new Promise<never>(() => undefined);

interface PageBehaviour {
  /** The in-page latch re-arm (`resetOverlayAdvance`) hangs instead of resolving. */
  hangOnRearm?: boolean;
  /** Every latch READ hangs — the page is alive in the browser and unreadable to this run. */
  hangOnLatchRead?: boolean;
  /** The seller has pressed the panel's advance button. */
  pressed?: boolean;
  /** How many times they have pressed it (the in-page counter, which a re-arm never clears). */
  presses?: number;
}

/**
 * A fake page that can be unreadable WITHOUT being dead — the state the live walk was in. It distinguishes the
 * driver's in-page calls by argument shape, exactly as the real ones differ: a string script (locate/clear), a
 * function with a token argument (latch read/re-arm/diagnostics), and an argument-less function (`overlayMounted`
 * and the unmount).
 */
class FakePage {
  /** Every `unmountOverlay` this page has taken — how a test sees the panel come down. */
  unmounts = 0;
  constructor(private readonly behave: PageBehaviour) {}
  url(): string {
    return "https://wing.coupang.com/vendor/open-api";
  }
  on(): void {
    /* close handler — never fires here */
  }
  async evaluate(script: unknown, arg?: unknown): Promise<unknown> {
    if (typeof script === "string") return { count: 1, sig: "abcdef0123456789" };
    const body = String(script);
    // The unmount is the one argument-less call that TOUCHES the panel; `overlayMounted` only reads it.
    if (arg === undefined) {
      if (body.includes("__aw_overlay_untrack__")) {
        this.unmounts += 1;
        return undefined;
      }
      return true;
    }
    // `resetOverlayAdvance` WRITES the token; the reads only compare it.
    const isRearm = body.includes("__aw_advance_token__") && body.includes("=");
    if (isRearm && !body.includes("===")) {
      if (this.behave.hangOnRearm) return NEVER;
      return undefined;
    }
    if (this.behave.hangOnLatchRead) return NEVER;
    if (body.includes("__aw_advance_press_count__")) {
      return {
        presses: this.behave.presses ?? 0,
        latched: this.behave.pressed === true,
        tokenArmed: true,
        panelMounted: true,
      };
    }
    return this.behave.pressed === true;
  }
}

function driverWith(behave: PageBehaviour, observeTimeoutMs = 60_000): { driver: CoupangWingIssuanceDriver; page: FakePage } {
  const page = new FakePage(behave);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { driver: new CoupangWingIssuanceDriver(page as any, { observeTimeoutMs }), page };
}

const events = (): string[] => getLogSink().map((l) => l.event);

afterEach(() => {
  vi.useRealTimers();
  clearLogSink();
});

describe("1 — the arm cannot swallow the watcher", () => {
  it("**an arm whose in-page write never settles still returns**, and says it could not re-arm", async () => {
    vi.useFakeTimers();
    clearLogSink();
    const { driver } = driverWith({ hangOnRearm: true });
    const armed = driver.armObserve("vendor_method");
    await vi.advanceTimersByTimeAsync(5_000);
    await armed;
    // The session `await`s this before it starts the barrier watcher. Hanging here is not a slow walk — it is a
    // walk with no reader, which is indistinguishable from a seller who has not pressed anything.
    const line = getLogSink().find((l) => l.event === "aw_coupang_step_armed");
    expect(line?.meta).toMatchObject({ target: "vendor_method", rearmed: false });
  });

  it("reports a clean re-arm as clean — the flag is a measurement, not a formality", async () => {
    clearLogSink();
    const { driver } = driverWith({});
    await driver.armObserve("vendor_method");
    expect(getLogSink().find((l) => l.event === "aw_coupang_step_armed")?.meta).toMatchObject({ rearmed: true });
  });
});

describe("2 — a watchdog on the watcher itself", () => {
  it("**fires when an armed step is never observed, and takes the panel down**", async () => {
    vi.useFakeTimers();
    clearLogSink();
    const { driver, page } = driverWith({});
    await driver.armObserve("vendor_method");
    expect(events()).not.toContain("aw_coupang_observe_never_started");
    await vi.advanceTimersByTimeAsync(25_000);
    expect(events()).toContain("aw_coupang_observe_never_started");
    // Fail closed. A panel nobody is driving must stop presenting itself as guidance — the seller pressed the
    // dead one for twenty minutes because it looked exactly like a live one.
    expect(page.unmounts).toBeGreaterThan(0);
  });

  it("does NOT fire once the watcher starts — the observe loop cancels it on entry", async () => {
    vi.useFakeTimers();
    clearLogSink();
    const { driver, page } = driverWith({ pressed: true });
    await driver.armObserve("vendor_method");
    await driver.observeUserAction("vendor_method");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events()).toContain("aw_coupang_observe_start");
    expect(events()).not.toContain("aw_coupang_observe_never_started");
    expect(page.unmounts).toBe(0);
  });
});

describe("3 — the heartbeat, and telling a press from a silence", () => {
  it("**carries the press count and the latch state**, so 'they pressed and it was eaten' is visible", async () => {
    vi.useFakeTimers();
    clearLogSink();
    const { driver } = driverWith({ presses: 2, pressed: false });
    const observing = driver.observeUserAction("vendor_method");
    await vi.advanceTimersByTimeAsync(1_000);
    const beat = getLogSink().find((l) => l.event === "aw_coupang_observe_heartbeat");
    // `presses: 2, latched: false` is the fingerprint of a press that reached the handler and was then cleared
    // by a re-arm — a completely different fault from "the seller never pressed", and previously invisible.
    expect(beat?.meta).toMatchObject({ target: "vendor_method", presses: 2, latched: false, panelMounted: true });
    await vi.advanceTimersByTimeAsync(70_000);
    await observing;
  });
});

describe("4 — an unreadable page is not a patient one", () => {
  it("**gives up after consecutive unanswered reads, says so, and clears the panel**", async () => {
    vi.useFakeTimers();
    clearLogSink();
    const { driver, page } = driverWith({ hangOnLatchRead: true });
    const observing = driver.observeUserAction("vendor_method");
    // Three bounded reads that answer nothing at all. Before this, each one resolved to a confident "not
    // pressed" and the loop polled a page it had lost until the whole observe window ran out.
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(observing).resolves.toBe(false);
    expect(events()).toContain("aw_coupang_observe_unreadable");
    expect(page.unmounts).toBeGreaterThan(0);
  });

  it("a page that ANSWERS 'not pressed' is left alone — patience is correct there", async () => {
    vi.useFakeTimers();
    clearLogSink();
    const { driver, page } = driverWith({ pressed: false });
    const observing = driver.observeUserAction("vendor_method");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(events()).not.toContain("aw_coupang_observe_unreadable");
    expect(page.unmounts).toBe(0);
    await vi.advanceTimersByTimeAsync(40_000);
    await expect(observing).resolves.toBe(false);
  });
});
