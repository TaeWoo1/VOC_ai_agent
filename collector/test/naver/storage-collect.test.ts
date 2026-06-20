import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(__dirname, "..", "..", "src", "naver", "storage-collect.ts");

/** Remove block + line comments so the guards check executable source, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // /* block */ and /** jsdoc */
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // // line  (the [^:] guard spares "://" in URLs)
}

const code = stripComments(readFileSync(SRC_PATH, "utf8"));

// Isolate the readDomStorage body (which IS the page.evaluate callback). A named
// inner helper here is the exact bug we fixed: under tsx/esbuild keepNames it becomes
// `__name(...)`, undefined in the page sandbox → `ReferenceError: __name is not defined`.
const fnStart = code.indexOf("async function readDomStorage");
const fnEnd = code.indexOf("export async function collectSanitizedStorage");
const readDomFn = code.slice(fnStart, fnEnd);
const evalIdx = readDomFn.indexOf("page.evaluate(");
const evaluateBody = readDomFn.slice(evalIdx);

describe("storage-collect — page.evaluate callback has NO named inner helper (the __name bug)", () => {
  it("isolates the readDomStorage evaluate callback", () => {
    expect(fnStart).toBeGreaterThanOrEqual(0);
    expect(evalIdx).toBeGreaterThanOrEqual(0);
    expect(/page\.evaluate\s*\(/.test(evaluateBody)).toBe(true);
  });

  it("never references the esbuild keepNames helper `__name(`", () => {
    expect(code.includes("__name(")).toBe(false);
  });

  it("has no named arrow helper assigned to a const inside the callback", () => {
    // e.g. `const dump = (s) => {...}` — this is what keepNames rewrites to __name(...).
    expect(/const\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*=>/.test(evaluateBody)).toBe(false);
    expect(evaluateBody.includes("const dump")).toBe(false);
  });

  it("has no inner `function NAME(` declaration inside the callback", () => {
    expect(/\bfunction\s+[A-Za-z_$]/.test(evaluateBody)).toBe(false);
    expect(evaluateBody.includes("function dump")).toBe(false);
  });

  it("still enumerates storage with plain inline loops (no helper indirection)", () => {
    expect(/for\s*\(\s*let\s+i\s*=\s*0/.test(evaluateBody)).toBe(true);
    expect(evaluateBody.includes("localStorage")).toBe(true);
    expect(evaluateBody.includes("sessionStorage")).toBe(true);
    expect(/return\s*\{\s*local\s*,\s*session\s*,\s*idb\s*\}/.test(evaluateBody)).toBe(true);
  });
});

describe("storage-collect — privacy: only metadata is forwarded to the pure sanitizer", () => {
  it("forwards value LENGTH, never the raw value, for cookies and storage", () => {
    // DOM storage entries carry only key + valueLength out of the page.
    expect(/valueLength:\s*value\s*\?\s*value\.length\s*:\s*0/.test(code)).toBe(true);
    // Cookies forward name + value.length (+ flags/domain) — never the value itself.
    expect(/valueLength:\s*c\.value\.length/.test(code)).toBe(true);
    expect(/\bvalue:\s*c\.value\b/.test(code)).toBe(false); // the raw cookie value is never forwarded
  });

  it("delegates sanitization to the pure extractor (no inline sanitizing here)", () => {
    expect(code.includes("extractStorageSignals(")).toBe(true);
  });
});
