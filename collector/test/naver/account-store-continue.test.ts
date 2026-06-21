import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  confirmAdvancedPostClickState,
  decideContinueGate,
  deriveReachedExportSurface,
  isContentConfirmed,
  pollPostClickUntilAdvanced,
  postClickAdvanced,
  type ContinueGateInput,
  type PostClickObservation,
  type PostClickRead,
} from "../../src/naver/account-store-continue";
import type {
  SanitizedContinuationCard,
  SanitizedContinueControl,
} from "../../src/naver/account-store-resolver";
import type { ExportActionPlan } from "../../src/naver/export-classify";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(__dirname, "..", "..", "src", "naver", "account-store-continue.ts");

/** Remove block + line comments so the source guards check executable source, not prose. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ---- Factories: build only sanitized fields (enums/buckets/booleans/hashes). ----

function makeControl(overrides: Partial<SanitizedContinueControl> = {}): SanitizedContinueControl {
  return {
    candidateIndex: 1,
    textHash: "deadbeefdeadbeef",
    tagCategory: "button",
    roleCategory: "button",
    clickableTagCategory: "button",
    hrefCategory: "none",
    hasHref: false,
    hasButton: true,
    hasAnchor: false,
    hasInput: false,
    hasValueAttr: false,
    hasAriaLabel: false,
    hasTitleAttr: false,
    hasNestedLink: false,
    hasNestedButton: false,
    classTokenCountBucket: "few",
    childElementCountBucket: "few",
    hasContinueLikeMarker: true,
    hasLoginLikeMarker: true,
    hasAccountLikeMarker: true,
    hasNaverLikeMarker: false,
    hasCommerceLikeMarker: false,
    isWithinContinuationCard: true,
    isNearContinuationCard: true,
    sameCardAncestorDepthBucket: "one",
    nearestCardMarkerCategory: "currentLogin",
    hasDifferentAccountMarker: false,
    hasDifferentIdMarker: false,
    hasOtherLoginMarker: false,
    hasSwitchAccountMarker: false,
    hasLogoutMarker: false,
    hasCurrentAccountMarker: true,
    hasContinueCurrentMarker: true,
    hasLoginCurrentMarker: true,
    matchesSafeContinueHypothesis: true,
    ...overrides,
  };
}

function makeCard(overrides: Partial<SanitizedContinuationCard> = {}): SanitizedContinuationCard {
  return {
    surface: "reconnect-continue",
    continueControlCountBucket: "one",
    cardTextHash: "946efc69b1022bcb",
    expectedMatch: true,
    hasExactlyOneLikelyContinueControl: true,
    hasCurrentLoginAccountCard: true,
    hasNaverCommerceIdMarker: true,
    hasNaverIdMarker: false,
    decisionKind: "READY_TO_CONTINUE",
    ...overrides,
  };
}

/** A fully-passing gate input: reconnect-continue, fingerprint-matched, one safe control. */
function makeInput(overrides: Partial<ContinueGateInput> = {}): ContinueGateInput {
  return {
    surface: "reconnect-continue",
    continuationCard: makeCard(),
    continueControls: [makeControl({ candidateIndex: 1, matchesSafeContinueHypothesis: true })],
    ...overrides,
  };
}

describe("decideContinueGate — verdict gate halts before anything is clickable", () => {
  it("LOGGED_IN → ALREADY_READY (no continuation needed, no click)", () => {
    expect(decideContinueGate(makeInput(), "LOGGED_IN", true).kind).toBe("ALREADY_READY");
  });

  it("ACCOUNT_LOGIN_REQUIRED → HALT_LOGIN_REQUIRED", () => {
    expect(decideContinueGate(makeInput(), "ACCOUNT_LOGIN_REQUIRED", true).kind).toBe("HALT_LOGIN_REQUIRED");
  });

  it("AUTH_CHALLENGE_REQUIRED → HALT_AUTH_CHALLENGE", () => {
    expect(decideContinueGate(makeInput(), "AUTH_CHALLENGE_REQUIRED", true).kind).toBe("HALT_AUTH_CHALLENGE");
  });

  it("UNKNOWN → HALT_UNKNOWN_VERDICT", () => {
    expect(decideContinueGate(makeInput(), "UNKNOWN", true).kind).toBe("HALT_UNKNOWN_VERDICT");
  });
});

describe("decideContinueGate — config / surface / fingerprint gates (RECONNECT_REQUIRED)", () => {
  it("missing expected fingerprint config → HALT_FINGERPRINT_UNCONFIGURED (no click)", () => {
    const gate = decideContinueGate(makeInput(), "RECONNECT_REQUIRED", false);
    expect(gate.kind).toBe("HALT_FINGERPRINT_UNCONFIGURED");
    expect(gate.clickCandidateIndex).toBeUndefined();
  });

  it("surface is not reconnect-continue → HALT_SURFACE", () => {
    const gate = decideContinueGate(
      makeInput({ surface: "account-chooser", continuationCard: makeCard({ surface: "account-chooser" }) }),
      "RECONNECT_REQUIRED",
      true,
    );
    expect(gate.kind).toBe("HALT_SURFACE");
  });

  it("fingerprint mismatch (expectedMatch false) → HALT_FINGERPRINT_MISMATCH", () => {
    const gate = decideContinueGate(
      makeInput({ continuationCard: makeCard({ expectedMatch: false, decisionKind: "NO_MATCH" }) }),
      "RECONNECT_REQUIRED",
      true,
    );
    expect(gate.kind).toBe("HALT_FINGERPRINT_MISMATCH");
  });
});

describe("decideContinueGate — exactly-one-safe-control gate", () => {
  it("zero safe controls → HALT_NO_SAFE_CONTROL", () => {
    const gate = decideContinueGate(
      makeInput({ continueControls: [makeControl({ matchesSafeContinueHypothesis: false })] }),
      "RECONNECT_REQUIRED",
      true,
    );
    expect(gate.kind).toBe("HALT_NO_SAFE_CONTROL");
  });

  it("multiple safe controls → HALT_MULTIPLE_SAFE_CONTROLS", () => {
    const gate = decideContinueGate(
      makeInput({
        continueControls: [
          makeControl({ candidateIndex: 1, matchesSafeContinueHypothesis: true }),
          makeControl({ candidateIndex: 2, matchesSafeContinueHypothesis: true }),
        ],
      }),
      "RECONNECT_REQUIRED",
      true,
    );
    expect(gate.kind).toBe("HALT_MULTIPLE_SAFE_CONTROLS");
  });

  it("a single safe control carrying a negative marker → HALT_NEGATIVE_MARKER", () => {
    const gate = decideContinueGate(
      makeInput({
        continueControls: [makeControl({ matchesSafeContinueHypothesis: true, hasOtherLoginMarker: true })],
      }),
      "RECONNECT_REQUIRED",
      true,
    );
    expect(gate.kind).toBe("HALT_NEGATIVE_MARKER");
  });

  it("one safe control but decision is not READY_TO_CONTINUE → HALT_NOT_READY", () => {
    const gate = decideContinueGate(
      makeInput({ continuationCard: makeCard({ decisionKind: "AMBIGUOUS" }) }),
      "RECONNECT_REQUIRED",
      true,
    );
    expect(gate.kind).toBe("HALT_NOT_READY");
  });
});

describe("decideContinueGate — the ONLY path that authorizes a click", () => {
  it("exactly one safe control + READY_TO_CONTINUE + RECONNECT + fingerprint → CONTINUE_ALLOWED", () => {
    const gate = decideContinueGate(
      makeInput({ continueControls: [makeControl({ candidateIndex: 3, matchesSafeContinueHypothesis: true })] }),
      "RECONNECT_REQUIRED",
      true,
    );
    expect(gate.kind).toBe("CONTINUE_ALLOWED");
    // The click index is the PROVEN safe candidate's index — never a hardcoded literal.
    expect(gate.clickCandidateIndex).toBe(3);
  });
});

describe("deriveReachedExportSurface — reports a fact, never a success claim", () => {
  const plan = (over: Partial<ExportActionPlan> = {}): ExportActionPlan => ({
    layout: "SYNC_DOWNLOAD",
    hasActionableExportCandidate: true,
    actionableExportCandidateCount: "one",
    triggerSelectorCount: "one",
    asyncMarkerPresent: false,
    ...over,
  });

  it("LOGGED_IN + actionable export → true", () => {
    expect(deriveReachedExportSurface("LOGGED_IN", plan())).toBe(true);
  });
  it("LOGGED_IN + no actionable export → false", () => {
    expect(deriveReachedExportSurface("LOGGED_IN", plan({ hasActionableExportCandidate: false }))).toBe(false);
  });
  it("still reconnecting (not LOGGED_IN) → false even with an export control", () => {
    expect(deriveReachedExportSurface("RECONNECT_REQUIRED", plan())).toBe(false);
  });
});

describe("postClickAdvanced — bounded-poll early-stop predicate (fixes premature verification)", () => {
  const obs = (over: Partial<PostClickObservation> = {}): PostClickObservation => ({
    verdict: "RECONNECT_REQUIRED",
    surface: "reconnect-continue",
    urlCategory: "login",
    exportActionable: false,
    ...over,
  });

  it("post-click immediately LOGGED_IN → advanced (success)", () => {
    expect(postClickAdvanced(obs({ verdict: "LOGGED_IN" }))).toBe(true);
  });

  it("still on reconnect/login (first ticks) → NOT advanced, keep polling", () => {
    expect(postClickAdvanced(obs())).toBe(false);
  });

  it("transition to LOGGED_IN within the window → advanced (the live idx-1 case)", () => {
    // First observation is the stale reconnect DOM (false → keep polling); a later tick flips.
    expect(postClickAdvanced(obs())).toBe(false);
    expect(postClickAdvanced(obs({ verdict: "LOGGED_IN", surface: "review-ready", urlCategory: "seller-center" }))).toBe(
      true,
    );
  });

  it("transition to seller-center / review-ready within the window → advanced", () => {
    expect(postClickAdvanced(obs({ urlCategory: "seller-center" }))).toBe(true);
    expect(postClickAdvanced(obs({ surface: "review-ready" }))).toBe(true);
  });

  it("an actionable export/review control appearing → advanced", () => {
    expect(postClickAdvanced(obs({ exportActionable: true }))).toBe(true);
  });

  it("timeout still RECONNECT_REQUIRED on reconnect/login → never advanced (non-advance result)", () => {
    expect(postClickAdvanced(obs({ verdict: "RECONNECT_REQUIRED" }))).toBe(false);
  });
});

describe("pollPostClickUntilAdvanced — resilient to mid-navigation reads (no crash)", () => {
  const noSleep = async (): Promise<void> => undefined;
  const opts = { maxChecks: 5, intervalMs: 1, sleepFn: noSleep };
  const observed = (over: Partial<PostClickObservation> = {}): PostClickRead => ({
    kind: "observed",
    obs: {
      verdict: "RECONNECT_REQUIRED",
      surface: "reconnect-continue",
      urlCategory: "login",
      exportActionable: false,
      ...over,
    },
  });
  const pending = (): PostClickRead => ({ kind: "pending_navigation" });

  /** Build an observeFn that yields the given sequence (a thrown error simulates a nav read). */
  function sequence(steps: Array<PostClickRead | "throw">): () => Promise<PostClickRead> {
    let i = 0;
    return async () => {
      const step = steps[Math.min(i, steps.length - 1)];
      i += 1;
      if (step === "throw") throw new Error("page is navigating and changing the content");
      return step as PostClickRead;
    };
  }

  it("first observation THROWS (navigation), second is LOGGED_IN → advanced, no crash", async () => {
    const res = await pollPostClickUntilAdvanced(
      sequence(["throw", observed({ verdict: "LOGGED_IN", surface: "review-ready", urlCategory: "seller-center" })]),
      opts,
    );
    expect(res.advanced).toBe(true);
    expect(res.everObserved).toBe(true);
    expect(res.checks).toBe(2);
    expect(res.read.kind).toBe("observed");
  });

  it("several pending-navigation reads then seller-center → advanced, no crash", async () => {
    const res = await pollPostClickUntilAdvanced(
      sequence([pending(), pending(), observed({ urlCategory: "seller-center" })]),
      opts,
    );
    expect(res.advanced).toBe(true);
    expect(res.checks).toBe(3);
  });

  it("all reads pending until timeout → non-advance, no crash, everObserved false", async () => {
    const res = await pollPostClickUntilAdvanced(sequence([pending()]), opts);
    expect(res.advanced).toBe(false);
    expect(res.everObserved).toBe(false);
    expect(res.checks).toBe(5);
    expect(res.read.kind).toBe("pending_navigation");
  });

  it("all reads throw until timeout → non-advance, never throws", async () => {
    const res = await pollPostClickUntilAdvanced(sequence(["throw"]), opts);
    expect(res.advanced).toBe(false);
    expect(res.everObserved).toBe(false);
    expect(res.checks).toBe(5);
  });

  it("stays on reconnect (observed) until timeout → non-advance, everObserved true", async () => {
    const res = await pollPostClickUntilAdvanced(sequence([observed()]), opts);
    expect(res.advanced).toBe(false);
    expect(res.everObserved).toBe(true);
    expect(res.read.kind).toBe("observed");
  });

  it("stops EARLY on the first advanced read (does not exhaust maxChecks)", async () => {
    let calls = 0;
    const res = await pollPostClickUntilAdvanced(async () => {
      calls += 1;
      return observed({ verdict: "LOGGED_IN" });
    }, opts);
    expect(res.advanced).toBe(true);
    expect(calls).toBe(1); // early stop on tick 1
  });

  it("a pending/transient poll result carries no raw error text", async () => {
    const res = await pollPostClickUntilAdvanced(sequence(["throw"]), opts);
    const json = JSON.stringify(res);
    expect(/navigating|changing the content|Error|stack/i.test(json)).toBe(false);
  });
});

describe("isContentConfirmed — distinguishes a settled advance from a soft URL-only advance", () => {
  const obs = (over: Partial<PostClickObservation> = {}): PostClickObservation => ({
    verdict: "RECONNECT_REQUIRED",
    surface: "reconnect-continue",
    urlCategory: "login",
    exportActionable: false,
    ...over,
  });
  it("LOGGED_IN → content-confirmed", () => {
    expect(isContentConfirmed(obs({ verdict: "LOGGED_IN" }))).toBe(true);
  });
  it("review-ready → content-confirmed", () => {
    expect(isContentConfirmed(obs({ surface: "review-ready" }))).toBe(true);
  });
  it("export actionable → content-confirmed", () => {
    expect(isContentConfirmed(obs({ exportActionable: true }))).toBe(true);
  });
  it("seller-center URL only (verdict/surface still unknown) → NOT content-confirmed", () => {
    expect(isContentConfirmed(obs({ urlCategory: "seller-center", verdict: "UNKNOWN", surface: "unknown" }))).toBe(
      false,
    );
  });
});

describe("confirmAdvancedPostClickState — prefer a content-confirmed state, never downgrade", () => {
  const noSleep = async (): Promise<void> => undefined;
  const opts = { maxChecks: 4, intervalMs: 1, sleepFn: noSleep };
  const observed = (over: Partial<PostClickObservation> = {}): PostClickRead => ({
    kind: "observed",
    obs: {
      verdict: "RECONNECT_REQUIRED",
      surface: "reconnect-continue",
      urlCategory: "login",
      exportActionable: false,
      ...over,
    },
  });
  const softSellerCenter = observed({ verdict: "UNKNOWN", surface: "unknown", urlCategory: "seller-center" });

  function sequence(steps: Array<PostClickRead | "throw">): () => Promise<PostClickRead> {
    let i = 0;
    return async () => {
      const step = steps[Math.min(i, steps.length - 1)];
      i += 1;
      if (step === "throw") throw new Error("page is navigating and changing the content");
      return step as PostClickRead;
    };
  }

  it("advanced by seller-center first, then LOGGED_IN/review-ready on confirmation → adopts it", async () => {
    const res = await confirmAdvancedPostClickState(
      softSellerCenter,
      sequence([observed({ verdict: "LOGGED_IN", surface: "review-ready", urlCategory: "seller-center" })]),
      opts,
    );
    expect(res.upgraded).toBe(true);
    expect(res.read.kind).toBe("observed");
    expect(res.read.obs?.verdict).toBe("LOGGED_IN");
    expect(res.read.obs?.surface).toBe("review-ready");
  });

  it("advanced by LOGGED_IN immediately → no confirmation reads, no downgrade", async () => {
    let calls = 0;
    const current = observed({ verdict: "LOGGED_IN", surface: "review-ready", urlCategory: "seller-center" });
    const res = await confirmAdvancedPostClickState(
      current,
      async () => {
        calls += 1;
        return observed(); // would be a downgrade if ever adopted
      },
      opts,
    );
    expect(res.upgraded).toBe(false);
    expect(res.checks).toBe(0);
    expect(calls).toBe(0);
    expect(res.read).toBe(current); // unchanged — no downgrade
  });

  it("confirmation stays soft (never content-confirmed) → keep the original advance, no downgrade", async () => {
    const res = await confirmAdvancedPostClickState(
      softSellerCenter,
      sequence([observed({ verdict: "UNKNOWN", surface: "unknown", urlCategory: "login" })]),
      opts,
    );
    expect(res.upgraded).toBe(false);
    expect(res.read).toBe(softSellerCenter); // kept the seller-center advance, did not downgrade to login
  });

  it("transient navigation during confirmation then content-confirmed → no crash, adopts it", async () => {
    const res = await confirmAdvancedPostClickState(
      softSellerCenter,
      sequence(["throw", observed({ verdict: "LOGGED_IN" })]),
      opts,
    );
    expect(res.upgraded).toBe(true);
    expect(res.read.obs?.verdict).toBe("LOGGED_IN");
  });
});

describe("account-store-continue — no-leak: the gate emits only content-free fields", () => {
  it("the gate result carries no candidate text / id / url — only a kind + static detail + index", () => {
    const gate = decideContinueGate(makeInput(), "RECONNECT_REQUIRED", true);
    const json = JSON.stringify(gate);
    for (const hostile of ["스토어", "smartstore", "channel", "commerceId", "http", "://", "cookie", "token"]) {
      expect(json.includes(hostile)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Source guards — lock the single-guarded-click / no-leak / no-side-effect shape.
// ---------------------------------------------------------------------------
const code = stripComments(readFileSync(SRC_PATH, "utf8"));

describe("account-store-continue — exactly ONE guarded click, nothing else drives the page", () => {
  it("contains exactly one `.click(` call (the single guarded continue)", () => {
    expect((code.match(/\.click\s*\(/g) ?? []).length).toBe(1);
  });

  it("never fills/presses/selects/checks/dispatches/types (no credential typing, no form drive)", () => {
    expect(/\.(fill|press|selectOption|check|dispatchEvent|tap|type)\s*\(/.test(code)).toBe(false);
    expect(/\bkeyboard\b/.test(code)).toBe(false);
  });

  it("asserts the proven selector resolves to exactly one node BEFORE clicking", () => {
    expect(/\.count\s*\(/.test(code)).toBe(true);
    expect(/matchCount\s*!==\s*1/.test(code)).toBe(true);
    const countIdx = code.indexOf(".count(");
    const clickIdx = code.indexOf(".click(");
    expect(countIdx).toBeGreaterThanOrEqual(0);
    expect(clickIdx).toBeGreaterThan(countIdx); // the count guard precedes the click
  });

  it("locates by the INDEX-only stamp attribute, never by raw text/id", () => {
    expect(code.includes("data-sellerops-cand")).toBe(true);
    // No text-based locator (getByText / :has-text) is used to find the control.
    expect(/getByText|has-text|:text\(/.test(code)).toBe(false);
  });

  it("gates the click behind decideContinueGate (early-returns on every non-allowed kind)", () => {
    expect(code.includes("decideContinueGate(")).toBe(true);
    expect(/gate\.kind\s*!==\s*"CONTINUE_ALLOWED"/.test(code)).toBe(true);
  });

  it("never triggers/captures an export, downloads, uploads, or writes status", () => {
    expect(code.includes("runExport")).toBe(false);
    expect(code.includes("uploadReviewFile")).toBe(false);
    expect(/\bupload\w*\s*\(/.test(code)).toBe(false);
    expect(/waitForEvent\s*\(/.test(code)).toBe(false);
    expect(/saveAs/.test(code)).toBe(false);
    expect(code.includes("writeStatus")).toBe(false);
  });

  it("never navigates the page (no goto — it acts on the surface the human left)", () => {
    expect(/\.goto\s*\(/.test(code)).toBe(false);
  });
});

describe("account-store-continue — the post-click poll is bounded, RESILIENT + READ-ONLY", () => {
  it("polls via the injectable bounded helper + the pure early-stop predicate", () => {
    expect(/maxChecks/.test(code)).toBe(true);
    expect(/POST_CLICK_POLL_TIMEOUT_MS/.test(code)).toBe(true);
    expect(code.includes("postClickAdvanced(")).toBe(true);
    expect(code.includes("pollPostClickUntilAdvanced(")).toBe(true);
  });

  it("keeps the poll timeout within the agreed 15–30s window", () => {
    const m = code.match(/POST_CLICK_POLL_TIMEOUT_MS\s*=\s*([\d_]+)/);
    expect(m).not.toBeNull();
    const ms = Number((m![1] ?? "0").replace(/_/g, ""));
    expect(ms).toBeGreaterThanOrEqual(15_000);
    expect(ms).toBeLessThanOrEqual(30_000);
  });

  it("still contains exactly ONE click — the poll never re-clicks or acts", () => {
    expect((code.match(/\.click\s*\(/g) ?? []).length).toBe(1);
    // Within continueAtCardOnce, the single click precedes the poll call; nothing clicks after.
    const fnStart = code.indexOf("export async function continueAtCardOnce");
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const body = code.slice(fnStart);
    const clickIdx = body.indexOf(".click(");
    const pollCallIdx = body.indexOf("pollPostClickUntilAdvanced(");
    expect(clickIdx).toBeGreaterThanOrEqual(0);
    expect(pollCallIdx).toBeGreaterThan(clickIdx);
    const afterClick = body.slice(clickIdx + 7);
    expect(/\.click\s*\(/.test(afterClick)).toBe(false);
  });

  it("the poll + confirm helpers only observe — they never click/fill/select/navigate", () => {
    const start = code.indexOf("export async function pollPostClickUntilAdvanced");
    const end = code.indexOf("async function observePostClick");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = code.slice(start, end); // spans pollPostClickUntilAdvanced + confirmAdvancedPostClickState
    expect(code.includes("confirmAdvancedPostClickState")).toBe(true);
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent)\s*\(/.test(body)).toBe(false);
    expect(/\.goto\s*\(/.test(body)).toBe(false);
  });

  it("the content-confirmation runs ONLY after advancement and never re-clicks", () => {
    // The confirmation call sits after the single click and the poll, and contains no click.
    const fnStart = code.indexOf("export async function continueAtCardOnce");
    const body = code.slice(fnStart);
    const clickIdx = body.indexOf(".click(");
    const confirmIdx = body.indexOf("confirmAdvancedPostClickState(");
    expect(confirmIdx).toBeGreaterThan(clickIdx); // confirmation strictly after the one click
    expect(/if\s*\(\s*advanced\s*&&[\s\S]*!isContentConfirmed\(/.test(body)).toBe(true); // gated on advanced + soft
  });

  it("observePostClick is RESILIENT: try/catch → pending_navigation, no raw error text", () => {
    expect(code.includes("observePostClick")).toBe(true);
    const start = code.indexOf("async function observePostClick");
    const end = code.indexOf("export async function continueAtCardOnce");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = code.slice(start, end);
    // Read-only.
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent)\s*\(/.test(body)).toBe(false);
    expect(/\.goto\s*\(/.test(body)).toBe(false);
    // A navigation read failure is caught and returned as a sanitized pending read.
    expect(/catch\s*\{/.test(body)).toBe(true);
    expect(/kind:\s*"pending_navigation"/.test(body)).toBe(true);
    // The catch binds NO error variable and prints nothing — no raw Playwright error can leak.
    expect(/catch\s*\(\s*[A-Za-z_$]/.test(body)).toBe(false);
    expect(/console\.|\.message|\bstack\b/.test(body)).toBe(false);
  });
});
