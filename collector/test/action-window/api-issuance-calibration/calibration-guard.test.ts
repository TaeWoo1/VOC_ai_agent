/**
 * Source guard over the calibration LIVE surfaces (`calibration-inpage.ts` + `calibrate-api-center.ts`). The
 * in-page scripts gather STRUCTURE ONLY and the CLI observes read-only: neither may read a field VALUE, dump
 * the DOM, touch the clipboard/screenshot, or generate/block any click. Comments are stripped first so the
 * guard checks executable source, not prose.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INPAGE = join(__dirname, "..", "..", "..", "src", "action-window", "api-issuance-calibration", "calibration-inpage.ts");
const CLI = join(__dirname, "..", "..", "..", "src", "cli", "calibrate-api-center.ts");

/** Remove block + line comments so the guard checks only executable source, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // // line  (the [^:] guard spares "://" in URLs)
}

const inpage = stripComments(readFileSync(INPAGE, "utf8"));
const cli = stripComments(readFileSync(CLI, "utf8"));

/** Value reads, DOM dumps, exfiltration sinks, and any generated/blocked click — forbidden everywhere. */
const FORBIDDEN: ReadonlyArray<string> = [
  ".value",
  ".textContent",
  ".innerText",
  ".innerHTML",
  ".outerHTML",
  "page.content(",
  "clipboard",
  "readText(",
  ".screenshot(",
  ".click(",
  ".type(",
  ".fill(",
  ".press(",
  ".submit(",
  "dispatchEvent",
  "preventDefault",
  "stopPropagation",
];

describe("calibration-inpage.ts — structure-only, value-free", () => {
  for (const token of FORBIDDEN) {
    it(`source contains no \`${token}\``, () => {
      expect(inpage.includes(token)).toBe(false);
    });
  }

  it("uses only the allowed structural reads", () => {
    expect(inpage).toContain("getAttribute");
    expect(inpage).toContain("querySelectorAll");
    expect(inpage).toContain("addEventListener");
    expect(inpage).toContain("getBoundingClientRect");
  });

  it("every exported script is a STRING (never a passed function → no esbuild __name in the page)", () => {
    expect(inpage).not.toContain("__name");
  });
});

describe("calibrate-api-center.ts — read-only observer, no automatic action", () => {
  for (const token of FORBIDDEN) {
    it(`source contains no \`${token}\``, () => {
      expect(cli.includes(token)).toBe(false);
    });
  }

  it("drives the page only through .evaluate (string form)", () => {
    expect(cli).toContain(".evaluate");
  });
});

describe("calibrate-api-center.ts — gated + inert on import", () => {
  it("refuses without the live-run approval flag", () => {
    expect(cli).toContain("hasLiveRunApproval");
  });

  it("host-screens the API-center URL fail-closed before launching", () => {
    expect(cli).toContain("screenApiCenterUrl");
  });

  it("runs main() only when invoked directly (inert on import)", () => {
    expect(cli).toContain("import.meta.url === pathToFileURL");
  });
});
