/**
 * The live driver's evidence-backed row seam (offline, fake page). Proves: with a hint + calibrated mapping the
 * driver censuses rows via the mapping paths and matches with the SHARED rule (unique / ambiguous / none), signs
 * the matched DOM position, annotates read-only only on a unique match, and — WITHOUT a mapping — stays
 * fail-closed and never touches the page. The in-page census/annotate scripts are exercised in the browser rung;
 * here the fake page returns canned sanitized census rows so the TS decision + wiring are unit-tested.
 */
import { describe, it, expect } from "vitest";
import { NaverReplySubmitProbeDriver, type ReplyPageLike } from "../../../src/action-window/reply-submission/naver-reply-driver";
import { composerSigFor, type ReplyTargetHint } from "../../../src/action-window/reply-submission/reply-surface";
import { ROW_MAPPING_SCHEMA_VERSION, type ReplyRowMapping } from "../../../src/action-window/reply-submission/reply-row-mapping-artifact";

const HINT: ReplyTargetHint = { rating: 2, recencyBucket: "THIS_WEEK", bodyFingerprint: "a".repeat(64) };
const MAPPING: ReplyRowMapping = {
  schemaVersion: ROW_MAPPING_SCHEMA_VERSION,
  structuralPageSignature: "sig_x",
  expiresAtEpochMs: 9_999_999_999_999,
  parentPath: [0],
  rowTag: "DIV",
  rowIndex: 1,
  ratingPath: [0],
  datePath: [1],
  bodyPath: [2],
  replyControlPath: [3],
};
const MATCH = { rating: 2, recencyBucket: "THIS_WEEK", bodyFingerprint: "a".repeat(64) };
const OTHER = { rating: 5, recencyBucket: "OLDER", bodyFingerprint: "b".repeat(64) };

/** Fake page: census evaluate → the preset rows; annotate evaluate → 1; waitForFunction → resolves. */
function fakePage(rows: unknown, spy?: { annotated?: boolean; touched?: boolean }): ReplyPageLike {
  return {
    url: () => "about:blank",
    content: () => Promise.resolve(""),
    evaluate: <T>(script: string): Promise<T> => {
      if (spy) spy.touched = true;
      if (script.includes("data-aw-reply-row-target")) {
        if (spy) spy.annotated = true;
        return Promise.resolve(1 as unknown as T);
      }
      if (script.includes("M.rowTag).length")) return Promise.resolve(3 as unknown as T); // inPageRowCount
      return Promise.resolve(rows as T); // census
    },
    waitForFunction: () => Promise.resolve(undefined),
  };
}

function driverWith(rows: unknown, spy?: { annotated?: boolean; touched?: boolean }) {
  return new NaverReplySubmitProbeDriver(fakePage(rows, spy), {
    hint: HINT,
    mapping: MAPPING,
    asOfDate: "2026-05-12",
    rowOpenTimeoutMs: 10,
  });
}

describe("NaverReplySubmitProbeDriver — evidence-backed row seam (mapped)", () => {
  it("locates the unique matching row and signs its DOM position", async () => {
    const d = driverWith([OTHER, MATCH, OTHER]);
    expect(await d.locateReviewRow()).toEqual({ count: 1, sig: composerSigFor(["row", 1]) });
  });

  it("reports 0 when no row matches (→ engine TARGET_NOT_FOUND)", async () => {
    expect(await driverWith([OTHER, OTHER]).locateReviewRow()).toEqual({ count: 0 });
  });

  it("reports >1 when the hint matches multiple rows (→ engine TARGET_AMBIGUOUS)", async () => {
    expect(await driverWith([MATCH, OTHER, MATCH]).locateReviewRow()).toEqual({ count: 2 });
  });

  it("skips rows with any unparseable (null) field — a null can never match", async () => {
    const partial = { rating: null, recencyBucket: "THIS_WEEK", bodyFingerprint: "a".repeat(64) };
    expect(await driverWith([partial, MATCH]).locateReviewRow()).toEqual({ count: 1, sig: composerSigFor(["row", 1]) });
  });

  it("highlightRow re-validates then annotates read-only ONLY on a unique match", async () => {
    const spy: { annotated?: boolean } = {};
    const d = driverWith([OTHER, MATCH, OTHER], spy);
    expect(await d.highlightRow()).toEqual({ count: 1, sig: composerSigFor(["row", 1]) });
    expect(spy.annotated).toBe(true);
  });

  it("highlightRow never annotates when the match is not unique", async () => {
    const spy: { annotated?: boolean } = {};
    const d = driverWith([MATCH, MATCH], spy);
    expect(await d.highlightRow()).toEqual({ count: 2 });
    expect(spy.annotated).toBeUndefined();
  });
});

describe("NaverReplySubmitProbeDriver — calibrated locate (abort rehearsal, operator-designated row)", () => {
  it("trusts the mapping.rowIndex directly (no fingerprint match) when the row still exists", async () => {
    // fakePage returns rowCount 3; MAPPING.rowIndex = 1 → in range → count 1, signed at the designated index.
    const d = new NaverReplySubmitProbeDriver(fakePage([]), { mapping: MAPPING, locateMode: "calibrated" });
    expect(await d.locateReviewRow()).toEqual({ count: 1, sig: composerSigFor(["row", 1]) });
  });

  it("fails closed when the designated index no longer exists (row count shrank)", async () => {
    const page: ReplyPageLike = {
      url: () => "about:blank",
      content: () => Promise.resolve(""),
      evaluate: <T>(script: string): Promise<T> =>
        Promise.resolve((script.includes("M.rowTag).length") ? 0 : []) as unknown as T),
      waitForFunction: () => Promise.resolve(undefined),
    };
    const d = new NaverReplySubmitProbeDriver(page, { mapping: MAPPING, locateMode: "calibrated" });
    expect(await d.locateReviewRow()).toEqual({ count: 0 });
  });
});

describe("NaverReplySubmitProbeDriver — UNMAPPED seam stays fail-closed and never touches the page", () => {
  it("locate/highlight report 0, arm/wait are inert, and evaluate is never called", async () => {
    const spy: { touched?: boolean } = {};
    const d = new NaverReplySubmitProbeDriver(fakePage([MATCH], spy)); // no hint/mapping
    expect(await d.locateReviewRow()).toEqual({ count: 0 });
    expect(await d.highlightRow()).toEqual({ count: 0 });
    await d.armRowObserve();
    expect(await d.waitForRowOpen()).toBe(false);
    expect(spy.touched).toBeUndefined();
  });
});
