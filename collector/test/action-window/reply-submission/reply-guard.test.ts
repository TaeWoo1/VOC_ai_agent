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
  REPLY_FIXTURE_HINT,
  fixtureLocateDecision,
  fixtureRowLocateDecision,
} from "../../../src/action-window/reply-submission/reply-fixture";
import { NaverReplySubmitProbeDriver, type ReplyPageLike } from "../../../src/action-window/reply-submission/naver-reply-driver";
import { reviewRowLocateDecision } from "../../../src/action-window/reply-submission/reply-surface";
import {
  normalizeForFingerprint,
  reviewBodyFingerprint,
} from "../../../src/action-window/reply-submission/review-body-fingerprint";

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

  // The row seam is now EVIDENCE-BACKED by the operator-calibrated mapping: it addresses rows by relative
  // structural paths over the GENERIC container groups and invents NO NAVER-specific selector/class/host.
  it.each(["data-review-row", "smartstore", "sell.naver", "reviewItem", ".review_"])(
    "invents no NAVER-specific selector/class/host (%s)",
    (token) => {
      expect(code).not.toContain(token);
    },
  );
  it("addresses rows through the operator-calibrated mapping (structural), never a hardcoded selector", () => {
    expect(code).toContain("mapping");
    expect(code).toContain("inPageRowCensus");
  });
});

describe("naver reply driver — the guided row seam is fail-closed when UNMAPPED (no calibration artifact)", () => {
  const stubPage: ReplyPageLike = {
    url: () => "about:blank",
    content: () => Promise.resolve(""),
    evaluate: () => Promise.reject(new Error("the fail-closed row seam must never touch the page")),
    waitForFunction: () => Promise.reject(new Error("the fail-closed row seam must never touch the page")),
  };

  it("locateReviewRow reports zero rows (→ engine TARGET_NOT_FOUND) and waitForRowOpen never fires", async () => {
    const driver = new NaverReplySubmitProbeDriver(stubPage);
    expect(await driver.locateReviewRow()).toEqual({ count: 0 });
    expect(await driver.highlightRow()).toEqual({ count: 0 });
    expect(await driver.waitForRowOpen()).toBe(false);
  });
});

describe("reply runtime — privacy: the GUIDED row path leaks no raw date/product/fingerprint", () => {
  it("the located ROW signature is opaque 16-hex, not the fingerprint or any canary", () => {
    const decision = fixtureRowLocateDecision("rows-present");
    expect(decision.count).toBe(1);
    expect(decision.sig).toMatch(/^[0-9a-f]{16}$/);
    expect(decision.sig).not.toContain(REPLY_FIXTURE_HINT.bodyFingerprint);
    for (const canary of REPLY_FIXTURE_CANARIES) expect(decision.sig).not.toContain(canary);
  });

  it("the row sig encodes only structural position — a hint field (rating) is NOT brute-forceable from it", () => {
    // Same matched index, different rating → identical sig ⇒ the private `rating` is not in the sig input.
    const sigFor = (rating: number) =>
      reviewRowLocateDecision(
        { rating, recencyBucket: "TODAY", bodyFingerprint: "fp" },
        [{ rating, recencyBucket: "TODAY", bodyFingerprint: "fp" }],
      ).sig;
    expect(sigFor(2)).toBe(sigFor(5));
  });

  it("a full guided run's events + view carry no canary and never the bodyFingerprint match key", () => {
    const engine = new ReplyEngine(
      { runId: "run_reply_guided_priv", channelCode: "naver", targetHint: REPLY_FIXTURE_HINT },
      { clock: makeReplyClock() },
    );
    const row = { count: 1, sig: "abcd1234abcd1234" };
    engine.command({ type: "START_RUN", expectedRevision: 0 });
    engine.onSurfaceReady(true);
    engine.onRowLocated(row);
    engine.onRowHighlighted(row);
    engine.onRowOpened();
    engine.onLocated({ count: 1, sig: "dcba4321dcba4321" });
    engine.onHighlighted();
    engine.command({ type: "REQUEST_STEP_RECHECK", expectedRevision: engine.view().revision });

    const wire = JSON.stringify({ events: engine.events(), view: engine.view() });
    for (const canary of REPLY_FIXTURE_CANARIES) expect(wire, `leaked ${canary}`).not.toContain(canary);
    expect(wire).not.toContain(REPLY_FIXTURE_HINT.bodyFingerprint);
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
    "review-body-fingerprint.ts": resolve(SRC, "review-body-fingerprint.ts"),
    "reply-target-bundle.ts": resolve(SRC, "reply-target-bundle.ts"),
    // Operator-assisted live-match slice: in-page scripts + calibration + mapping/cross-source + calibration CLI.
    "review-body-fingerprint-inpage.ts": resolve(SRC, "review-body-fingerprint-inpage.ts"),
    "reply-row-inpage.ts": resolve(SRC, "reply-row-inpage.ts"),
    "reply-calibrate-inpage.ts": resolve(SRC, "reply-calibrate-inpage.ts"),
    "reply-row-mapping-artifact.ts": resolve(SRC, "reply-row-mapping-artifact.ts"),
    "reply-cross-source.ts": resolve(SRC, "reply-cross-source.ts"),
    "handle-reply-row-driver.ts": resolve(SRC, "handle-reply-row-driver.ts"),
    "calibrate-reply-target.ts": resolve(SRC, "../../../src/cli/calibrate-reply-target.ts"),
    // Composer abort rehearsal: the retained-composer driver + its in-page scripts (read-only, no submit).
    "handle-reply-composer-driver.ts": resolve(SRC, "handle-reply-composer-driver.ts"),
    "reply-composer-inpage.ts": resolve(SRC, "reply-composer-inpage.ts"),
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

/**
 * The prepare-reply-target CLI is a backend-auth PREP tool, not the live reply runtime: it authenticates to
 * the SellerOps backend (loopback in dev) to mint a submissionRef and write the owner-only result bundle. It
 * legitimately imports the backend client (`../upload`) — so the "no ingest import" rule does NOT apply to it
 * — but it still must NEVER submit/type/click a composer (it touches no page at all).
 */
describe("prepare-reply-target CLI — source guard (no submit/type/click; backend-prep only)", () => {
  const code = codeOnly(resolve(SRC, "../../../src/cli/prepare-reply-target.ts"));
  it.each(NO_SUBMIT_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });
});

/**
 * The same-session abort-rehearsal CLI legitimately imports the backend client (`../upload`) to mint the one-shot
 * submissionRef (so the "no downstream import" rule does NOT apply), but it must NEVER submit/type/click a NAVER
 * control — it captures the operator's own click (preventDefault) and highlights the retained element read-only.
 */
describe("run-abort-rehearsal-live-naver CLI — source guard (no submit/type/click)", () => {
  const code = codeOnly(resolve(SRC, "../../../src/cli/run-abort-rehearsal-live-naver.ts"));
  it.each(NO_SUBMIT_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });
});

/**
 * The same-session COMPOSER abort-rehearsal CLI legitimately imports the backend client (`../upload`) to mint
 * the one-shot submissionRef and to READ the operator's own approved draft for the read-only overlay (so the
 * "no downstream import" rule does NOT apply), but it must NEVER submit/type/paste/click a NAVER control — it
 * captures the operator's own clicks (preventDefault), observes the entry transition, and highlights the
 * retained row + composer read-only.
 */
describe("run-composer-abort-rehearsal-live-naver CLI — source guard (no submit/type/click)", () => {
  const code = codeOnly(resolve(SRC, "../../../src/cli/run-composer-abort-rehearsal-live-naver.ts"));
  it.each(NO_SUBMIT_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });
});

describe("review-body-fingerprint — privacy: volatile PII is tokenized, no raw span survives", () => {
  it("tokenizes url/email/phone/long-number and never leaks the raw span; the output is an opaque 64-hex", () => {
    const norm = normalizeForFingerprint("환불 http://x.kr 메일 a@b.com 연락 010-1234-5678 주문 1234567890");
    for (const tok of ["[링크]", "[이메일]", "[전화번호]", "[번호]"]) expect(norm).toContain(tok);
    for (const raw of ["x.kr", "a@b.com", "010-1234-5678", "1234567890"]) expect(norm).not.toContain(raw);
    expect(reviewBodyFingerprint("샘플 본문")).toMatch(/^[0-9a-f]{64}$/);
  });
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
