/**
 * The selector-discovery CLI's gate and its incapacity. A reviewer found this CLI — the FIRST one an
 * operator would run live — had no source guard and no gate test at all.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  DISCOVERY_PRODUCTION_REFUSAL,
  discoveryRefusal,
} from "../../instruments/live-runs/run-chrome-selector-discovery-live-naver";
import {
  APPROVAL_FLAG,
  NO_INGEST_FLAG,
  REPLY_APPROVAL_FLAG,
  REVIEW_ID_PROBE_FLAG,
  SESSION_RECOVERY_FLAG,
} from "../../src/cli/live-run-approval";

const HERE = dirname(fileURLToPath(import.meta.url));
const PATH = resolve(HERE, "../../instruments/live-runs/run-chrome-selector-discovery-live-naver.ts");
const code = readFileSync(PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
  .join("\n");

const OK = [REVIEW_ID_PROBE_FLAG];

describe("discoveryRefusal", () => {
  it("allows the read-only grant", () => {
    expect(discoveryRefusal(OK, {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("refuses with no flag, and names ITS OWN cli", () => {
    const r = discoveryRefusal([], {} as NodeJS.ProcessEnv);
    expect(r?.exitCode).toBe(3);
    // A reviewer found it printing the store-identity diagnostic's message, which told the
    // operator to run a DIFFERENT live tool.
    expect(r?.reason).toContain("run-chrome-selector-discovery-live-naver");
    expect(r?.reason).not.toContain("run-store-identity-diagnostic");
  });

  it.each([
    ["reply", REPLY_APPROVAL_FLAG],
    ["export", APPROVAL_FLAG],
    ["no-ingest", NO_INGEST_FLAG],
    ["session-recovery", SESSION_RECOVERY_FLAG],
    ["classify-only", "--classify-only"],
  ])("refuses the %s flag rather than accepting a stronger grant", (_l, flag) => {
    expect(discoveryRefusal([flag], {} as NodeJS.ProcessEnv)?.exitCode).toBe(6);
    // Ordering: the read-only grant must not short-circuit the refusal.
    expect(discoveryRefusal([...OK, flag], {} as NodeJS.ProcessEnv)?.exitCode).toBe(6);
  });

  it("refuses under NODE_ENV=production", () => {
    const r = discoveryRefusal(OK, { NODE_ENV: "production" } as NodeJS.ProcessEnv);
    expect(r?.reason).toBe(DISCOVERY_PRODUCTION_REFUSAL);
    expect(r?.exitCode).toBe(4);
  });
});

describe("discovery CLI — source guard (cannot bind, cannot submit)", () => {
  it.each([".click(", ".type(", ".fill(", ".press(", ".check(", ".selectOption(", ".keyboard", ".submit("])(
    "never contains %s",
    (token) => {
      expect(code).not.toContain(token);
    },
  );

  it.each([".goBack(", ".goForward(", ".reload(", "waitForNavigation", "window.open"])(
    "never drives navigation (%s)",
    (token) => {
      expect(code).not.toContain(token);
    },
  );

  it("navigates exactly once, and only to the configured URL", () => {
    const gotos = code.split("\n").filter((l) => l.includes(".goto("));
    expect(gotos).toHaveLength(1);
    expect(gotos[0]).toContain("cfg.naverReviewUrl");
  });

  it.each([
    ["the connection store", "connection/store"],
    ["a session binding", "session-chrome-binding"],
    ["the account binding", "session-chrome-binding"],
    ["the backend client", "../upload"],
    ["a review lookup", "review-id-locator"],
    ["the composer", "reply-composer-inpage"],
  ])("cannot reach %s — the module is not imported (%s)", (_l, mod) => {
    // Whole-file, not `startsWith("import")`: a multi-line import puts the specifier on
    // the `} from …` line, which that filter drops.
    expect(code).not.toContain(`"${mod}"`);
    expect(code).not.toContain(`'${mod}'`);
  });

  it("uses no dynamic import, which would sidestep the check above", () => {
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toContain("require(");
  });

  it("persists specifications and nothing else", () => {
    // The only writer is the spec store; the observed user id must never be written or echoed.
    expect(code).toContain("saveSelectorSpecs(storePath, accepted)");
    expect(code).not.toContain("observedUserId");
  });

  it("evaluates only vetted in-page scripts", () => {
    const calls = code.match(/evalOn(?:<[^>]*>)?\(\s*[A-Za-z0-9_.]+\s*,\s*([^,)]+)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const arg = call.slice(call.lastIndexOf(",") + 1).trim();
      expect(arg, `ad-hoc script: ${arg}`).toMatch(/^[A-Za-z_$][A-Za-z0-9_$.]*(\(|$)/);
    }
  });

  it("requires a re-render before accepting anything", () => {
    // A selector proven exactly once is not proven; the operator causes the re-render.
    expect(code).toContain("rerenderSentinel");
    const body = code.slice(code.indexOf("async function main("));
    expect(body.indexOf("rerenderSentinel")).toBeLessThan(body.indexOf("saveSelectorSpecs"));
  });
});
