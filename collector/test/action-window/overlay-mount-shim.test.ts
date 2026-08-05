/**
 * Regression guard for the esbuild `__name` keepNames shim leaking into an in-page `page.evaluate` callback.
 *
 * `overlay.ts` ships several callbacks to the page via `page.evaluate((…) => {…})`. Under `tsx`/esbuild
 * (keepNames, the default), a NAME-INFERABLE inner closure — e.g. `const reposition = () => {…}` — compiles to
 * `const reposition = __name(() => {…}, "reposition")`, but `page.evaluate` serializes only the callback BODY, so
 * esbuild's module-scope `__name` helper is never shipped → the page throws `ReferenceError: __name is not
 * defined`. That was the LIVE-confirmed `subStage: position_overlay` / `reason: SYMBOL_NOT_DEFINED` mount fault
 * (from `mountOverlay`'s `reposition` closure).
 *
 * The fix wraps that closure so its initializer is not name-inferable (`[ () => {…} ][0]!`), emitting no `__name`
 * wrapper. This test transforms overlay.ts EXACTLY as tsx would and asserts that NO `page.evaluate` callback in
 * the file ships a `__name(` — so a future name-inferable closure added to ANY overlay evaluate (not just
 * `mountOverlay`) fails here instead of only in a gated live run.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { transformSync } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const OVERLAY_SRC = resolve(HERE, "../../src/action-window/overlay.ts");

/** Transform TS the way `tsx` does (esbuild, keepNames on) — the property that governs `__name` wrapping. */
function compile(src: string): string {
  return transformSync(src, { loader: "ts", format: "esm", keepNames: true }).code;
}

/**
 * The argument text of every `.evaluate( … )` call in the compiled module — i.e. exactly what Playwright
 * serializes to the page (the callback body, plus any serializable args). Extracted by balanced-paren scan from
 * each `.evaluate(`. Module-scope `__name(fn, "fn")` helper namings (which run in Node, where `__name` IS defined)
 * live OUTSIDE these regions and are correctly ignored. NOTE: relies on parentheses inside string/template
 * literals in the callbacks being balanced (true for overlay.ts — e.g. `rgba(0,0,0,0.28)`); an imbalance would
 * only make the scan fail loud, never silently pass.
 */
function evaluateArgRegions(code: string): string[] {
  const regions: string[] = [];
  const re = /\.evaluate\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let i = m.index + m[0].length;
    const start = i;
    let depth = 1;
    while (i < code.length && depth > 0) {
      const c = code[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    regions.push(code.slice(start, i - 1));
  }
  return regions;
}

describe("overlay page.evaluate callbacks — no esbuild __name shim leaks into the shipped page code", () => {
  const compiled = compile(readFileSync(OVERLAY_SRC, "utf8"));

  it("has page.evaluate callbacks to scan (the extractor found real regions)", () => {
    const regions = evaluateArgRegions(compiled);
    expect(regions.length).toBeGreaterThanOrEqual(4); // mountOverlay / refreshOverlay / setOverlayGuidance / unmountOverlay / overlayMounted / overlayTop / readMountSubStage
    // Sanity: the mount callback (with `reposition`) is among them.
    expect(regions.some((r) => r.includes("reposition"))).toBe(true);
  });

  it("NO shipped evaluate body references __name( (covers mountOverlay AND every sibling evaluate)", () => {
    const regions = evaluateArgRegions(compiled);
    const leaking = regions.filter((r) => r.includes("__name("));
    // If this fails: a name-inferable closure (`const x = () => {…}`) was added inside a page.evaluate callback;
    // wrap its initializer so it is not name-inferable (see mountOverlay's `reposition = [ … ][0]!`).
    expect(leaking).toEqual([]);
  });

  it("specifically: mountOverlay's `reposition` closure ships clean (the live-fixed line)", () => {
    const mountRegion = evaluateArgRegions(compiled).find((r) => r.includes("reposition"));
    expect(mountRegion).toBeDefined();
    expect(mountRegion!.includes("__name(")).toBe(false);
    // The fix keeps the closure functional: still referenced by add/removeEventListener (stable ref preserved).
    expect(mountRegion!).toContain('addEventListener("scroll", reposition');
    expect(mountRegion!).toContain('removeEventListener("scroll", reposition');
  });

  it("POSITIVE CONTROL: a name-inferable closure inside an evaluate DOES emit __name( (the detector works)", () => {
    // Proves the negative assertions are meaningful — the same transform on a hazardous shape trips the shim.
    const hazard = compile(
      `export function f(page: any){ return page.evaluate((o: any) => { const reposition = () => 1; addEventListener("scroll", reposition); }); }`,
    );
    const region = evaluateArgRegions(hazard).find((r) => r.includes("reposition"));
    expect(region).toBeDefined();
    expect(region!.includes("__name(")).toBe(true);
    // Tolerant of esbuild's `/* @__PURE__ */` annotation being present or not (a cosmetic that may change).
    expect(/reposition = (?:\/\* @__PURE__ \*\/ )?__name\(/.test(region!)).toBe(true);
  });
});
