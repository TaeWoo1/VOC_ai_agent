/**
 * **Guided Reply is a capability of a shipped build, not of a dev server** — pinned by reading the source.
 *
 * The live runtime that fills a composer is reached through three modules: this lane's connect
 * (`replyBridge.ts`), its shared lease (`replyConnection.ts`) and its owner (`useReplyRuntime.ts`). None of
 * them may re-acquire a build-mode gate. The one that used to exist refused with `bridge-disabled` before
 * touching the network in every shipped build, which made the guided lane structurally unreachable — not
 * "unavailable until an agent hosts it", but unreachable even when one did.
 *
 * This test exists because that is not a hypothetical regression: a 2026-09-05 walkthrough read a STALE
 * COMMENT saying the lane was DEV-only and reported it to the product owner as a pilot blocker. A sentence
 * cannot be trusted about this; the source can.
 *
 * The simulated fallback in `replyRuntime.ts` is deliberately NOT covered — it is dev-only on purpose, and
 * production resolving `null` there is what keeps a shipped build from simulating a run nobody ran.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCsp } from "../../security/csp";

const HERE = resolve(__dirname);
const LIVE_RUNTIME_MODULES = ["replyBridge.ts", "replyConnection.ts", "useReplyRuntime.ts"];

/** Source with comment lines stripped: prose about a flag is not a use of it. */
function code(file: string): string {
  return readFileSync(resolve(HERE, file), "utf8")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

describe("the guided-reply runtime is not gated on the build mode", () => {
  for (const file of LIVE_RUNTIME_MODULES) {
    it(`${file} does not consult DEV, the fixture flag, or the dev bridge flag`, () => {
      const src = code(file);
      expect(src).not.toContain("env.DEV");
      expect(src).not.toContain("import.meta.env.DEV");
      expect(src).not.toContain("VITE_AW_BRIDGE");
      expect(src).not.toContain("isBridgeModeEnabled");
      expect(src).not.toContain("isFixturePreviewEnabled");
    });
  }

  it("what a shipped build DOES need is the helper origin in its CSP — and that is one build flag", () => {
    // Without it the browser blocks the helper's http and websocket, and the guided lane degrades to
    // the manual handoff no matter what the runtime code does.
    const off = buildCsp({});
    expect(off).not.toContain("127.0.0.1:47615");
    const on = buildCsp({ VITE_ENABLE_AGENT_BRIDGE: "true", VITE_BRIDGE_URL: "http://127.0.0.1:47615" });
    expect(on).toContain("http://127.0.0.1:47615");
    expect(on).toContain("ws://127.0.0.1:47615");
  });
});
