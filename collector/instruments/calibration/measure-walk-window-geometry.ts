/**
 * **Window ↔ viewport geometry probe for the guided-walk browser window.**
 *
 * The Coupang walk was live-observed twice rendering CROPPED, with scrollbars, and with WING's own `확인` out of
 * reach unless the operator pressed `cmd -` to zoom the page out. That is a claim about geometry, and this
 * program is here so the claim is settled by MEASUREMENT rather than by reading launch code and inferring.
 *
 * It launches the SAME headed Chrome the walk launches — through {@link buildLaunchOptions}, the walk carrier's
 * own policy builder — and reads back the window's real numbers. It **never opens a marketplace**: there is no
 * `goto` in this file, nothing is navigated, and the only document read is the `about:blank` the browser opens
 * with. It uses its OWN in-tree profile directory, so a live walk's profile is never touched or locked.
 *
 * Three launches, because one number alone proves nothing:
 *   - `AS_SHIPPED`      — exactly what the walk uses today.
 *   - `MAXIMIZED`       — the same, with the window opened maximized (what an operator does by hand).
 *   - `FOLLOWS_WINDOW`  — maximized AND `viewport: null`, the policy `local-agent-launch.ts` already carries.
 *
 * Everything it prints is GEOMETRY: pixel counts, a device-pixel ratio, and a fixed verdict enum. No URL, no
 * page content, no profile path, no account identity.
 *
 *   npx tsx instruments/calibration/measure-walk-window-geometry.ts
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveProfileDir, buildLaunchOptions } from "../../src/profile";

/** The three launch policies compared. Fixed enum — it is printed, so it may never carry a path or a URL. */
export type GeometryLaunchMode = "AS_SHIPPED" | "MAXIMIZED" | "FOLLOWS_WINDOW";

export const GEOMETRY_LAUNCH_MODES: readonly GeometryLaunchMode[] = ["AS_SHIPPED", "MAXIMIZED", "FOLLOWS_WINDOW"];

/**
 * One window's geometry, in CSS pixels except `devicePixelRatio`.
 *
 * `inner*` is the PAGE's viewport — what CSS lays out against and what `position:fixed` is measured in.
 * `outer*` is the WINDOW, browser chrome included. `screenAvail*` is the usable desktop. The gap between the
 * first two is the whole question: a page whose viewport is pinned below the window it is displayed in is a
 * page the operator sees cropped.
 */
export interface WindowGeometryReading {
  readonly mode: GeometryLaunchMode;
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly outerWidth: number;
  readonly outerHeight: number;
  readonly screenAvailWidth: number;
  readonly screenAvailHeight: number;
  readonly devicePixelRatio: number;
}

/**
 * The verdict for one reading:
 *   - `VIEWPORT_FOLLOWS_WINDOW` — the page is laid out against the window the operator actually has.
 *   - `VIEWPORT_PINNED_BELOW_WINDOW` — the page is laid out against something SMALLER than the window. This is
 *     the cropped case: WING renders for a viewport the operator cannot see all of, and its own controls land
 *     outside what the window shows.
 *   - `WINDOW_SMALLER_THAN_SCREEN` — viewport and window agree, but the window is small. Not a bug, and not
 *     something a launch policy should decide for a seller who may have arranged their desktop deliberately.
 *   - `UNREADABLE` — a non-finite or non-positive number came back; nothing is concluded from it.
 */
export type GeometryVerdict =
  | "VIEWPORT_FOLLOWS_WINDOW"
  | "VIEWPORT_PINNED_BELOW_WINDOW"
  | "WINDOW_SMALLER_THAN_SCREEN"
  | "UNREADABLE";

/**
 * How far the page viewport may sit below the window before it counts as PINNED.
 *
 * Generous on purpose. A window that follows its page still differs from it by the browser chrome — the tab
 * strip and address bar are tens of pixels tall, and a scrollbar takes a few horizontally — so a small gap is
 * normal and means nothing. A page pinned at 1280×720 inside a maximized window differs by hundreds.
 */
const PINNED_MARGIN_PX = 120;

/** Every dimension must be a positive finite number, or the reading is not something to conclude from. */
function readable(r: WindowGeometryReading): boolean {
  const values = [
    r.innerWidth,
    r.innerHeight,
    r.outerWidth,
    r.outerHeight,
    r.screenAvailWidth,
    r.screenAvailHeight,
    r.devicePixelRatio,
  ];
  return values.every((v) => Number.isFinite(v) && v > 0);
}

/** Pure: what one reading says. Separated from the launch so it is unit-tested without a browser. */
export function classifyGeometry(r: WindowGeometryReading): GeometryVerdict {
  if (!readable(r)) return "UNREADABLE";
  const pinned = r.outerWidth - r.innerWidth > PINNED_MARGIN_PX || r.outerHeight - r.innerHeight > PINNED_MARGIN_PX;
  if (pinned) return "VIEWPORT_PINNED_BELOW_WINDOW";
  if (r.screenAvailWidth - r.outerWidth > PINNED_MARGIN_PX) return "WINDOW_SMALLER_THAN_SCREEN";
  return "VIEWPORT_FOLLOWS_WINDOW";
}

/**
 * Read as a STRING so esbuild's `keepNames` shim (`__name`) can never be serialized into the page — the same
 * reason the issuance driver evaluates strings. Reads seven numbers and nothing else.
 */
export const GEOMETRY_READ_SCRIPT = `(() => ({
  innerWidth: window.innerWidth,
  innerHeight: window.innerHeight,
  outerWidth: window.outerWidth,
  outerHeight: window.outerHeight,
  screenAvailWidth: window.screen ? window.screen.availWidth : 0,
  screenAvailHeight: window.screen ? window.screen.availHeight : 0,
  devicePixelRatio: window.devicePixelRatio
}))()`;

/** The probe's OWN profile directory — never the walk's, which a live run may hold a lock on. */
export function geometryProbeProfileDir(collectorRoot: string): string {
  return resolveProfileDir(resolve(collectorRoot, ".profile", "window-geometry-probe"), collectorRoot);
}

/**
 * The launch options each mode uses, built from the walk's own {@link buildLaunchOptions} so a drift in the
 * shipped policy shows up here rather than being modelled twice. Pure — returns options, launches nothing.
 */
export function geometryLaunchOptions(mode: GeometryLaunchMode, channel?: string): Record<string, unknown> {
  // FOLLOWS_WINDOW is the SHIPPED policy, taken from the shipped builder rather than modelled here — so if the
  // policy ever drifts, this probe measures the drift instead of a copy of what it used to be.
  if (mode === "FOLLOWS_WINDOW") return { ...buildLaunchOptions(channel, { followWindow: true }) };
  const base: Record<string, unknown> = { ...buildLaunchOptions(channel) };
  // MAXIMIZED models the operator dragging the window out themselves: a big window, and the metrics override
  // still in place. It exists to show that the window is not what decides the layout.
  if (mode === "MAXIMIZED") base["args"] = ["--start-maximized"];
  return base;
}

/** Live-only: launch one mode, read the geometry, close. Never navigates — `about:blank` is all it reads. */
async function measure(mode: GeometryLaunchMode, profileDir: string, channel?: string): Promise<WindowGeometryReading> {
  const { chromium } = await import("playwright");
  const ctx = await chromium.launchPersistentContext(profileDir, geometryLaunchOptions(mode, channel));
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    // Let the window manager finish opening/maximizing before anything is read.
    await page.waitForTimeout(1_200);
    const raw = (await (page as unknown as { evaluate<T>(s: string): Promise<T> }).evaluate<
      Omit<WindowGeometryReading, "mode">
    >(GEOMETRY_READ_SCRIPT)) as Omit<WindowGeometryReading, "mode">;
    return { mode, ...raw };
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const collectorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const profileDir = geometryProbeProfileDir(collectorRoot);
  mkdirSync(profileDir, { recursive: true });
  const channel = process.env.COLLECTOR_BROWSER_CHANNEL?.trim() || undefined;
  console.error("Window geometry probe — local only. It opens about:blank three times and reads seven numbers.");
  for (const mode of GEOMETRY_LAUNCH_MODES) {
    const reading = await measure(mode, profileDir, channel);
    console.log(JSON.stringify({ ...reading, verdict: classifyGeometry(reading) }));
  }
}

// Live path ONLY when invoked directly (inert on import), so the unit suite launches nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
