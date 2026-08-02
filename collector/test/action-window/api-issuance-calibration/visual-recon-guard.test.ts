/**
 * Source guard over the VISUAL RECON live surfaces. The in-page redaction/census scripts must not exfiltrate a
 * value: their RETURN payloads are integers/booleans/structural only (the redaction pass reads element TEXT
 * SOLELY to decide coverage — that text is never returned). The CLI must be gated + inert-on-import, and its ONE
 * `.screenshot(...)` must be to a buffer (no `path:`) behind the {@link mayScreenshot} gate — no click/type/value
 * read anywhere. Comments are stripped first so the guard checks executable source, not prose.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildFixedLabelLocateScript, buildRedactionScript, EXTRACT_VISUAL_CONTROLS, REDACT_OVERLAY_ATTR } from "../../../src/action-window/api-issuance-calibration/visual-recon-inpage";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPAGE = join(__dirname, "..", "..", "..", "src", "action-window", "api-issuance-calibration", "visual-recon-inpage.ts");
const CLI = join(__dirname, "..", "..", "..", "src", "cli", "capture-api-center-visual.ts");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const inpage = stripComments(readFileSync(INPAGE, "utf8"));
const cli = stripComments(readFileSync(CLI, "utf8"));

/** Value reads, DOM dumps, exfil sinks, and any generated/blocked click — forbidden in the in-page scripts. */
const INPAGE_FORBIDDEN = [".value", ".innerHTML", ".outerHTML", ".innerText", "page.content(", "clipboard", "readText(", ".screenshot(", ".click(", ".type(", ".fill(", ".press(", ".submit(", "dispatchEvent", "preventDefault", "stopPropagation"];

describe("visual-recon-inpage.ts — value-free OUTPUT", () => {
  for (const token of INPAGE_FORBIDDEN) {
    it(`source contains no \`${token}\``, () => {
      expect(inpage.includes(token)).toBe(false);
    });
  }

  it("is never a passed function (no esbuild __name in the page)", () => {
    expect(inpage).not.toContain("__name");
  });

  it("uses only allowed structural/redaction reads", () => {
    expect(inpage).toContain("getBoundingClientRect");
    expect(inpage).toContain("getComputedStyle");
    expect(inpage).toContain("querySelectorAll");
    expect(inpage).toContain("getAttribute");
  });

  it("proves coverage by hit-testing the top-most paint, not geometry alone (no z-index blind spot)", () => {
    // elementFromPoint proves an overlay is the TOP-MOST element at the target, so a higher-z popup cannot be
    // mistaken for covered. Overlays are opaque + hit-testable (pointer-events:auto) at the MAX z-index.
    const apply = buildRedactionScript("apply");
    expect(apply).toContain("elementFromPoint");
    expect(apply).toContain("pointer-events:auto");
    expect(apply).toContain("z-index:2147483647");
    expect(apply).toContain("background:#111827");
  });

  it("reads element TEXT solely for the identity redaction detector (the one documented text read)", () => {
    // textContent is present (needed to detect stray identifiers) …
    expect(inpage).toContain("textContent");
  });

  it("the redaction report RETURN carries only integers/booleans — never text", () => {
    const ALLOWED = new Set(["bodyPresent", "overlayCount", "integrityOk", "detected", "covered"]);
    for (const mode of ["apply", "verify"] as const) {
      const script = buildRedactionScript(mode);
      const returns = [...script.matchAll(/return\s*\{([^}]*)\}/g)].map((m) => m[1]!);
      expect(returns.length).toBeGreaterThan(0);
      for (const block of returns) {
        const keys = block.split(",").map((kv) => kv.split(":")[0]!.trim()).filter(Boolean);
        for (const k of keys) expect(ALLOWED.has(k), `redaction report key '${k}' must be in the numeric/boolean allowlist`).toBe(true);
      }
      // the local holding matched text (`txt`) never appears inside a returned literal
      for (const block of returns) expect(block.includes("txt")).toBe(false);
    }
  });

  it("the fixed-label LOCATE script (Phase-B highlight locator) has value-free OUTPUT — only { count, sig }", () => {
    for (const tag of [true, false]) {
      const script = buildFixedLabelLocateScript({ candidateQuery: "button, a, [role='button']", exactText: "애플리케이션 등록", tag });
      const returns = [...script.matchAll(/return\s*\{[^;]*?\};?/g)].map((m) => m[0]!);
      // Exactly the two known-safe return shapes: the non-unique `{ count }` and the unique `{ count, sig }`.
      expect(returns.some((r) => /return\s*\{\s*count:\s*matches\.length\s*\}/.test(r))).toBe(true);
      expect(returns.some((r) => /return\s*\{\s*count:\s*1,\s*sig:/.test(r))).toBe(true);
      // Text is read ONLY to COMPARE against the caller's known fixed label — never RETURNED. The locals holding
      // accessible-name text (`want`, element `.textContent`) never appear inside a returned literal.
      for (const block of returns) {
        expect(block.includes("want"), "must not return the compared text").toBe(false);
        expect(block.includes("textContent"), "must not return element text").toBe(false);
      }
      // No value read / click / type anywhere in the locate script (defense in depth over the module-wide scan).
      for (const forbidden of [".value", ".click(", ".type(", "inputValue", "clipboard", ".screenshot("]) {
        expect(script.includes(forbidden), `locate script must not ${forbidden}`).toBe(false);
      }
    }
    // The TAG variant writes the read-only marker; the LOCATE variant does not mutate the page at all.
    expect(buildFixedLabelLocateScript({ candidateQuery: "*", exactText: "x", tag: true })).toContain("setAttribute('data-aw-target'");
    expect(buildFixedLabelLocateScript({ candidateQuery: "*", exactText: "x", tag: false })).not.toContain("setAttribute");
  });

  it("the census script never reads a value/text (structure + attributes only)", () => {
    for (const token of [".value", ".textContent", ".innerHTML", ".innerText"]) {
      expect(EXTRACT_VISUAL_CONTROLS.includes(token), `census must not read ${token}`).toBe(false);
    }
    expect(EXTRACT_VISUAL_CONTROLS).toContain("getBoundingClientRect");
  });

  it("draws opaque overlays and never dispatches/blocks a click", () => {
    const apply = buildRedactionScript("apply");
    expect(apply).toContain("background:#111827");
    expect(REDACT_OVERLAY_ATTR).toBe("data-sellerops-redact");
    for (const forbidden of ["dispatchEvent", "preventDefault", "stopPropagation", ".click("]) {
      expect(apply.includes(forbidden), `overlay must not ${forbidden}`).toBe(false);
    }
  });
});

/** In the CLI, everything above is forbidden EXCEPT `.screenshot(` (the one gated capability). */
const CLI_FORBIDDEN = [".value", ".textContent", ".innerHTML", ".outerHTML", ".innerText", "page.content(", "clipboard", "readText(", ".click(", ".type(", ".fill(", ".press(", ".submit(", "dispatchEvent", "preventDefault", "stopPropagation"];

describe("capture-api-center-visual.ts — gated, screenshot fenced behind the redaction verdict", () => {
  for (const token of CLI_FORBIDDEN) {
    it(`source contains no \`${token}\``, () => {
      expect(cli.includes(token)).toBe(false);
    });
  }

  it("refuses without the live-run approval flag and host-screens the URL fail-closed", () => {
    expect(cli).toContain("hasLiveRunApproval");
    expect(cli).toContain("screenApiCenterUrl");
  });

  it("runs main() only when invoked directly (inert on import)", () => {
    expect(cli).toContain("import.meta.url === pathToFileURL");
  });

  it("the screenshot is gated by mayScreenshot and never auto-written (buffer only, no `path:`)", () => {
    expect(cli).toContain("mayScreenshot");
    expect(cli).toContain(".screenshot(");
    // The screenshot call passes NO `path` option → captured to a buffer, only written after re-verification.
    expect(/\.screenshot\([^)]*path/.test(cli)).toBe(false);
  });

  it("only ever writes artifacts inside the gitignored .calibration/visual/ sink", () => {
    expect(cli).toContain("isSafeVisualArtifactPath");
    expect(cli).toContain(".calibration");
  });
});
