/**
 * The window-geometry probe's PURE parts: what a reading means, which options each mode launches with, and the
 * boundary that keeps the probe local (it opens `about:blank` and never navigates anywhere).
 *
 * The live measurement itself is not re-run here — it launches three browsers. What is pinned is that the mode
 * under test IS the shipped policy, so a drift in `buildLaunchOptions` cannot leave the probe measuring a copy
 * of what the walk used to do.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  GEOMETRY_LAUNCH_MODES,
  GEOMETRY_READ_SCRIPT,
  classifyGeometry,
  geometryLaunchOptions,
  geometryProbeProfileDir,
  type WindowGeometryReading,
} from "../../instruments/calibration/measure-walk-window-geometry";
import { buildLaunchOptions } from "../../src/profile";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = resolve(HERE, "../../instruments/calibration/measure-walk-window-geometry.ts");

/** The AS_SHIPPED numbers real Chrome returned on 2026-08-12 — the crop, as measured. */
const AS_SHIPPED_LIVE: WindowGeometryReading = {
  mode: "AS_SHIPPED",
  innerWidth: 1280,
  innerHeight: 720,
  outerWidth: 1420,
  outerHeight: 850,
  screenAvailWidth: 1280,
  screenAvailHeight: 720,
  devicePixelRatio: 1,
};

/** The FOLLOWS_WINDOW numbers from the same sitting — the same machine, telling the truth about itself. */
const FOLLOWS_WINDOW_LIVE: WindowGeometryReading = {
  mode: "FOLLOWS_WINDOW",
  innerWidth: 1440,
  innerHeight: 783,
  outerWidth: 1440,
  outerHeight: 870,
  screenAvailWidth: 1440,
  screenAvailHeight: 870,
  devicePixelRatio: 2,
};

describe("classifyGeometry", () => {
  it("calls the live AS_SHIPPED reading what it is: a page pinned below the window showing it", () => {
    expect(classifyGeometry(AS_SHIPPED_LIVE)).toBe("VIEWPORT_PINNED_BELOW_WINDOW");
  });

  it("clears the live FOLLOWS_WINDOW reading", () => {
    expect(classifyGeometry(FOLLOWS_WINDOW_LIVE)).toBe("VIEWPORT_FOLLOWS_WINDOW");
  });

  it("does not call browser chrome a crop — a normal window/page gap stays clear", () => {
    // 87px of tab strip + address bar is what a window that DOES follow its page looks like.
    expect(classifyGeometry({ ...FOLLOWS_WINDOW_LIVE, outerHeight: 870, innerHeight: 783 })).toBe(
      "VIEWPORT_FOLLOWS_WINDOW",
    );
  });

  it("catches a crop in EITHER axis, not just width", () => {
    const tallGap = { ...FOLLOWS_WINDOW_LIVE, innerHeight: 600 };
    expect(classifyGeometry(tallGap)).toBe("VIEWPORT_PINNED_BELOW_WINDOW");
  });

  it("separates 'the seller has a small window' from 'the page is pinned' — only one is ours to fix", () => {
    const small = { ...FOLLOWS_WINDOW_LIVE, innerWidth: 900, outerWidth: 900, innerHeight: 700, outerHeight: 760 };
    expect(classifyGeometry(small)).toBe("WINDOW_SMALLER_THAN_SCREEN");
  });

  it("concludes NOTHING from an unreadable number", () => {
    expect(classifyGeometry({ ...FOLLOWS_WINDOW_LIVE, innerWidth: 0 })).toBe("UNREADABLE");
    expect(classifyGeometry({ ...FOLLOWS_WINDOW_LIVE, devicePixelRatio: Number.NaN })).toBe("UNREADABLE");
  });
});

describe("geometryLaunchOptions", () => {
  it("measures the SHIPPED policy for FOLLOWS_WINDOW, never a local copy of it", () => {
    expect(geometryLaunchOptions("FOLLOWS_WINDOW", "chrome")).toEqual({
      ...buildLaunchOptions("chrome", { followWindow: true }),
    });
  });

  it("AS_SHIPPED is exactly what the walk launched before the fix — no viewport key at all", () => {
    const opts = geometryLaunchOptions("AS_SHIPPED", "chrome");
    expect(opts).toEqual({ ...buildLaunchOptions("chrome") });
    expect("viewport" in opts).toBe(false);
  });

  it("MAXIMIZED keeps the override and only grows the window — the control that isolates the cause", () => {
    const opts = geometryLaunchOptions("MAXIMIZED", "chrome");
    expect(opts["args"]).toEqual(["--start-maximized"]);
    expect("viewport" in opts).toBe(false);
  });

  it("covers all three modes", () => {
    expect(GEOMETRY_LAUNCH_MODES).toEqual(["AS_SHIPPED", "MAXIMIZED", "FOLLOWS_WINDOW"]);
  });
});

describe("the probe stays local and value-free", () => {
  const code = readFileSync(PROBE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");

  it("never navigates — no marketplace, no URL, nothing but about:blank", () => {
    expect(code).not.toContain(".goto(");
    expect(code).not.toContain("http://");
    expect(code).not.toContain("https://");
  });

  it("never reads page content — seven numbers and nothing else", () => {
    for (const token of [".textContent", ".innerHTML", ".content(", ".screenshot(", "document.body"]) {
      expect(code).not.toContain(token);
    }
    expect(GEOMETRY_READ_SCRIPT).not.toContain("document");
  });

  it("uses its OWN profile directory, never the walk's (a live run holds a lock on that one)", () => {
    const root = "/tmp/collector-root";
    expect(geometryProbeProfileDir(root)).toBe(`${root}/.profile/window-geometry-probe`);
  });
});
