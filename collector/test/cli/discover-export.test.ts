import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "instruments", "calibration", "discover-export.ts");

/** Remove block + line comments so the guard checks only executable source, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */ and /** jsdoc */
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // // line  (the [^:] guard spares "://" in URLs)
}

/**
 * Slice the (comment-stripped) source into its top-level `async function` bodies,
 * keyed by name. Each chunk runs from one `async function NAME(` up to the next —
 * the functions stay top-level, so this is a stable, exhaustive split.
 */
function functionBodies(src: string): Record<string, string> {
  const parts = src.split(/\nasync function /);
  const bodies: Record<string, string> = {};
  for (let i = 1; i < parts.length; i += 1) {
    const name = parts[i]?.match(/^([A-Za-z0-9_]+)/)?.[1];
    if (name) bodies[name] = parts[i] as string;
  }
  return bodies;
}

const code = stripComments(readFileSync(CLI_PATH, "utf8"));
const bodies = functionBodies(code);
const classifyFn = bodies.doDiscoverClassifyOnly;
const fullFn = bodies.doDiscoverFullCapture;

describe("discover-export — branch separation: --classify-only is NO-CLICK", () => {
  it("the file exposes the two split functions", () => {
    expect(classifyFn, "doDiscoverClassifyOnly must exist").toBeTruthy();
    expect(fullFn, "doDiscoverFullCapture must exist").toBeTruthy();
  });

  // The classify-only branch must never reach the trigger/capture/upload path. If any
  // of these reappear in its body, a real export could be triggered on the live store.
  const FORBIDDEN_IN_CLASSIFY: ReadonlyArray<string> = [
    "runExport",
    "saveAs",
    'waitForEvent("download")',
    "waitForEvent('download')",
    "download.path",
    ".click(",
    ".fill(",
    ".press(",
    "dispatchEvent",
    "uploadReviewFile",
    "resolveChannelId",
    "login(",
  ];

  for (const token of FORBIDDEN_IN_CLASSIFY) {
    it(`doDiscoverClassifyOnly contains no \`${token}\``, () => {
      expect((classifyFn ?? "").includes(token)).toBe(false);
    });
  }

  it("doDiscoverClassifyOnly classifies via the PURE no-click planner", () => {
    expect(/planExportAction/.test(classifyFn ?? "")).toBe(true);
    expect(/classifyOnlyStatusFromPlan/.test(classifyFn ?? "")).toBe(true);
  });

  it("doDiscoverClassifyOnly never clicks, fills, dispatches, or waits for a download", () => {
    expect(/waitForEvent\s*\(\s*["']download["']\s*\)/.test(classifyFn ?? "")).toBe(false);
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent)\s*\(/.test(classifyFn ?? "")).toBe(false);
  });
});

describe("discover-export — runExport is confined to the full capture path", () => {
  it("doDiscoverFullCapture is the capture path (positive control: it uses runExport)", () => {
    expect(/runExport\s*\(/.test(fullFn ?? "")).toBe(true);
  });

  it("the full path never runs runExport in classify-only mode", () => {
    expect(/classifyOnly\s*:\s*true/.test(fullFn ?? "")).toBe(false);
  });

  it("runExport appears in NO function body other than doDiscoverFullCapture", () => {
    for (const [name, body] of Object.entries(bodies)) {
      if (name === "doDiscoverFullCapture") continue;
      expect(body.includes("runExport"), `runExport must not appear in ${name}`).toBe(false);
    }
  });

  it("doDiscover routes --classify-only to the no-click function", () => {
    const dispatch = bodies.doDiscover ?? "";
    expect(/if\s*\(\s*classifyOnly\s*\)/.test(dispatch)).toBe(true);
    expect(/doDiscoverClassifyOnly\s*\(/.test(dispatch)).toBe(true);
  });
});
