/**
 * **The serialized program for the one unattended recipe, and the strict reading of what it says.**
 *
 * Mirrors `coupang-review-executor` deliberately: the same preamble, the same «plan as inlined JSON, runtime as
 * a stringified function, exactly one `ASIDE_RESULT` line» shape, so the existing empty-VM guard applies to this
 * program unchanged — it closes over nothing from this package and can reach nothing but the tab primitives.
 *
 * The parse is where the safety is. An off-shape answer is `null`, never a success with missing halves: a run
 * that returns something unreadable must not be able to land as «observed, 0 items», because that sentence is
 * indistinguishable on screen from a surface that really is empty. The caller turns `null` into a failure with
 * no count, which is the same rule the observation schema enforces in SQL.
 */
import { FIXTURE_OBSERVE_RECIPE_ID, type FixtureObserveWorkflow } from "./fixture-observe-workflow";

/** Mirrors `aside-export-executor`'s preamble, and for the same reason: esbuild `keepNames` under tsx. */
export const FIXTURE_RUNTIME_PREAMBLE = "const __name = (target, _value) => target;" as const;

export interface FixtureObservePlan {
  readonly entryUrl: string;
  readonly settleTimeoutMs: number;
}

export function buildFixtureObservePlan(workflow: FixtureObserveWorkflow): FixtureObservePlan {
  return { entryUrl: workflow.entryUrl, settleTimeoutMs: workflow.settleTimeoutMs };
}

export function buildFixtureObserveProgram(plan: FixtureObservePlan): string {
  const fn = asideFixtureObserveRuntime.toString();
  return [
    FIXTURE_RUNTIME_PREAMBLE,
    `const __plan = ${JSON.stringify(plan)};`,
    `const __run = (${fn});`,
    `const __result = await __run(__plan, { openTab, closeTab });`,
    `console.log("ASIDE_RESULT " + JSON.stringify(__result));`,
  ].join("\n");
}

const RUNTIME_CODES = ["SURFACE_UNREADABLE", "RUNTIME_FAULT"] as const;
const RUNTIME_STAGES = ["PREPARE", "NAVIGATE", "READ"] as const;

/** One item the owned surface printed. Synthetic by construction: this page holds no customer's words. */
export interface FixtureObservedItem {
  readonly ref: string;
  readonly state: string;
}

export type FixtureObserveResult =
  | { ok: true; items: readonly FixtureObservedItem[]; elapsedMs: number }
  | { ok: false; code: (typeof RUNTIME_CODES)[number]; stage: (typeof RUNTIME_STAGES)[number]; elapsedMs: number };

/**
 * Shape-check what came back. Anything unexpected is `null` — including a success whose `items` is not an
 * array of well-formed entries, because a half-read page is not an empty page.
 */
export function parseFixtureObserveResult(raw: unknown): FixtureObserveResult | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r["ok"] === true) {
    const items = r["items"];
    if (!Array.isArray(items)) return null;
    const parsed: FixtureObservedItem[] = [];
    for (const entry of items) {
      if (entry === null || typeof entry !== "object") return null;
      const e = entry as Record<string, unknown>;
      if (typeof e["ref"] !== "string" || typeof e["state"] !== "string") return null;
      if (e["ref"].length === 0 || e["ref"].length > 64 || e["state"].length > 32) return null;
      parsed.push({ ref: e["ref"], state: e["state"] });
    }
    return { ok: true, items: parsed, elapsedMs: num(r["elapsedMs"]) };
  }
  if (r["ok"] !== false) return null;
  const code = r["code"];
  const stage = r["stage"];
  if (typeof code !== "string" || !(RUNTIME_CODES as readonly string[]).includes(code)) return null;
  if (typeof stage !== "string" || !(RUNTIME_STAGES as readonly string[]).includes(stage)) return null;
  return {
    ok: false,
    code: code as (typeof RUNTIME_CODES)[number],
    stage: stage as (typeof RUNTIME_STAGES)[number],
    elapsedMs: num(r["elapsedMs"]),
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** The recipe this executor serializes. Named here so a caller cannot serialize a program for anything else. */
export const FIXTURE_OBSERVE_EXECUTOR_RECIPE = FIXTURE_OBSERVE_RECIPE_ID;

/**
 * Runs inside Aside, in an empty context with only `openTab`/`closeTab`. Reads the owned surface's declared
 * items through a count-guarded handle and returns them. It authors no page script and names no DOM API of its
 * own beyond the tab primitives the host provides.
 */
async function asideFixtureObserveRuntime(
  plan: FixtureObservePlan,
  tabs: {
    openTab: (url: string) => Promise<{
      locator: (selector: string) => {
        count: () => Promise<number>;
        nth: (i: number) => { getAttribute: (name: string) => Promise<string | null> };
      };
      waitForTimeout?: (ms: number) => Promise<void>;
    }>;
    closeTab: (tab: unknown) => Promise<void>;
  },
): Promise<FixtureObserveResult> {
  const startedAt = Date.now();
  let tab: Awaited<ReturnType<typeof tabs.openTab>> | null = null;
  try {
    tab = await tabs.openTab(plan.entryUrl);
    if (tab.waitForTimeout) await tab.waitForTimeout(Math.min(plan.settleTimeoutMs, 2_000));
    const rows = tab.locator("[data-co-item]");
    const total = await rows.count();
    if (total === 0) {
      const marker = tab.locator("[data-co-surface]");
      // The surface states its own presence. No marker means the page is not the one we own, and «no items»
      // would then be a claim about a page we never read.
      if ((await marker.count()) === 0) {
        return { ok: false, code: "SURFACE_UNREADABLE", stage: "READ", elapsedMs: Date.now() - startedAt };
      }
    }
    const items: FixtureObservedItem[] = [];
    for (let i = 0; i < total; i += 1) {
      const row = rows.nth(i);
      const ref = await row.getAttribute("data-co-item");
      const state = await row.getAttribute("data-co-state");
      if (ref === null || state === null) {
        return { ok: false, code: "SURFACE_UNREADABLE", stage: "READ", elapsedMs: Date.now() - startedAt };
      }
      items.push({ ref, state });
    }
    return { ok: true, items, elapsedMs: Date.now() - startedAt };
  } catch {
    return { ok: false, code: "RUNTIME_FAULT", stage: "NAVIGATE", elapsedMs: Date.now() - startedAt };
  } finally {
    if (tab !== null) {
      try {
        await tabs.closeTab(tab);
      } catch {
        // A tab we cannot close is not a reading we can improve.
      }
    }
  }
}
