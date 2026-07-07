import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pollHumanCompletionsOnce, type HumanCompletable } from "../../src/cli/local-agent";
import { humanSignalPathFor } from "../../src/agent/local-agent-human-signal";
import type { UserActionCategory } from "../../src/agent/progressive-reconnect";

/** A fake retained service: records each humanCompleted call and returns a scripted state per connection. */
function fakeStartup(states: Record<string, string | null>): { s: HumanCompletable; calls: Array<{ id: string; action: string }> } {
  const calls: Array<{ id: string; action: string }> = [];
  return {
    calls,
    s: {
      async humanCompleted(connectionId, action) {
        calls.push({ id: connectionId, action });
        const v = states[connectionId];
        return v == null ? null : { localAgentState: v };
      },
    },
  };
}

function pendingMap(entries: Array<[string, UserActionCategory]>): Map<string, UserActionCategory> {
  return new Map<string, UserActionCategory>(entries);
}

describe("pollHumanCompletionsOnce — human-completed production trigger", () => {
  let dir: string;
  let statusFile: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "la-hc-"));
    mkdirSync(join(dir, ".status"));
    statusFile = join(dir, ".status", "naver.json");
    vi.spyOn(console, "log").mockImplementation(() => {}); // silence the sanitized reverify line
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("A's sentinel calls humanCompleted(A) exactly once, consumes+deletes it, and never triggers B", async () => {
    const { s, calls } = fakeStartup({ A: "READY" });
    const pending = pendingMap([["A", "SELECT_SAVED_CREDENTIAL"], ["B", "ENTER_MISSING_USERNAME"]]);
    const sigA = humanSignalPathFor(statusFile, "A");
    writeFileSync(sigA, "");
    await pollHumanCompletionsOnce(s, statusFile, pending);
    expect(calls).toEqual([{ id: "A", action: "SELECT_SAVED_CREDENTIAL" }]); // A once; B never
    expect(existsSync(sigA)).toBe(false); // consumed + deleted
    expect(pending.has("A")).toBe(false); // verified LOGGED_IN (READY) → dropped
    expect(pending.has("B")).toBe(true); // untouched
  });

  it("successful reinspection reaches LOGGED_IN (READY drops); unsuccessful stays NEEDS_USER_ACTION", async () => {
    const { s } = fakeStartup({ A: "WAITING_FOR_CREDENTIAL_SELECTION" }); // not READY
    const pending = pendingMap([["A", "SELECT_SAVED_CREDENTIAL"]]);
    writeFileSync(humanSignalPathFor(statusFile, "A"), "");
    await pollHumanCompletionsOnce(s, statusFile, pending);
    expect(pending.has("A")).toBe(true); // remains pending for a later signal
  });

  it("no sentinel → no humanCompleted call (never inferred from elapsed time)", async () => {
    const { s, calls } = fakeStartup({ A: "READY" });
    const pending = pendingMap([["A", "SELECT_SAVED_CREDENTIAL"]]);
    await pollHumanCompletionsOnce(s, statusFile, pending);
    expect(calls).toEqual([]);
    expect(pending.has("A")).toBe(true);
  });
});
