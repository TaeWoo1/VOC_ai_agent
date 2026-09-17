/**
 * **The loopback recipe can only ever be pointed at this machine.**
 *
 * `aside-guard.test.ts` already proves no file under `src/aside/` names a forbidden capability. This adds the
 * property that matters specifically for a run with nobody watching: the target. Every assertion here is about
 * what the recipe REFUSES, because a scheduled browser job is safe exactly to the degree that its possible
 * targets are a closed set.
 *
 * <p><b>Scope note, written when it stopped being true of the lane.</b> This file used to say «a marketplace is
 * not a possible target», meaning the unattended lane as a whole. That claim now belongs to THIS recipe only:
 * `COUPANG_REVIEW_OBSERVE_V1` exists and reads a real store. The property was not weakened, it was made
 * per-recipe — each name resolves to its own bound route and is screened by its own screen, and neither screen
 * admits the other's target. `coupang-observe-guard.test.ts` states the marketplace recipe's half; the
 * assertions below are unchanged, and they are what stops THIS recipe from ever leaving the box.
 */
import { describe, expect, it } from "vitest";
import {
  buildFixtureObservePlan,
  buildFixtureObserveProgram,
  parseFixtureObserveResult,
} from "../../src/aside/fixture-observe-executor";
import {
  FIXTURE_OBSERVE_RECIPE_ID,
  fixtureObserveWorkflow,
  screenLoopbackUrl,
  validateFixtureObserveWorkflow,
  type FixtureObserveWorkflow,
} from "../../src/aside/fixture-observe-workflow";

const OK = fixtureObserveWorkflow(47615);

describe("the unattended recipe — v1 is exactly one recipe", () => {
  it("accepts its own loopback surface", () => {
    expect(validateFixtureObserveWorkflow(OK)).toEqual([]);
    expect(OK.id).toBe(FIXTURE_OBSERVE_RECIPE_ID);
  });

  it("refuses a recipe id it does not publish", () => {
    const other = { ...OK, id: "SOME_OTHER_RECIPE" } as unknown as FixtureObserveWorkflow;
    expect(validateFixtureObserveWorkflow(other)).toContain("RECIPE_UNKNOWN");
  });
});

describe("the unattended recipe — a marketplace is not a possible target", () => {
  const marketplaces = [
    "https://wing.coupang.com/tenants/cs/product/review",
    "https://smartstore.naver.com/mystore",
    "https://sell.smartstore.naver.com/#/home/dashboard",
    "https://eclogin.cafe24.com/Shop/",
    "https://example.cafe24.com/admin",
  ];

  it.each(marketplaces)("refuses %s", (url) => {
    expect(screenLoopbackUrl(url)).toBe("OFF_BOX");
    expect(validateFixtureObserveWorkflow({ ...OK, entryUrl: url })).toContain("ENTRY_NOT_LOOPBACK");
  });

  it("refuses a host that merely looks like loopback", () => {
    // The string tests that would pass these are exactly why the screen parses instead of matching.
    expect(screenLoopbackUrl("http://127.0.0.1.evil.example/x")).toBe("OFF_BOX");
    expect(screenLoopbackUrl("http://127.0.0.1@evil.example/x")).toBe("MALFORMED");
    expect(screenLoopbackUrl("http://evil.example/?h=127.0.0.1")).toBe("OFF_BOX");
  });

  it("refuses a scheme that is not the web", () => {
    for (const url of ["file:///etc/passwd", "data:text/html,<p>x", "javascript:alert(1)", "not a url"]) {
      expect(screenLoopbackUrl(url)).toBe("MALFORMED");
      expect(validateFixtureObserveWorkflow({ ...OK, entryUrl: url })).toContain("ENTRY_URL_INVALID");
    }
  });

  it("bounds how long an unattended run may sit on a page", () => {
    expect(validateFixtureObserveWorkflow({ ...OK, settleTimeoutMs: 0 })).toContain("TIMEOUT_INVALID");
    expect(validateFixtureObserveWorkflow({ ...OK, settleTimeoutMs: 10 * 60_000 })).toContain("TIMEOUT_INVALID");
  });
});

describe("the unattended recipe — the serialized program carries nothing of ours", () => {
  const program = buildFixtureObserveProgram(buildFixtureObservePlan(OK));

  it("prints exactly one result line and opens exactly the planned url", () => {
    expect(program.split("ASIDE_RESULT").length - 1).toBe(1);
    expect(program).toContain(OK.entryUrl);
  });

  it("names no forbidden capability token", () => {
    for (const token of [
      "captcha", "password", "cua.", "chrome.", "fs.", "require(", "process.", ".evaluate(",
      "addInitScript", "cookies(", "storageState", "localStorage", "sessionStorage", "keyboard",
      "dispatchEvent", ".goto(", ".press(", ".fill(", ".click(",
    ]) {
      expect(program, `program contains ${token}`).not.toContain(token);
    }
  });
});

describe("the unattended recipe — an unreadable answer is never an empty surface", () => {
  it("reads a well-formed observation", () => {
    const parsed = parseFixtureObserveResult({ ok: true, items: [{ ref: "a", state: "NEW" }], elapsedMs: 5 });
    expect(parsed).toEqual({ ok: true, items: [{ ref: "a", state: "NEW" }], elapsedMs: 5 });
  });

  it("an empty surface is a real observation with zero items", () => {
    expect(parseFixtureObserveResult({ ok: true, items: [], elapsedMs: 1 })).toEqual({
      ok: true, items: [], elapsedMs: 1,
    });
  });

  it("refuses every shape that would otherwise land as «observed, nothing there»", () => {
    for (const raw of [
      null,
      "ok",
      {},
      { ok: true },
      { ok: true, items: "none" },
      { ok: true, items: [{ ref: "a" }] },
      { ok: true, items: [{ ref: "", state: "NEW" }] },
      { ok: true, items: [{ ref: "a".repeat(65), state: "NEW" }] },
      { ok: false },
      { ok: false, code: "NOPE", stage: "READ" },
      { ok: false, code: "RUNTIME_FAULT", stage: "SOMEWHERE" },
    ]) {
      expect(parseFixtureObserveResult(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});
