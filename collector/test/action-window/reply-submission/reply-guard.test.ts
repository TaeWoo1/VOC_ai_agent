/**
 * Boundary proofs for the ISOLATED reply-submission runtime:
 *  - a SOURCE GUARD that the live NAVER reply driver never submits/types and imports no
 *    downstream/legacy-capture path (comment lines stripped first, per collector conventions);
 *  - a PRIVACY sweep that hostile fixture content never crosses the sanitized v2 boundary.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  ReplyEngine,
  makeReplyClock,
} from "../../../src/action-window/reply-submission/reply-engine";
import {
  REPLY_FIXTURE_CANARIES,
  fixtureLocateDecision,
} from "../../../src/action-window/reply-submission/reply-fixture";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../../../src/action-window/reply-submission");

/** Strip block comments and comment/JSDoc lines so prose mentioning a forbidden token never trips. */
function codeOnly(path: string): string {
  const raw = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return raw
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");
}

const NO_SUBMIT_TOKENS = [
  ".click(",
  ".type(",
  ".fill(",
  ".press(",
  ".check(",
  ".selectOption(",
  ".setInputFiles(",
  ".keyboard",
  "dispatchEvent",
  ".submit(",
  ".value =",
  ".value=",
] as const;

const NO_DOWNSTREAM_IMPORTS = [
  "ingest-handoff",
  "review-export",
  "capture-export",
  "runExport",
  "quarantine",
  "../upload",
] as const;

describe("naver reply driver — source guard (no submit, no type, no downstream)", () => {
  const code = codeOnly(resolve(SRC, "naver-reply-driver.ts"));

  it.each(NO_SUBMIT_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_DOWNSTREAM_IMPORTS)("imports no downstream/legacy-capture path (%s)", (mod) => {
    // Scan import lines only.
    const imports = code.split("\n").filter((l) => l.trim().startsWith("import"));
    expect(imports.join("\n")).not.toContain(mod);
  });
});

/**
 * The NEW live-seam surface — the shared dispatch service, the Bridge endpoint, and the gated CLI — must
 * hold the SAME boundary as the driver: it never submits/types/clicks the composer and imports no
 * downstream/ingest path. A reply produces no artifact, so none of these files may reach a capture path.
 */
describe("reply-submission live-seam surface — source guard (dispatch + Bridge endpoint + gated CLI)", () => {
  const files = {
    "reply-dispatch.ts": resolve(SRC, "reply-dispatch.ts"),
    "reply-run-store.ts": resolve(SRC, "reply-run-store.ts"),
    "reply-submission-endpoint.ts": resolve(SRC, "../../../src/bridge/reply-submission-endpoint.ts"),
    "run-reply-submission-live-naver.ts": resolve(SRC, "../../../src/cli/run-reply-submission-live-naver.ts"),
  };

  for (const [name, path] of Object.entries(files)) {
    const code = codeOnly(path);
    it.each(NO_SUBMIT_TOKENS)(`${name} never contains %s`, (token) => {
      expect(code).not.toContain(token);
    });
    it.each(NO_DOWNSTREAM_IMPORTS)(`${name} imports no downstream/legacy-capture path (%s)`, (mod) => {
      const imports = code.split("\n").filter((l) => l.trim().startsWith("import"));
      expect(imports.join("\n")).not.toContain(mod);
    });
  }
});

describe("reply runtime — privacy: hostile fixture content never crosses the boundary", () => {
  it("a full run's events + view carry no canary", () => {
    const engine = new ReplyEngine({ runId: "run_reply_priv", channelCode: "naver" }, { clock: makeReplyClock() });
    engine.command({ type: "START_RUN", expectedRevision: 0 });
    engine.onSurfaceReady(true);
    engine.onLocated(fixtureLocateDecision("composer-present"));
    engine.onHighlighted();
    engine.onUserActionObserved();
    engine.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: engine.view().revision });

    const wire = JSON.stringify({ events: engine.events(), view: engine.view() });
    for (const canary of REPLY_FIXTURE_CANARIES) {
      expect(wire, `leaked canary: ${canary}`).not.toContain(canary);
    }
  });

  it("the located composer signature is an opaque 16-hex, not raw content", () => {
    const decision = fixtureLocateDecision("composer-present");
    expect(decision.count).toBe(1);
    expect(decision.sig).toMatch(/^[0-9a-f]{16}$/);
    for (const canary of REPLY_FIXTURE_CANARIES) {
      expect(decision.sig).not.toContain(canary);
    }
  });
});
