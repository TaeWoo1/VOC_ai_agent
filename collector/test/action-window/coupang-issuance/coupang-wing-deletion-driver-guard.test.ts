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

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = resolve(HERE, "../../../src/action-window/coupang-wing-deletion-driver.ts");
const CLI = resolve(HERE, "../../../src/cli/run-coupang-wing-deletion-live.ts");

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
