/**
 * Source guard for the DESTRUCTIVE `CoupangWingDeletionDriver` and its gated CLI `run-coupang-wing-deletion-live`.
 *
 * The AGENT never deletes: the SELLER presses 삭제 themselves. The guard ALLOWS `.evaluate` / `mountOverlay`
 * (highlight + census) but forbids EVERY click/type/submit/delete and EVERY field-VALUE read, and — for the CLI —
 * proves it is gated, inert on import, never navigates the seller's window, and fails closed through the approval
 * gate + the delete-selector calibration flag.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  WING_DELETION_CALIBRATION_EVIDENCE,
  WING_DELETION_LABELS,
} from "../../../src/action-window/coupang-wing-issuance-driver";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = resolve(HERE, "../../../src/action-window/coupang-wing-deletion-driver.ts");
const CLI = resolve(HERE, "../../../src/cli/run-coupang-wing-deletion-live.ts");
const LABELS_MODULE = resolve(HERE, "../../../src/action-window/coupang-wing-issuance-driver.ts");

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

const NO_VALUE_READ_TOKENS = [
  ".inputValue(",
  ".value",
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

const NO_NAV_TOKENS = [".goto(", ".goBack(", ".goForward(", ".reload(", "waitForNavigation", "window.open"] as const;

describe("CoupangWingDeletionDriver — source guard (no click/type/submit/delete, no value read)", () => {
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

  it("ALLOWS the observation/annotation primitives it legitimately needs (evaluate + overlay)", () => {
    expect(code).toContain("evaluate");
    expect(code).toContain("mountOverlay");
  });

  it("locates by the VALUE-FREE fixed-label locate script and reads no field value itself", () => {
    expect(code).toContain("buildFixedLabelLocateScript");
  });

  it("is fail-closed on calibration — refuses to highlight while the delete selector is not calibrated", () => {
    expect(code).toContain("WING_DELETION_SELECTORS_CALIBRATED");
  });
});

describe("run-coupang-wing-deletion-live CLI — source guard (gated, fail-closed, no click/type/value)", () => {
  const code = codeOnly(CLI);

  it.each(NO_ACTION_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_VALUE_READ_TOKENS)("never reads a field value / clipboard / screenshot (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_NAV_TOKENS)("never navigates the seller's window (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it("never navigates at all — the seller reaches the already-issued page themselves (no .goto)", () => {
    expect(code).not.toContain(".goto(");
  });

  it("is gated on the Coupang WING flag (a NAVER grant never opens WING) and fails closed on a bad URL before launch", () => {
    expect(code).toContain("hasCoupangWingRunApproval");
    expect(code).not.toContain("hasLiveRunApproval");
    expect(code).toContain("screenWingUrl");
    expect(code).toContain("COUPANG_WING_URL");
  });

  it("fails closed through the approval gate + the delete-selector calibration flag", () => {
    expect(code).toContain("validateApprovalPrerequisites");
    expect(code).toContain("COUPANG_WING_KEY_DELETION_DESTRUCTIVE_ACTION");
    expect(code).toContain("WING_DELETION_SELECTORS_CALIBRATED");
  });

  it("main() runs only when invoked directly — inert on import", () => {
    expect(code).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
  });
});

/**
 * The calibration landing's own guards. The 삭제 selector is now live-confirmed, which makes the destructive path
 * EXECUTABLE — so these lock the two things that could quietly make the flip dishonest: retuning the selector the
 * evidence was measured against, and promoting the recorded `sig16` into a runtime anchor that one capture cannot
 * support.
 */
describe("삭제 calibration landing — the flip cannot outrun its evidence", () => {
  it("the calibrated locator spec is EXACTLY the one the live probe measured", () => {
    // The uniqueness evidence (matchCount=1) was measured against this spec and no other. Narrowing
    // `candidateQuery` to the observed role, or editing `exactText`, discards that evidence — re-run the
    // READ-ONLY delete probe and update WING_DELETION_CALIBRATION_EVIDENCE before changing this.
    expect(WING_DELETION_LABELS.delete).toEqual({ candidateQuery: "button,a,span,div", exactText: "삭제" });
    expect(WING_DELETION_CALIBRATION_EVIDENCE.label).toBe(WING_DELETION_LABELS.delete.exactText);
  });

  it("the recorded role is provenance only — the locator does NOT filter on it", () => {
    // The capture observed role=button, but the locator still counts every candidate in `candidateQuery`. If it
    // filtered on role it would be measuring something different from what was calibrated.
    expect(WING_DELETION_CALIBRATION_EVIDENCE.role).toBe("button");
    expect(WING_DELETION_LABELS.delete.candidateQuery).toContain("a,span,div");
  });

  it("NO runtime path reads the recorded evidence — sig16 is not a drift/safety anchor", () => {
    // This is the invariant that makes ONE capture a sufficient basis: nothing compares a live signature against
    // the recorded one, so cross-run signature stability is not required. Wiring such a comparison in would
    // CREATE that requirement — and a second independent delete-only live capture becomes a prerequisite.
    for (const [name, path] of [["driver", DRIVER], ["cli", CLI]] as const) {
      const src = codeOnly(path);
      expect(src, `${name} must not read the calibration evidence at runtime`).not.toContain(
        "WING_DELETION_CALIBRATION_EVIDENCE",
      );
      expect(src, `${name} must not compare a signature against a recorded constant`).not.toContain("sig16");
    }
  });

  it("the recorded sig16 literal appears ONLY in the provenance module, never in a runtime comparison", () => {
    const literal = WING_DELETION_CALIBRATION_EVIDENCE.sig16;
    expect(codeOnly(LABELS_MODULE)).toContain(literal);
    for (const path of [DRIVER, CLI]) expect(codeOnly(path)).not.toContain(literal);
  });

  it("the CLI still feeds the calibration flag to the gate rather than asserting calibration itself", () => {
    // Calibration must remain a value the approval gate checks, not something the destructive CLI declares true
    // inline — otherwise withdrawing the flag would no longer close the path.
    const code = codeOnly(CLI);
    expect(code).toContain("selectorsCalibrated: WING_DELETION_SELECTORS_CALIBRATED");
    expect(code).not.toContain("selectorsCalibrated: true");
  });
});
