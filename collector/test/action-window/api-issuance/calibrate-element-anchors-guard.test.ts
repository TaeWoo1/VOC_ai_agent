/**
 * Source guard + gate tests for the READ-ONLY element-anchor calibration CLI.
 *
 * This runtime is DELIBERATELY THINner than the selector probe: it opens Chrome and idles. The evidence is
 * collected in the operator's DevTools, so the runtime must prove it reads NOTHING off the page — not even a
 * page `.evaluate`. The guard therefore forbids every click/type/submit, every value/text/HTML read, every
 * re-navigation, AND page evaluation / highlight / tag / driver / writer / backend, while allowing exactly
 * one `.goto` to the pre-screened URL. Comment lines are stripped first, per collector conventions.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  calibrationRefusal,
  calibrationDonePathFor,
  CALIBRATION_DONE_FILENAME,
  CALIBRATION_PRODUCTION_REFUSAL,
} from "../../../instruments/calibration/calibrate-element-anchors";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../../../instruments/calibration/calibrate-element-anchors.ts");

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

const NO_NAV_TOKENS = [".goBack(", ".goForward(", ".reload(", "waitForNavigation", "window.open"] as const;

/**
 * It performs NO page evaluation / highlight / tag, imports no driver / writer / backend.
 * Covers the capitalized / handle / $eval / init-script variants too, so a page read cannot regress in
 * under a form the plain `.evaluate(` / `.textContent` checks would miss.
 */
const NO_PAGE_READ_TOKENS = [
  ".evaluate(",
  ".evaluateHandle(",
  ".$eval(",
  ".$$eval(",
  ".evaluateAll(",
  ".$$(",
  ".$(",
  ".allTextContents(",
  ".allInnerTexts(",
  "waitForFunction(",
  "addInitScript(",
  "addScriptTag(",
  "setAttribute",
  "mountOverlay",
  "armObserver",
  "highlightTarget",
  "probeTargetMatch",
  "NaverIssuanceDriver",
  "saveSelectorSpecs",
  "writeStatus",
  "fetch(",
] as const;

describe("calibrate-element-anchors CLI — source guard (gated, opens Chrome + idles, reads nothing)", () => {
  const code = codeOnly(CLI);

  it.each(NO_ACTION_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_VALUE_READ_TOKENS)("never reads a field value / text / HTML / clipboard / screenshot (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_NAV_TOKENS)("never re-navigates the seller's window (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_PAGE_READ_TOKENS)("performs no page evaluation / highlight / write / backend (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it("navigates exactly ONCE — to the pre-screened URL only", () => {
    expect(code.split(".goto(").length - 1).toBe(1);
  });

  it("is gated on the read-only approval flag, screens the URL, and is inert on import", () => {
    expect(code).toContain("hasReviewIdProbeApproval");
    expect(code).toContain("screenApiCenterUrl");
    expect(code).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
  });
});

describe("calibrationRefusal — gate is read-only-only and refuses mutating grants", () => {
  it("refuses when no approval flag is present (exit 3)", () => {
    const r = calibrationRefusal([], {});
    expect(r?.exitCode).toBe(3);
  });

  it("refuses the EXPORT (mutating-model) grant even though it is 'stronger' (exit 6)", () => {
    const r = calibrationRefusal(["--i-understand-this-opens-live-naver"], {});
    expect(r?.exitCode).toBe(6);
  });

  it("refuses the reply WRITE grant (exit 6)", () => {
    const r = calibrationRefusal(["--i-understand-this-posts-a-live-naver-reply"], {});
    expect(r?.exitCode).toBe(6);
  });

  it("passes with the read-only flag under a non-production env", () => {
    expect(calibrationRefusal(["--i-understand-this-inspects-live-naver-read-only"], {})).toBeNull();
  });

  it("refuses under NODE_ENV=production even with the read-only flag (exit 4)", () => {
    const r = calibrationRefusal(["--i-understand-this-inspects-live-naver-read-only"], { NODE_ENV: "production" });
    expect(r?.exitCode).toBe(4);
    expect(r?.reason).toBe(CALIBRATION_PRODUCTION_REFUSAL);
  });
});

describe("calibrationDonePathFor — operator-done sentinel path", () => {
  it("derives the sentinel next to the status file", () => {
    const p = calibrationDonePathFor("/x/y/.status/naver.json");
    expect(p).toBe(resolve("/x/y/.status", CALIBRATION_DONE_FILENAME));
  });
});
