/**
 * Source guard for the DESTRUCTIVE `CoupangWingDeletionDriver` and its gated CLI `run-coupang-wing-deletion-live`.
 *
 * The AGENT never deletes: the SELLER presses 삭제 themselves. The guard ALLOWS `.evaluate` / `mountOverlay`
 * (highlight + census) but forbids EVERY click/type/submit/delete and EVERY field-VALUE read, and — for the CLI —
 * proves it is gated, inert on import, never navigates the seller's window, and fails closed through the approval
 * gate + the delete-selector calibration flag.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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
      expect(src, `${name} must not carry a hardcoded 16-hex signature literal`).not.toMatch(/["'][0-9a-f]{16}["']/);
    }
  });

  /**
   * The token greps above are necessary but NOT sufficient: a one-line indirection
   * (`export const RECORDED_DELETE_ANCHOR = WING_DELETION_CALIBRATION_EVIDENCE.sig16` in the provenance module,
   * imported into the driver) sails past all of them. The tests below close the reachable ways to get the
   * recorded signature into the deletion path: named/aliased import (allowlist), namespace import, dynamic
   * import / `require`, a signature-shaped export to reach for, and a third relay module.
   *
   * **Stated limit — this closes accidental adoption, not a determined author.** A hand-obfuscated literal
   * (`"3562cb60" + "c496e220"`) defeats every source grep here, as does deriving the value at runtime. The guard
   * is a tripwire that makes "wire the recorded sig into a runtime check" a deliberate act with a visible test
   * to delete first — the same posture the WING probe-scope gate documents. Deleting one of these tests IS the
   * signal that a second independent live capture is now required.
   */
  it("the deletion path imports ONLY the label + flag from the provenance module (no derived sig anchor)", () => {
    const ALLOWED = new Set(["WING_DELETION_LABELS", "WING_DELETION_SELECTORS_CALIBRATED"]);
    for (const [name, path] of [["driver", DRIVER], ["cli", CLI]] as const) {
      const src = readFileSync(path, "utf8");
      // Only BRACED named imports are permitted from the provenance module — a namespace or dynamic import
      // would hand the deletion path the whole module (including the evidence) past the allowlist below.
      // `(\.js)?` matters: under `moduleResolution: "Bundler"` a `.js` specifier resolves the same module, and
      // an exact-anchored pattern would silently stop matching — disabling the allowlist below along with it.
      expect(src, `${name} must not namespace-import the provenance module`).not.toMatch(
        /import\s+\*\s+as\s+\w+\s+from\s+["'][^"']*coupang-wing-issuance-driver(\.js)?["']/,
      );
      for (const dynamic of [/\bawait\s+import\s*\(/, /\bimport\s*\(\s*["']/, /\brequire\s*\(/]) {
        expect(src, `${name} must not load modules dynamically (it would bypass the import allowlist)`).not.toMatch(dynamic);
      }
      const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["'][^"']*coupang-wing-issuance-driver(?:\.js)?["']/g;
      expect(
        src.includes("coupang-wing-issuance-driver") ? importRe.test(src) : true,
        `${name} references the provenance module but no braced named import matched — the allowlist below would be vacuous`,
      ).toBe(true);
      importRe.lastIndex = 0;
      for (let m = importRe.exec(src); m !== null; m = importRe.exec(src)) {
        for (const raw of m[1]!.split(",")) {
          const sym = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
          if (sym.length === 0) continue;
          expect(ALLOWED.has(sym), `${name} imports ${sym} from the provenance module — not on the allowlist`).toBe(true);
        }
      }
    }
  });

  it("the evidence is referenced by NO other src module — a relay module cannot launder it into the driver", () => {
    // Closes the third-module bypass: a new `delete-anchor.ts` that re-exports the evidence would pass the
    // driver's import allowlist (different path). Only the declaring module may mention it in `src/`.
    const SRC_ROOT = resolve(HERE, "../../../src");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && full !== LABELS_MODULE) {
          if (codeOnly(full).includes("WING_DELETION_CALIBRATION_EVIDENCE")) offenders.push(full.slice(SRC_ROOT.length + 1));
        }
      }
    };
    walk(SRC_ROOT);
    expect(offenders, "the calibration evidence must stay in its declaring module").toEqual([]);
  });

  it("the provenance module DERIVES no second export from the evidence — no anchor to reach for", () => {
    // Name-pattern matching was too narrow (a `…RECORDED_FINGERPRINT` export sailed past a /SIG|ANCHOR/ test).
    // Match on the DERIVATION instead: exactly ONE statement in the module may mention the evidence — its own
    // declaration. Any other export computed from it (whatever it is called) is the tripwire.
    const src = codeOnly(LABELS_MODULE);
    const mentions = src
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("WING_DELETION_CALIBRATION_EVIDENCE"));
    expect(
      mentions,
      "only the evidence's own declaration may mention it; a derived export needs a SECOND live capture first",
    ).toEqual(["export const WING_DELETION_CALIBRATION_EVIDENCE: WingDeletionCalibrationEvidence = {"]);
  });

  it("the recorded sig16 literal appears ONLY in the provenance module, never in a runtime comparison", () => {
    const literal = WING_DELETION_CALIBRATION_EVIDENCE.sig16;
    expect(literal).toMatch(/^[0-9a-f]{16}$/); // the assertion below is only meaningful for a real 16-hex token
    expect(codeOnly(LABELS_MODULE)).toContain(literal);
    for (const path of [DRIVER, CLI]) expect(codeOnly(path)).not.toContain(literal);
  });

  it("the checkpoint panel takes NO pointer events — it can never block the operator's own 삭제 press", () => {
    // The deletion checkpoint is copy-only (no advance button), and it is fixed at the bottom of the viewport.
    // If it took pointer events it could sit over the very control the operator must press on a short page —
    // breaking "manual progress always remains available". The spotlight ring is already `pointer-events:none`
    // for the same reason; the panel must match whenever there is nothing in it to click.
    const overlay = codeOnly(resolve(HERE, "../../../src/action-window/overlay.ts"));
    // The paint check must target the PANEL (which carries the warning), not the spotlight ring — the ring box
    // is appended even when guidance is disabled, so checking it would pass for a run showing nothing legible.
    expect(codeOnly(DRIVER)).toContain("advancePanelMounted");
    expect(codeOnly(DRIVER), "checking the ring instead of the panel would pass with nothing legible painted").not.toContain(
      "overlayMounted",
    );
    expect(overlay).toContain('const panelPointerEvents = o.advance ? "auto" : "none";');
    expect(overlay).toContain("pointer-events:${panelPointerEvents}");
    // …and the deletion driver must not smuggle in an advance button, which would flip it back to `auto`.
    expect(codeOnly(DRIVER)).not.toContain("advance:");
  });

  it("the CLI still feeds the calibration flag to the gate rather than asserting calibration itself", () => {
    // Calibration must remain a value the approval gate checks, not something the destructive CLI declares true
    // inline — otherwise withdrawing the flag would no longer close the path.
    const code = codeOnly(CLI);
    expect(code).toContain("selectorsCalibrated: WING_DELETION_SELECTORS_CALIBRATED");
    expect(code).not.toContain("selectorsCalibrated: true");
  });
});
