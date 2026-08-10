/**
 * Source guard for the LIVE `CoupangWingIssuanceDriver` (and its gated CLI).
 *
 * The driver lives OUTSIDE `coupang-issuance/` precisely because it legitimately runs `.evaluate` for the census
 * / overlay / read-only tagging — so the pure `coupang-issuance/` strict guard stays intact and is NOT touched.
 * This guard mirrors the NAVER issuance-driver boundary: it ALLOWS `.evaluate(` / `setAttribute`, but still
 * forbids EVERY click/type/submit/issue and EVERY field-VALUE read (incl. the Access Key / Secret Key / 업체코드).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { WING_HIGHLIGHT_CALIBRATION, CoupangWingIssuanceDriver } from "../../../src/action-window/coupang-wing-issuance-driver";
import { COUPANG_ISSUANCE_TARGETS } from "../../../src/action-window/coupang-issuance/coupang-issuance-driver";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = resolve(HERE, "../../../src/action-window/coupang-wing-issuance-driver.ts");
const CLI = resolve(HERE, "../../../src/cli/run-coupang-wing-issuance-live.ts");

/** Strip block comments and comment/JSDoc lines so prose mentioning a forbidden token never trips. */
function codeOnly(path: string): string {
  const raw = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return raw
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");
}

/** No way to act on a WING control — the SELLER clicks (incl. pressing 발급); the driver observes + annotates. */
const NO_ACTION_TOKENS = [
  ".click(",
  ".dblclick(",
  ".tap(",
  ".hover(",
  ".type(",
  ".fill(",
  ".press(",
  ".check(",
  ".uncheck(",
  ".selectOption(",
  ".setInputFiles(",
  ".keyboard",
  "dispatchEvent",
  ".submit(",
  'waitForEvent("download"',
  "waitForEvent('download'",
] as const;

/** No way to read a field value, text, clipboard, or screenshot — the credential is never read. */
const NO_VALUE_READ_TOKENS = [
  ".inputValue(",
  ".value", // a bare read (`node.value`) OR a write (`x.value =`) — both forbidden.
  ".textContent",
  ".innerText",
  ".innerHTML",
  ".outerHTML",
  ".getAttribute(",
  ".getProperty(",
  ".getProperties(",
  "page.content(",
  "clipboard",
  "readText(",
  ".screenshot(",
] as const;

/** No way to navigate the seller's own dedicated window. */
const NO_NAV_TOKENS = [".goBack(", ".goForward(", ".reload(", "waitForNavigation", "window.open"] as const;

describe("CoupangWingIssuanceDriver — source guard (no click/type/submit/issue, no value read)", () => {
  const code = codeOnly(DRIVER);

  it.each(NO_ACTION_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_VALUE_READ_TOKENS)("never reads a field value / clipboard / screenshot (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_NAV_TOKENS)("never navigates the seller's window (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it("never navigates at all — it reads wherever the seller went (no .goto)", () => {
    expect(code).not.toContain(".goto(");
  });

  it("ALLOWS the observation/annotation primitives it legitimately needs (evaluate + overlay)", () => {
    expect(code).toContain("evaluate");
    expect(code).toContain("mountOverlay");
  });

  it("locates by the VALUE-FREE fixed-label locate script (never a text/attribute read in the driver itself)", () => {
    // The driver delegates location to the audited `buildFixedLabelLocateScript` (guarded separately for
    // value-free OUTPUT). The driver source itself contains NO text/attribute read.
    expect(code).toContain("buildFixedLabelLocateScript");
    expect(code).not.toContain("el.childElementCount");
    expect(code).not.toContain("IN_PAGE_SIG_FACTORY");
  });

  it("treats reach_open_api and return as guidance-only — fixed synthetic signatures, never queried controls", () => {
    expect(code).toContain("REACH_OPEN_API_GUIDANCE_SIG");
    expect(code).toContain("RETURN_GUIDANCE_SIG");
  });

  it("keeps its ISSUANCE fixed-label candidates LIVE_DOM_CALIBRATION_PENDING (the 삭제 landing did not widen)", () => {
    // The module now ALSO declares the live-confirmed delete calibration, so a bare token grep would pass on the
    // wrong constant. Assert the issuance marker's actual value: only the 삭제 target was live-calibrated, and
    // this flag must not drift along with it.
    expect(WING_HIGHLIGHT_CALIBRATION).toBe("LIVE_DOM_CALIBRATION_PENDING");
    expect(code).toContain("export const WING_HIGHLIGHT_CALIBRATION = LIVE_DOM_CALIBRATION_PENDING;");
  });
});

describe("run-coupang-wing-issuance-live CLI — source guard (gated, no click/type/submit, no value read)", () => {
  const code = codeOnly(CLI);

  it.each(NO_ACTION_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_VALUE_READ_TOKENS)("never reads a field value / clipboard / screenshot (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_NAV_TOKENS)("never re-navigates the seller's window (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it("**navigates ZERO times** — the seller reaches WING themselves", () => {
    // It used to `page.goto(url)` exactly once, and this guard pinned that at one. On the product path the
    // seller reaches WING; an agent that drives the page there has taken a marketplace action nobody granted,
    // and every read-only WING entrypoint already holds that line ("this recorder never `.goto`s").
    const codeOnly = code.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(codeOnly.split(".goto(").length - 1).toBe(0);
    expect(code).toContain("COUPANG_WING_GUIDED_WALK_AGENT_NAVIGATIONS = 0");
  });

  it("is gated on the explicit Coupang WING live-run approval flag and fails closed on a bad URL before launch", () => {
    expect(code).toContain("hasCoupangWingRunApproval");
    // A NAVER grant must never open WING — the CLI must not reach for the shared NAVER-only gate.
    expect(code).not.toContain("hasLiveRunApproval");
    expect(code).toContain("screenWingUrl");
    // main() runs only when invoked directly — inert on import.
    expect(code).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
    // Reads the operator-owned WING URL env, never a NAVER one.
    expect(code).toContain("COUPANG_WING_URL");
  });
});

/* ══════════════════════════ every guided step must be reachable ══════════════════════════ */

/** The minimum a `Page` must be for the driver's constructor: it subscribes to `close`. */
function fakePage(): { url: () => string; on: () => void } {
  return { url: () => "https://wing.coupang.com", on: () => undefined };
}

describe("the redesigned walk can actually be walked", () => {
  it("**every tutorial target resolves — none returns the count that parks the run**", async () => {
    // The defect this closes shipped in the 2026-08-10 redesign: four of the eight steps had no promoted
    // locator, `locateTarget` returned `{ count: 0 }` for each, and the engine reads that as NONE and parks
    // `target_not_found` — permanently, since a re-check re-locates and finds nothing again. The walk could not
    // get past step 3, and no test saw it because the session and engine suites drive a FIXTURE driver that
    // answers `count: 1` for every target. The fixture stood one layer away from the thing it modelled.
    //
    // This asserts against the REAL driver, and it needs no page: every non-highlight target short-circuits
    // before touching one.
    // A structurally complete stub: the constructor subscribes to the page's `close` event, so a bare object
    // throws `page.on is not a function` — which vitest reports as an unhandled error while still counting the
    // test as passed, so a local run looks green and CI does not.
    const driver = new CoupangWingIssuanceDriver(fakePage() as never);
    for (const target of COUPANG_ISSUANCE_TARGETS) {
      if (target === "issue" || target === "credentials") continue; // these query the page; covered elsewhere
      const res = await driver.locateTarget(target);
      expect(res.count, `${target} would park the run at target_not_found`).toBe(1);
      expect(res.sig, target).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("the text-guided steps are exactly the MEASURED-but-unpromoted ones, and their sigs are distinct", async () => {
    // A step gets text guidance because nothing was promoted for it — not because promoting was inconvenient.
    // If one of these ever gains a calibrated locator, it leaves this list and gains a spotlight.
    // A structurally complete stub: the constructor subscribes to the page's `close` event, so a bare object
    // throws `page.on is not a function` — which vitest reports as an unhandled error while still counting the
    // test as passed, so a local run looks green and CI does not.
    const driver = new CoupangWingIssuanceDriver(fakePage() as never);
    const sigs = new Map<string, string>();
    for (const target of ["reach_open_api", "confirm_purpose", "terms_consent", "issue_final", "return"] as const) {
      const res = await driver.locateTarget(target);
      sigs.set(target, res.sig!);
    }
    // Distinct: a shared signature would let one step's overlay be mistaken for another's in the record.
    expect(new Set(sigs.values()).size).toBe(sigs.size);
  });

  it("a text-guided step is never given a SPOTLIGHT — there is no promoted locator to point at", () => {
    // Drawing a ring somewhere plausible is the invention this workstream refuses. The highlight path for these
    // targets mounts the guidance overlay and returns; it never reaches `resolveFixedLabelTarget`.
    const src = readFileSync(resolve(HERE, "../../../src/action-window/coupang-wing-issuance-driver.ts"), "utf8");
    const from = src.indexOf("  async highlightTarget(");
    const body = src.slice(from, src.indexOf("\n  /**", from));
    const guardIdx = body.indexOf("const guided = TEXT_GUIDED_SIG[target];");
    const resolveIdx = body.indexOf("this.resolveFixedLabelTarget(target, true)");
    expect(guardIdx).toBeGreaterThan(-1);
    // The text-guided branch must come FIRST, or a resolve runs before it and can tag a wrong element.
    expect(resolveIdx).toBeGreaterThan(guardIdx);
  });
});
