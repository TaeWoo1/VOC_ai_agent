/**
 * **One invariant, all five resident carriers: a window the SELLER closed is never re-opened by the runtime.**
 *
 * This is a SOURCE-level test, and it is that way because the defect it guards is a defect of OMISSION. Every
 * driver call goes through a lazy wrapper that brings a window up on ANY call, so a single unguarded
 * `this.driver.…` after a close puts the window back — and because the landing runs once per carrier, the
 * window that comes back is BLANK. A behavioural test proves the paths it happens to drive; it cannot prove
 * that the seventeenth call site, added next month, is guarded too.
 *
 * The same omission was found FOUR times in five sessions on 2026-08-20:
 *
 *  - `coupang-issuance` — a park-recovery loop that had started before the close kept ticking after it
 *    (live: `aw_coupang_walk_surface_closed` 06:48:49.756 → `landing_skipped ALREADY_NAVIGATED_ONCE` 06:48:50.014);
 *  - `api-issuance` (NAVER) and `coupang-renewal` — no latch at all; the close handler drove `CLEAR_HIGHLIGHT`
 *    straight back into the driver;
 *  - `initial-import` — the close handler called `clearTargetHighlight()` on a page that no longer existed.
 *
 * Only `coupang-review` had it right, which is why its shape is the one asserted here.
 *
 * What each session must have:
 *  1. a `surfaceClosed` latch, SET inside the close handler;
 *  2. that latch cleared in exactly one place — an accepted seller command — so re-opening stays the seller's;
 *  3. a guard on the latch at the top of the method every effect flows through, before any driver call.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

/** The five carriers the resident helper hosts, and the session that owns each one's marketplace window. */
const CARRIER_SESSIONS: ReadonlyArray<{ carrier: string; file: string }> = [
  { carrier: "issuance/coupang", file: "src/action-window/coupang-issuance/coupang-issuance-session.ts" },
  { carrier: "issuance/naver", file: "src/action-window/api-issuance/issuance-session.ts" },
  { carrier: "renewal/coupang", file: "src/action-window/coupang-renewal/coupang-renewal-session.ts" },
  { carrier: "locate/coupang", file: "src/action-window/coupang-review/review-locate-session.ts" },
  { carrier: "import/naver", file: "src/action-window/initial-import/import-session.ts" },
];

function source(file: string): string {
  return readFileSync(resolve(ROOT, file), "utf8");
}

/** Strip line and block comments so a rule is never satisfied by prose that merely mentions it. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("every resident carrier latches a closed marketplace surface", () => {
  it.each(CARRIER_SESSIONS)("$carrier declares a surfaceClosed latch", ({ file }) => {
    expect(code(source(file))).toContain("private surfaceClosed = false;");
  });

  it.each(CARRIER_SESSIONS)("$carrier SETS the latch inside its close handler", ({ carrier, file }) => {
    const body = code(source(file));
    const at = body.indexOf("onSurfaceClosed(token: number)");
    expect(at, `${carrier}: no onSurfaceClosed(token) handler`).toBeGreaterThan(-1);
    // The latch must be set inside the handler, and BEFORE the engine transition it drives — a latch set after
    // the park is a latch the park's own effect chain has already run past.
    const handler = body.slice(at, at + 1200);
    expect(handler, `${carrier}: close handler does not latch surfaceClosed`).toContain("this.surfaceClosed = true;");
  });

  it.each(CARRIER_SESSIONS)("$carrier clears the latch ONLY on an accepted seller command", ({ carrier, file }) => {
    const body = code(source(file));
    const clears = body.match(/this\.surfaceClosed = false;/g) ?? [];
    // Exactly one place, or "the seller asked for it" stops being what re-opening means.
    expect(clears.length, `${carrier}: expected exactly one clear of the latch, found ${clears.length}`).toBe(1);
    const at = body.indexOf("this.surfaceClosed = false;");
    const before = body.slice(Math.max(0, at - 400), at);
    expect(before, `${carrier}: the latch is cleared somewhere other than an accepted command`).toContain(
      "this.engine.command(",
    );
  });
});

describe("no driver call survives a closed surface — the guard sits where every effect flows through", () => {
  /**
   * `coupang-review` reaches the driver from its retry loop rather than from a shared `drive`, so its guard
   * lives in that loop. The rule is the same either way: the latch is checked before the first driver call on
   * every path a timer can take.
   */
  const GUARDED_ENTRY: Record<string, string> = {
    "issuance/coupang": "private async drive(",
    "issuance/naver": "private async drive(",
    "renewal/coupang": "private async drive(",
    "locate/coupang": "private async retryLoop(",
    "import/naver": "private async drive(",
  };

  it.each(CARRIER_SESSIONS)("$carrier guards on the latch before touching the driver", ({ carrier, file }) => {
    const body = code(source(file));
    const entry = GUARDED_ENTRY[carrier]!;
    const at = body.indexOf(entry);
    expect(at, `${carrier}: could not find ${entry}`).toBeGreaterThan(-1);
    const head = body.slice(at, at + 900);
    const guardAt = head.indexOf("if (this.surfaceClosed) return");
    expect(guardAt, `${carrier}: ${entry} does not guard on surfaceClosed`).toBeGreaterThan(-1);
    const firstDriverCall = head.indexOf("this.driver.");
    if (firstDriverCall > -1) {
      // The guard must come FIRST. A guard after the first call is a guard that has already lost.
      expect(guardAt, `${carrier}: the surfaceClosed guard sits after a driver call`).toBeLessThan(firstDriverCall);
    }
  });

  it("**the handoff outcome loop is guarded the same way** — a walk that ENDED cannot re-open a window either", () => {
    // The credential handoff paints its result on the marketplace window and then waits for one press. Both are
    // driver calls, on a run that is finishing, on paths no earlier guard covers: `showHandoffPanel` is reached
    // from the command handler rather than from `drive`, and `watchHandoffReturn` is a timer that outlives the
    // run. Either one could have brought a closed window back — the last place in this walk where that was
    // still possible.
    const body = code(source("src/action-window/coupang-issuance/coupang-issuance-session.ts"));
    for (const fn of ["private async showHandoffPanel(", "private watchHandoffReturn("]) {
      const at = body.indexOf(fn);
      expect(at, `no ${fn}`).toBeGreaterThan(-1);
      const head = body.slice(at, body.indexOf("\n  }", at));
      expect(head, `${fn} does not check the latch`).toMatch(/if \(this\.stopped \|\| this\.surfaceClosed\) return/);
      const guardAt = head.search(/if \(this\.stopped \|\| this\.surfaceClosed\) return/);
      const firstDriverCall = head.indexOf("this.driver.");
      if (firstDriverCall > -1) expect(guardAt, `${fn}: the guard sits after a driver call`).toBeLessThan(firstDriverCall);
    }
    // …and the wait re-checks on every tick, for the same reason the park recovery does: a loop that started
    // before the close must END on it, not merely fail to start again.
    const at = body.indexOf("private watchHandoffReturn(");
    const loopBody = body.slice(body.indexOf("for (", at), body.indexOf("\n  }", at));
    expect(loopBody, "watchHandoffReturn does not re-check surfaceClosed inside the loop").toContain(
      "if (this.stopped || this.surfaceClosed) return;",
    );
  });

  it("**the NAVER walk's new panel paths are guarded too** — a panel is never a reason to open a window", () => {
    // The guided panel moved onto the API-centre window, which gave this session four new driver paths: the
    // step advance watch, the step-3 advisory, the park notice and the completion notice. Each is reached from
    // somewhere `drive`'s guard does not cover — a timer, or the end of a chain — and each would have been a
    // way for a finished or parked run to bring back a window the seller had closed.
    const body = code(source("src/action-window/api-issuance/issuance-session.ts"));
    for (const fn of [
      "private watchPanelAdvance(",
      "private watchAppUsageCheck(",
      "private showParkNoticeIfParked(",
      "private async showCompletionNotice(",
    ]) {
      const at = body.indexOf(fn);
      expect(at, `no ${fn}`).toBeGreaterThan(-1);
      const head = body.slice(at, body.indexOf("\n  }", at));
      expect(head, `${fn} does not check the latch`).toMatch(/if \(this\.stopped \|\| this\.surfaceClosed\) return/);
      const guardAt = head.search(/if \(this\.stopped \|\| this\.surfaceClosed\) return/);
      const firstDriverCall = head.indexOf("this.driver.");
      if (firstDriverCall > -1) expect(guardAt, `${fn}: the guard sits after a driver call`).toBeLessThan(firstDriverCall);
    }
    // …and both waits re-check on every tick: a loop that started before the close must END on it.
    for (const fn of ["private watchPanelAdvance(", "private watchAppUsageCheck("]) {
      const at = body.indexOf(fn);
      const loopBody = body.slice(body.indexOf("for (", at), body.indexOf("\n  }", at));
      expect(loopBody, `${fn} does not re-check surfaceClosed inside the loop`).toContain(
        "if (this.stopped || this.surfaceClosed) return;",
      );
    }
  });

  it("the park-recovery loops check the latch on EVERY tick, not only at entry", () => {
    // The 2026-08-20 defect exactly: `maybeRecoverPark` guarded before STARTING a loop, so a loop already
    // running when the seller closed the window kept driving — one blank window per tick.
    for (const [file, loop] of [
      ["src/action-window/coupang-issuance/coupang-issuance-session.ts", "private async recoverPark("],
      ["src/action-window/coupang-review/review-locate-session.ts", "private async retryLoop("],
    ] as const) {
      const body = code(source(file));
      const at = body.indexOf(loop);
      expect(at, `${file}: no ${loop}`).toBeGreaterThan(-1);
      const forAt = body.indexOf("for (", at);
      const loopBody = body.slice(forAt, body.indexOf("\n  }", forAt));
      expect(loopBody, `${file}: ${loop} does not re-check surfaceClosed inside the loop`).toContain(
        "if (this.surfaceClosed) return;",
      );
    }
  });
});
