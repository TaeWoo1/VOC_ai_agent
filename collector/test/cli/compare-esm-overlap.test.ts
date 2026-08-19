import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseNamedPathArg } from "../../instruments/calibration/compare-esm-overlap";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "instruments", "calibration", "compare-esm-overlap.ts");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("compare-esm-overlap — parseNamedPathArg", () => {
  it("reads `--a path` and `--b=path`, null when absent", () => {
    expect(parseNamedPathArg(["--a", "/x.json"], "--a")).toBe("/x.json");
    expect(parseNamedPathArg(["--b=/y.json"], "--b")).toBe("/y.json");
    expect(parseNamedPathArg(["--a", "/x.json"], "--b")).toBeNull();
    expect(parseNamedPathArg([], "--a")).toBeNull();
  });
});

describe("compare-esm-overlap — OFFLINE, read-only purity (no browser / click / upload / status)", () => {
  const raw = readFileSync(CLI_PATH, "utf8");
  const code = stripComments(raw);
  const importLines = code.split("\n").filter((l) => /^\s*import\b/.test(l));

  it("imports no browser / upload / status / scheduler module", () => {
    for (const forbidden of ["playwright", "../../src/upload", "../../src/status", "review-download-save", "review-upload", "child_process", "node:http"]) {
      expect(importLines.some((l) => l.includes(forbidden))).toBe(false);
    }
  });

  it("contains no click / download / save / upload / status / scheduler tokens", () => {
    for (const token of [
      ".click(",
      'waitForEvent("download")',
      "saveAs",
      "uploadReviewFile",
      "writeStatus",
      "runExport",
      "manualSync",
      "scheduler",
      "setInterval",
      "cron",
      "launchPersistentBrowser",
    ]) {
      expect(code.includes(token)).toBe(false);
    }
  });

  it("delegates the comparison to the pure overlap module", () => {
    expect(/from\s+["']\.\.\/\.\.\/src\/esm\/esm-review-overlap["']/.test(code)).toBe(true);
    expect(/summarizeOverlap\s*\(/.test(code)).toBe(true);
  });

  it("prints sanitized output and echoes no input path on the error paths", () => {
    expect(/console\.log\(JSON\.stringify\(/.test(code)).toBe(true);
    // The error branches must not interpolate the path variables into the message.
    expect(/console\.error\([^)]*\$\{path[AB]\}/.test(code)).toBe(false);
  });
});
