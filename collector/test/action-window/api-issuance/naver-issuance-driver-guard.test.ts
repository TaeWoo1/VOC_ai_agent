/**
 * Source guard for the LIVE `NaverIssuanceDriver` (and its gated CLI).
 *
 * The driver lives OUTSIDE `api-issuance/` precisely because it legitimately runs `.evaluate` for the
 * census / overlay / read-only tagging — so the pure `api-issuance/` strict guard (`issuance-guard.test.ts`)
 * stays intact and is NOT touched. This guard mirrors the reply driver's boundary: it ALLOWS `.evaluate(` /
 * `.$$(` / `setAttribute`, but still forbids EVERY click/type/submit and EVERY field-VALUE read (incl. the
 * Application ID / Secret). Comment lines are stripped first, per collector conventions.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = resolve(HERE, "../../../src/action-window/naver-issuance-driver.ts");
const CLI = resolve(HERE, "../../../instruments/live-runs/run-api-issuance-live-naver.ts");
const PROBE_CLI = resolve(HERE, "../../../instruments/calibration/probe-issuance-selectors.ts");
const LIVE_PROOF_CLI = resolve(HERE, "../../../instruments/live-runs/issuance-live-proof.ts");

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

/** No way to act on a marketplace control — the SELLER clicks; the driver observes + annotates only. */
const NO_ACTION_TOKENS = [
  ".click(",
  ".dblclick(",
  ".tap(",
  ".hover(",
  ".type(",
  ".fill(",
  ".press(",
  ".check(",
  ".uncheck(",
  ".selectOption(",
  ".setInputFiles(",
  ".keyboard",
  "dispatchEvent",
  ".submit(",
  'waitForEvent("download"',
  "waitForEvent('download'",
] as const;

/**
 * No way to read a field value, text, clipboard, or screenshot — the credential is never read.
 *
 * Includes the full-DOM slurps `page.content()` and `.outerHTML`: on the credential-issuance page those
 * carry the displayed Application ID / Secret, so they are forbidden outright (parity with the audited reply
 * guard, which also bans `page.content()`).
 */
const NO_VALUE_READ_TOKENS = [
  ".inputValue(",
  ".value", // a bare read (`node.value`) OR a write (`x.value =`) — both forbidden.
  ".textContent",
  ".innerText",
  ".innerHTML",
  ".outerHTML",
  ".getAttribute(",
  ".getProperty(",
  ".getProperties(",
  "page.content(",
  "clipboard",
  "readText(",
  ".screenshot(",
] as const;

/**
 * No way to navigate the seller's own dedicated window. The driver reads wherever the SELLER went; the CLI
 * navigates exactly once, only to the pre-screened API-center URL. A back/forward/reload/programmatic
 * navigation could send the window off the screened host (parity with the audited read-only reply CLI).
 */
const NO_NAV_TOKENS = [".goBack(", ".goForward(", ".reload(", "waitForNavigation", "window.open"] as const;

describe("NaverIssuanceDriver — source guard (no click/type/submit, no value read)", () => {
  const code = codeOnly(DRIVER);

  it.each(NO_ACTION_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_VALUE_READ_TOKENS)("never reads a field value / clipboard / screenshot (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_NAV_TOKENS)("never navigates the seller's window (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it("never navigates at all — it reads wherever the seller went (no .goto)", () => {
    expect(code).not.toContain(".goto(");
  });

  it("ALLOWS the observation/annotation primitives it legitimately needs (evaluate)", () => {
    expect(code).toContain("evaluate");
    // The overlay/observer are reused, never reimplemented.
    expect(code).toContain("mountOverlay");
    expect(code).toContain("armObserver");
  });

  it("locates by the VALUE-FREE fixed-label locate script (never by a value / raw text read in the driver)", () => {
    // The driver delegates location to the audited `buildFixedLabelLocateScript` (guarded separately for
    // value-free OUTPUT). The driver source itself contains NO text/attribute read — those live only inside
    // that imported script string, which reads text solely to compare against a KNOWN fixed label and returns
    // only a count + an opaque structural signature.
    expect(code).toContain("buildFixedLabelLocateScript");
    // The signature source (tagName/childElementCount/IN_PAGE_SIG_FACTORY) is NOT in the driver — it moved into
    // the audited inpage script, so the driver's own code cannot read an element's structure/value directly.
    expect(code).not.toContain("el.childElementCount");
    expect(code).not.toContain("IN_PAGE_SIG_FACTORY");
  });

  it("treats `return` as guidance-only — a fixed synthetic signature, never a queried NAVER control", () => {
    expect(code).toContain("RETURN_GUIDANCE_SIG");
  });
});

describe("run-api-issuance-live-naver CLI — source guard (gated, no click/type/submit, no value read)", () => {
  const code = codeOnly(CLI);

  it.each(NO_ACTION_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_VALUE_READ_TOKENS)("never reads a field value / clipboard / screenshot (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_NAV_TOKENS)("never re-navigates the seller's window (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it("navigates exactly ONCE — to the pre-screened URL only", () => {
    // The single `page.goto(url,...)` after screenApiCenterUrl passes; no second navigation of the window.
    expect(code.split("page.goto(").length - 1).toBe(1);
  });

  it("is gated on the explicit live-run approval flag and fails closed on a bad URL before launch", () => {
    expect(code).toContain("hasLiveRunApproval");
    expect(code).toContain("screenApiCenterUrl");
    // main() runs only when invoked directly — inert on import.
    expect(code).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
  });
});

describe("probe-issuance-selectors CLI — source guard (gated, read-only, no click/type/value read/highlight)", () => {
  const code = codeOnly(PROBE_CLI);

  it.each(NO_ACTION_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_VALUE_READ_TOKENS)("never reads a field value / clipboard / screenshot (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_NAV_TOKENS)("never re-navigates the seller's window (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it("navigates exactly ONCE — to the pre-screened URL only", () => {
    expect(code.split(".goto(").length - 1).toBe(1);
  });

  it("is READ-ONLY: it measures matchCount but never highlights, tags, or observes a click", () => {
    // It uses the driver's read-only probe, never its highlight/observe path.
    expect(code).toContain("probeTargetMatch");
    expect(code).not.toContain("highlightTarget");
    expect(code).not.toContain("armObserve");
    expect(code).not.toContain("observeUserAction");
    // It never draws an overlay (mounting an overlay would be a highlight, which is Phase B, not this probe).
    expect(code).not.toContain("mountOverlay");
  });

  it("is gated on the explicit live-run approval flag and fails closed on a bad URL before launch", () => {
    expect(code).toContain("hasLiveRunApproval");
    expect(code).toContain("screenApiCenterUrl");
    expect(code).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
  });
});

describe("issuance-live-proof CLI — source guard (gated bridge client, no marketplace action, no value read)", () => {
  const code = codeOnly(LIVE_PROOF_CLI);

  it.each(NO_ACTION_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_VALUE_READ_TOKENS)("never reads a field value / clipboard / screenshot (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it("is not a browser driver at all — it never navigates a page (no .goto / no Playwright page)", () => {
    expect(code).not.toContain(".goto(");
    expect(code).not.toContain("launchNaverContext");
    expect(code).not.toContain("NaverIssuanceDriver");
  });

  it("**sends ONE command — START_RUN — and never any other", () => {
    expect(code).toContain("START_RUN");
    // No mutating/marketplace command types leak in from a copy-paste of another client.
    for (const forbidden of ["REPLY", "SUBMIT", "EXPORT", "DOWNLOAD", "AUTOFILL"]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it("**cannot advance a checkpoint at all** — the sentinel that used to do it is gone", () => {
    // It used to send `REQUEST_STEP_RECHECK` once per appearance of a sentinel file the operator touched: a
    // file any process can create, standing in for "I have SEEN the overlay and done what it asks". A
    // DIAGNOSTIC must not be able to move a live guided walk on to the next instruction — 다음 is the
    // SellerOps frontend's own button, pressed by the seller, in the product path.
    expect(code).not.toContain("REQUEST_STEP_RECHECK");
    expect(code).not.toContain("ISSUANCE_NEXT_SIGNAL");
    expect(code).not.toContain("sendNext");
  });

  it("is gated on the explicit live-run approval flag and is inert on import (main only when invoked directly)", () => {
    expect(code).toContain("hasLiveRunApproval");
    expect(code).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
  });
});
