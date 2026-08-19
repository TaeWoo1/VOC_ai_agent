/**
 * Boundary proofs for the ISOLATED reply-submission runtime:
 *  - a SOURCE GUARD that the live NAVER reply driver never submits/types and imports no
 *    downstream/legacy-capture path (comment lines stripped first, per collector conventions);
 *  - a PRIVACY sweep that hostile fixture content never crosses the sanitized v2 boundary.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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
  "../../src/upload",
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
    "run-reply-submission-live-naver.ts": resolve(SRC, "../../../instruments/live-runs/run-reply-submission-live-naver.ts"),
    "review-body-fingerprint.ts": resolve(SRC, "review-body-fingerprint.ts"),
    "reply-target-bundle.ts": resolve(SRC, "reply-target-bundle.ts"),
    // Operator-assisted live-match slice: in-page scripts + calibration + mapping/cross-source + calibration CLI.
    "review-body-fingerprint-inpage.ts": resolve(SRC, "review-body-fingerprint-inpage.ts"),
    "reply-row-inpage.ts": resolve(SRC, "reply-row-inpage.ts"),
    "reply-calibrate-inpage.ts": resolve(SRC, "reply-calibrate-inpage.ts"),
    "reply-row-mapping-artifact.ts": resolve(SRC, "reply-row-mapping-artifact.ts"),
    "reply-cross-source.ts": resolve(SRC, "reply-cross-source.ts"),
    "handle-reply-row-driver.ts": resolve(SRC, "handle-reply-row-driver.ts"),
    "calibrate-reply-target.ts": resolve(SRC, "../../../instruments/calibration/calibrate-reply-target.ts"),
    // Composer abort rehearsal: the retained-composer driver + its in-page scripts (read-only, no submit).
    "handle-reply-composer-driver.ts": resolve(SRC, "handle-reply-composer-driver.ts"),
    "reply-composer-inpage.ts": resolve(SRC, "reply-composer-inpage.ts"),
    // Review-id reconciliation: the identity contract, the exact locator, and the read-only discovery ladder.
    "review-id-fingerprint.ts": resolve(SRC, "review-id-fingerprint.ts"),
    "review-id-fingerprint-inpage.ts": resolve(SRC, "review-id-fingerprint-inpage.ts"),
    "review-id-locator.ts": resolve(SRC, "review-id-locator.ts"),
    "review-id-network-scan.ts": resolve(SRC, "review-id-network-scan.ts"),
    "review-id-probe-inpage.ts": resolve(SRC, "review-id-probe-inpage.ts"),
    // Guided reply session: the session seller/store preflight and its read-only identity evidence.
    "session-account-identity.ts": resolve(SRC, "session-account-identity.ts"),
    "session-account-probe-inpage.ts": resolve(SRC, "session-account-probe-inpage.ts"),
    "session-account-verify.ts": resolve(SRC, "session-account-verify.ts"),
    "seller-account-fingerprint.ts": resolve(SRC, "../../../src/connection/seller-account-fingerprint.ts"),
    "session-signals.ts": resolve(SRC, "session-signals.ts"),
    "store-identity-diagnostic.ts": resolve(SRC, "store-identity-diagnostic.ts"),
    // Composite seller-center chrome identity — the primary session identity.
    "session-chrome-identity.ts": resolve(SRC, "session-chrome-identity.ts"),
    "session-chrome-binding.ts": resolve(SRC, "session-chrome-binding.ts"),
    "chrome-identity-inpage.ts": resolve(SRC, "chrome-identity-inpage.ts"),
    // Operator-calibrated selector discovery: the spec contract, its store, and the derivation script.
    "chrome-selector-spec.ts": resolve(SRC, "chrome-selector-spec.ts"),
    "chrome-selector-store.ts": resolve(SRC, "chrome-selector-store.ts"),
    "chrome-selector-derive-inpage.ts": resolve(SRC, "chrome-selector-derive-inpage.ts"),
    // Pre-existing surface, swept here too now that the guard enumerates the directory rather than a
    // hand-kept list. `naver-reply-driver.ts` also has its own dedicated suite above.
    "naver-reply-driver.ts": resolve(SRC, "naver-reply-driver.ts"),
    "reply-driver.ts": resolve(SRC, "reply-driver.ts"),
    "reply-engine.ts": resolve(SRC, "reply-engine.ts"),
    "reply-fixture.ts": resolve(SRC, "reply-fixture.ts"),
    "reply-session.ts": resolve(SRC, "reply-session.ts"),
    "reply-stages.ts": resolve(SRC, "reply-stages.ts"),
    "reply-surface.ts": resolve(SRC, "reply-surface.ts"),
  };

  // The map above is hand-maintained, so a NEW module is unguarded until someone remembers to add it — and
  // the most safety-critical module in this milestone was itself missing from it when a reviewer looked.
  // This makes forgetting fail the build instead of silently widening the seam.
  it("guards EVERY module in the reply-submission surface, by enumeration", () => {
    // Scoping the sweep to `session-*` left module-level state one rename away: a reviewer put a mutable
    // singleton in `account-shell-hint.ts`, imported it from `session-signals.ts`, and the suite stayed
    // green. A filename pattern is not a boundary; the directory is.
    const onDisk = readdirSync(SRC)
      .filter((f) => f.endsWith(".ts"))
      .sort();
    const guarded = Object.keys(files).sort();
    const unguarded = onDisk.filter((f) => !guarded.includes(f));
    expect(unguarded, `unguarded modules in ${SRC}`).toEqual([]);
  });

  for (const [name, path] of Object.entries(files)) {
    const code = codeOnly(path);
    it.each(NO_SUBMIT_TOKENS)(`${name} never contains %s`, (token) => {
      expect(code).not.toContain(token);
    });
    it.each(NO_DOWNSTREAM_IMPORTS)(`${name} imports no downstream/legacy-capture path (%s)`, (mod) => {
      // Whole-file, not `startsWith("import")`: a multi-line import puts the specifier on the `} from …`
      // line, which that filter drops.
      expect(code).not.toContain(`"${mod}"`);
      expect(code).not.toContain(`'${mod}'`);
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
  const code = codeOnly(resolve(SRC, "../../../instruments/live-runs/run-abort-rehearsal-live-naver.ts"));
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
  const code = codeOnly(resolve(SRC, "../../../instruments/live-runs/run-composer-abort-rehearsal-live-naver.ts"));
  it.each(NO_SUBMIT_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });
});

/**
 * The read-only review-id probe CLI holds the WEAKEST authorization in the runtime, and its guard is
 * correspondingly the strictest. It legitimately imports the backend client (`../upload`) to read the
 * identity fingerprint, so the "no downstream import" rule does not apply — but beyond never
 * submitting/typing/clicking, it must not navigate after the session is opened, and it must not reach the
 * composer surface at all.
 */
describe("run-review-id-reconciliation-live-naver CLI — source guard (read-only, single goto, no composer)", () => {
  const path = resolve(SRC, "../../../instruments/live-runs/run-review-id-reconciliation-live-naver.ts");
  const code = codeOnly(path);

  it.each(NO_SUBMIT_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });

  it.each([".goBack(", ".goForward(", ".reload(", "waitForNavigation", "window.open"])(
    "never drives navigation (%s)",
    (token) => {
      expect(code).not.toContain(token);
    },
  );

  it("navigates exactly once, and only to the configured review URL", () => {
    const gotos = code.split("\n").filter((l) => l.includes(".goto("));
    expect(gotos).toHaveLength(1);
    expect(gotos[0]).toContain("cfg.naverReviewUrl");
  });

  // The word "composer" appears in the operator-facing prose ("never ... opens a composer"), which is the
  // point; what must be absent is any composer MACHINERY.
  it.each([
    "reply-composer-inpage",
    "handle-reply-composer-driver",
    "ARM_COMPOSER_CAPTURE",
    "renderDraftOverlay",
    "fetchApprovedReplyDraft",
  ])("never reaches the composer surface — this milestone stops at the row (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it("imports only the read-only identity reader from the backend client", () => {
    const uploadImport = code
      .split("\n")
      .filter((l) => l.includes('from "../../src/upload"'))
      .join("");
    expect(uploadImport).toContain("fetchReviewIdentityFingerprint");
    expect(uploadImport).not.toContain("startReplySubmissionRun");
    expect(uploadImport).not.toContain("submitReplyOutcome");
    expect(uploadImport).not.toContain("uploadReview");
  });
});

/**
 * The guided-session CLI reaches the composer barrier, so it legitimately imports the composer machinery and
 * the backend client. What it must never do is act on NAVER: no submit/type/click, and — like the read-only
 * probe — no navigation of its own. Every page transition after the single opening `goto` is the operator's.
 */
describe("run-guided-reply-session-live-naver CLI — source guard (no submit/type/click, single goto)", () => {
  const path = resolve(SRC, "../../../instruments/live-runs/run-guided-reply-session-live-naver.ts");
  const code = codeOnly(path);

  it.each(NO_SUBMIT_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });

  it.each([".goBack(", ".goForward(", ".reload(", "waitForNavigation", "window.open"])(
    "never drives navigation (%s)",
    (token) => {
      expect(code).not.toContain(token);
    },
  );

  it("navigates exactly once, and only to the configured review URL", () => {
    const gotos = code.split("\n").filter((l) => l.includes(".goto("));
    expect(gotos).toHaveLength(1);
    expect(gotos[0]).toContain("cfg.naverReviewUrl");
  });

  it("builds the run record in a finally, so every fail-closed stop still leaves evidence", () => {
    // Each stop below returns early; a record built after a plain try/finally would be skipped by all of
    // them, and the honest stops are exactly the outcomes this milestone needs evidence for.
    expect(code).toMatch(/\}\s*finally\s*\{\s*const record = buildGuidedRecord/);
  });

  // These four are SOURCE pins, and they are here because the behaviour they protect lives inside a live
  // `main()` that no offline test can drive. A regression that reverted any of them would leave every
  // behavioural test green — which is exactly how the defects they encode survived the first review.
  it("replaces the preflight read with the barrier read before each verdict check", () => {
    // Otherwise an ACCOUNT_DRIFTED record would carry the preflight's MATCH — the exact claim the scope
    // forbids on a stop path.
    const body = code.slice(code.indexOf("async function main("));
    for (const barrier of ["atOutline", "atComposer", "atEntry"]) {
      const assignAt = body.indexOf(`chromeResult = ${barrier}`);
      const checkAt = body.indexOf(`mayProceedAfterChromeIdentity(${barrier}.verification)`);
      expect(assignAt, `${barrier} assignment missing`).toBeGreaterThan(-1);
      expect(checkAt, `${barrier} check missing`).toBeGreaterThan(-1);
      expect(assignAt).toBeLessThan(checkAt);
    }
  });

  it("re-reads BOTH the registry and the page immediately before binding", () => {
    const body = code.slice(code.indexOf("async function main("));
    const promptAt = body.indexOf("waitForEither(bindConfirmedSentinel, stopSentinel");
    // THE NEEDLE ITSELF IS NOW ASSERTED. It previously read `waitForEither(sentinel, stopSentinel`, which
    // matches nothing in this file — so `indexOf` returned -1, `body.indexOf(x, -1)` behaves as
    // `indexOf(x, 0)`, and both "after the prompt" checks were satisfied by the STARTUP registry load and
    // the PREFLIGHT page read. Every assertion passed while the property was entirely unguarded. A source
    // pin that cannot find its own anchor is worse than no pin, because it reads as coverage.
    expect(promptAt, "bind-prompt anchor missing — fix the needle, not the expectation").toBeGreaterThan(-1);
    const bindAt = body.indexOf("bindSessionChromeIdentity({");
    expect(bindAt).toBeGreaterThan(promptAt);
    const registryReread = body.indexOf("loadConnectionRegistryFromFile(storePath)", promptAt);
    const pageReread = body.indexOf("readChromeIdentity(activePage", promptAt);
    // Both must sit between the operator prompt and the bind: the prompt can wait many minutes, and a
    // binding is permanent with no unbind path.
    for (const [name, at] of [["registry", registryReread], ["page", pageReread]] as const) {
      expect(at, `${name} not re-read after the prompt`).toBeGreaterThan(promptAt);
      expect(at).toBeLessThan(bindAt);
    }
  });

  it("clears each sentinel immediately before waiting on it", () => {
    // A gate that can be satisfied BEFORE it is asked is not a gate. Clearing only at startup left a window
    // in which a sentinel created early was already present when its step arrived, so the wait returned at
    // once and the operator never did the thing. Caught live, on the re-render check.
    expect(code).toMatch(/async function waitForFile\([\s\S]{0,600}?removeSentinel\(path\);/);
    expect(code).toMatch(/async function waitForEither\([\s\S]{0,600}?removeSentinel\(a\);\s*removeSentinel\(b\);/);
  });

  it("offers NO inline rebind — a mismatch ends the run", () => {
    // POLICY (product owner): the runtime cannot distinguish a renamed shop from a different seller, so an
    // inline "was it renamed?" affordance asks the operator to certify that mid-reply, and one wrong click
    // writes a permanent binding with no unbind path. Rebinding belongs in a deliberate connection-management
    // flow. The binding path here is first-time ONLY.
    expect(code).not.toContain("rebindConfirmedSentinel");
    expect(code).not.toContain('intent: "rebind"');
    expect(code).toContain('intent: "first-time"');
    const body = code.slice(code.indexOf("async function main("));
    const mismatchAt = body.indexOf('chromeResult.verification.verdict === "MISMATCH"');
    const lookupAt = body.indexOf("locateRowByReviewId(");
    expect(mismatchAt).toBeGreaterThan(-1);
    expect(mismatchAt).toBeLessThan(lookupAt);
  });

  it("never invents a selector — the calibrated specs are LOADED, and their absence stops the run", () => {
    expect(code).toContain("loadSelectorSpecs(defaultSelectorStorePath(collectorRoot))");
    expect(code).toContain("run-chrome-selector-discovery-live-naver");
    // The identity is read only through the loaded specs.
    expect(code).toMatch(/specs\.userId\.map\(\(x\) => x\.selector\)/);
    expect(code).toMatch(/specs\.shopName\.map\(\(x\) => x\.selector\)/);
  });

  it("refuses colliding selectors before reading anything through them", () => {
    // Both fields reading one element yields a composite of a value with itself, which looks perfectly
    // stable and identifies nothing.
    expect(code).toContain("specsCollide(specs)");
  });

  it("never prints or persists the observed user id — anywhere in the file", () => {
    // THE REGRESSION THIS EXISTS FOR: this assertion used to slice the source to two functions, so a
    // `console.error` in main() that printed the user id at the bind prompt passed it vacuously. The value
    // may be READ (the bind step needs it) but must never reach a console or a record.
    const consoleLines = code.split("\n").filter((l) => l.includes("console."));
    for (const line of consoleLines) {
      expect(line, "user id printed").not.toContain("observedUserId");
    }
    const builder = code.slice(code.indexOf("export function buildGuidedRecord("));
    expect(builder).not.toContain("observedUserId");
    // The occurrence CEILING that used to sit here has been removed. A cap on how often an identifier
    // appears is not a leak proof — it says nothing about where the value goes — and it fails on any
    // honest refactor: adding the pre-bind equality check (which makes the binding SAFER by refusing to
    // bind evidence the operator never saw) pushed the count past the cap and broke this test while
    // improving the property it claimed to protect. The two checks above are the substantive ones, and
    // the file-writing check below closes the third sink.
    const writes = code.split("\n").filter((l) => l.includes("writeFileSync"));
    for (const line of writes) {
      expect(line, "user id written to disk").not.toContain("observedUserId");
    }
  });

  it("gates the review lookup behind the preflight inside main(), not just in the imports", () => {
    const body = code.slice(code.indexOf("async function main("));
    expect(body).toContain("mayProceedAfterChromeIdentity");
    const gateAt = body.indexOf("mayProceedAfterChromeIdentity");
    const lookupAt = body.indexOf("locateRowByReviewId(");
    expect(lookupAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(lookupAt);
  });

  it("does not post a backend outcome for a run that stopped on account drift", () => {
    // A drift stop is a safety event; recording an abort against the action would present it as an ordinary
    // operator decision.
    expect(code).toContain("if (operatorOutcome && driftReason === null)");
  });

  it("re-verifies the account at THREE barriers, matching what the record reports", () => {
    const body = code.slice(code.indexOf("async function main("));
    expect((body.match(/reverifiedAtBarriers \+= 1/g) ?? []).length).toBe(3);
  });

  it("takes identity evidence ONLY from the in-page probe, never from raw response text", () => {
    // Raw response text has no provenance: a customer-written review body containing a JSON-looking
    // fragment, or a build-time constant in a shared bundle, would otherwise become the store identity.
    expect(code).not.toContain("session-account-network-scan");
    expect(code).not.toContain('ctx.on("response"');
  });

  it("records a crash as its own terminal rather than as the stage it had reached", () => {
    expect(code).toContain('terminal = "RUN_FAILED"');
  });

});

/**
 * The store-identity diagnostic holds the WEAKEST authorization in the runtime and must be incapable of the
 * things the guided session can do — not merely careful about them. These assert absence of capability by
 * absence of the import, which is the only form of "cannot" a source guard can express honestly.
 */
describe("run-store-identity-diagnostic-live-naver CLI — source guard (cannot bind, look up, or post)", () => {
  const path = resolve(SRC, "../../../instruments/live-runs/run-store-identity-diagnostic-live-naver.ts");
  const code = codeOnly(path);

  it.each(NO_SUBMIT_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });

  it.each([".goBack(", ".goForward(", ".reload(", "waitForNavigation", "window.open"])(
    "never drives navigation (%s)",
    (token) => {
      expect(code).not.toContain(token);
    },
  );

  it("navigates exactly once, and only to the configured review URL", () => {
    const gotos = code.split("\n").filter((l) => l.includes(".goto("));
    expect(gotos).toHaveLength(1);
    expect(gotos[0]).toContain("cfg.naverReviewUrl");
  });

  it.each([
    ["a connection binding", "session-chrome-binding"],
    ["the connection store", "connection/store"],
    ["the account verifier", "session-account-verify"],
    ["a review lookup", "review-id-locator"],
    ["the review ladder", "review-id-probe-inpage"],
    ["the composer", "reply-composer-inpage"],
    ["the composer driver", "handle-reply-composer-driver"],
    ["the backend client", "../../src/upload"],
    ["the reply dispatcher", "reply-dispatch"],
  ])("cannot reach %s — the module is not imported (%s)", (_label, mod) => {
    // Scanning only lines that START with `import` is vacuous here: five of this file's imports are
    // multi-line, so the specifier lives on the `} from "…"` line and was never examined. A reviewer added
    // a multi-line `connection/store` import and every check still reported clean. Scan the whole file, and
    // catch dynamic imports too.
    expect(code).not.toContain(`"${mod}"`);
    expect(code).not.toContain(`'${mod}'`);
  });

  it("uses no dynamic import, which would sidestep the check above", () => {
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toContain("require(");
  });

  it("evaluates only the vetted in-page probe, and reads no page text", () => {
    expect(code).toContain("inPageAccountIdentityProbe()");
    expect((code.match(/\.evaluate</g) ?? [])).toHaveLength(1);
    expect((code.match(/\.evaluate\(/g) ?? [])).toHaveLength(0);
    expect(code).not.toContain("page.content()");
  });

  it("refuses a mutating flag rather than accepting the stronger grant", () => {
    expect(code).toContain("mutatingFlagOnReadOnlyProbeMessage(REPLY_APPROVAL_FLAG)");
    expect(code).toContain("mutatingFlagOnReadOnlyProbeMessage(APPROVAL_FLAG)");
    expect(code).toContain("hasReviewIdProbeApproval");
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
