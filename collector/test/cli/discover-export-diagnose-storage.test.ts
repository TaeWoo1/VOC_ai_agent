import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "..", "src", "cli", "discover-export.ts");

/** Remove block + line comments so the guards check executable source, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */ and /** jsdoc */
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // // line  (the [^:] guard spares "://" in URLs)
}

/** Slice the (comment-stripped) source into top-level `async function` bodies, keyed by name. */
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
const doDiscoverFn = bodies.doDiscover ?? "";
const haltHelperFn = bodies.emitColdStorageDiagnosticIfRequested ?? "";
const classifyFn = bodies.doDiscoverClassifyOnly ?? "";
const fullFn = bodies.doDiscoverFullCapture ?? "";

describe("discover-export --diagnose-storage — emits B_cold on the HALT (non-LOGGED_IN) path", () => {
  it("the cold-storage helper exists and is NOT restricted to LOGGED_IN", () => {
    expect(haltHelperFn, "emitColdStorageDiagnosticIfRequested must exist").toBeTruthy();
    expect(/collectSanitizedStorage\s*\(/.test(haltHelperFn)).toBe(true);
    expect(/contextLabel:\s*"B_cold"/.test(haltHelperFn)).toBe(true);
  });

  it("doDiscover invokes the cold-storage emit inside the !halt.proceed branch, BEFORE closing", () => {
    const haltIdx = doDiscoverFn.indexOf("!halt.proceed");
    const emitIdx = doDiscoverFn.indexOf("emitColdStorageDiagnosticIfRequested(");
    const firstClose = doDiscoverFn.indexOf("ctx.close()");
    expect(haltIdx).toBeGreaterThanOrEqual(0);
    expect(emitIdx).toBeGreaterThan(haltIdx); // emit is inside the halt branch (non-LOGGED_IN)
    expect(firstClose).toBeGreaterThan(emitIdx); // emit happens before the halt-path context close
  });

  it("the LOGGED_IN classify-only path also emits via the SAME helper", () => {
    expect(/emitColdStorageDiagnosticIfRequested\s*\(/.test(classifyFn)).toBe(true);
  });

  it("the full capture path NEVER invokes the storage diagnostic", () => {
    expect(fullFn.includes("emitColdStorageDiagnosticIfRequested")).toBe(false);
    expect(fullFn.includes("collectSanitizedStorage")).toBe(false);
  });
});

describe("discover-export --diagnose-storage — guards still hold before any launch/read", () => {
  it("rejects --diagnose-storage unless --classify-only is present, before launching", () => {
    const rejectIdx = doDiscoverFn.indexOf("only valid with --classify-only");
    const launchIdx = doDiscoverFn.indexOf("launchNaverContext(");
    expect(rejectIdx).toBeGreaterThanOrEqual(0);
    expect(launchIdx).toBeGreaterThan(rejectIdx); // rejection happens before the browser launch
  });

  it("fails closed without STORAGE_PROBE_SALT, before launching", () => {
    const saltGateIdx = doDiscoverFn.indexOf("Refusing to run the storage diagnostic without STORAGE_PROBE_SALT");
    const launchIdx = doDiscoverFn.indexOf("launchNaverContext(");
    expect(saltGateIdx).toBeGreaterThanOrEqual(0);
    expect(launchIdx).toBeGreaterThan(saltGateIdx);
  });

  it("the cold-storage helper re-checks the salt and no-ops when not requested", () => {
    expect(/if\s*\(\s*!diagnoseStorage\s*\|\|\s*!cfg\.storageProbeSalt\s*\)\s*return/.test(haltHelperFn)).toBe(true);
  });
});

describe("discover-export --diagnose-storage — the diagnostic path stays no-click / no-capture / no-leak", () => {
  it("the cold-storage helper never clicks, captures, uploads, or writes status", () => {
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent)\s*\(/.test(haltHelperFn)).toBe(false);
    expect(haltHelperFn.includes("runExport")).toBe(false);
    expect(haltHelperFn.includes("saveAs")).toBe(false);
    expect(haltHelperFn.includes("uploadReviewFile")).toBe(false);
    expect(haltHelperFn.includes("writeStatus")).toBe(false);
    expect(/\.content\s*\(/.test(haltHelperFn)).toBe(false); // no raw HTML dump
  });

  it("on a storage-read error it logs only a coarse sanitized reason (no raw stack/error)", () => {
    expect(/diagnose\.storage\.failed/.test(haltHelperFn)).toBe(true);
    expect(/reason:\s*"storage-read-error"/.test(haltHelperFn)).toBe(true);
    // The catch must not forward the error object into a log/print.
    expect(/catch\s*\(\s*[A-Za-z_$]/.test(haltHelperFn)).toBe(false); // catch binds no error variable
  });
});
