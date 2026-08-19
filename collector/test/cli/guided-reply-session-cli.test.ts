/**
 * The guided-session run record: what it claims, what it must never contain, and how it reports the review
 * zero-match and duplicate-match stops.
 *
 * The record is the only artefact a live run leaves behind, so its shape is pinned here rather than trusted.
 */
import { describe, it, expect } from "vitest";
import { buildGuidedRecord, type GuidedRecordInput } from "../../instruments/live-runs/run-guided-reply-session-live-naver";
import { fingerprintHash } from "../../src/connection/connection";
import { sellerAccountFingerprint } from "../../src/connection/seller-account-fingerprint";
import type { ChromeIdentityVerification } from "../../src/action-window/reply-submission/session-chrome-identity";
import type { ChromeReadResult } from "../../instruments/live-runs/run-guided-reply-session-live-naver";

const ACCOUNT = "11111111-2222-3333-4444-555555555555";
const STORE_TOKEN = "channelNo=100200300";

const SHOP = "알파 스토어";
const USER = "seller_alpha";

const MATCHED: ChromeIdentityVerification = {
  verdict: "MATCH",
  reason: "ok",
  observedShopName: SHOP,
  boundShopDisplayName: SHOP,
  currentSelectorSpecFingerprint: "a".repeat(64),
  boundSelectorSpecFingerprint: "a".repeat(64),
  selectorsCollide: false,
  shopNameDiffers: false,
};

function session(over: Partial<ChromeIdentityVerification> = {}): ChromeReadResult {
  return {
    verification: { ...MATCHED, ...over },
    // Raw values exist on the read result but must never reach the record.
    observedUserId: USER,
    observedShopName: SHOP,
    signals: {
      urlCategory: "seller-center",
      loggedInSignal: true,
      sellerShellSignal: true,
      commerceIdCandidate: null,
      storeUrlPathCandidate: null,
      accountScopeCandidate: null,
    },
    userIdSelectorIndex: 0,
    shopNameSelectorIndex: 0,
    userIdRejections: [],
    shopNameRejections: [],
  };
}

function input(over: Partial<GuidedRecordInput> = {}): GuidedRecordInput {
  return {
    runId: "gsn_abcdef012345",
    terminal: "COMPOSER_ABORT",
    session: session(),
    boundThisRun: false,
    reverifiedAtBarriers: 3,
    driftReason: null,
    locate: { matched: true, mode: "channel-review-id", rowIndex: 3, source: "visible-text", matchCount: 1 },
    candidateRowCount: 13,
    scanCount: 1,
    rowsTruncated: false,
    tokensTruncated: false,
    outline: "outlined",
    operatorConfirmed: true,
    entryTransition: "INLINE_COMPOSER",
    reachedBarrier: true,
    draftDisplayed: true,
    operatorOutcome: "SUBMISSION_ABORTED",
    verification: "UNVERIFIED",
    ...over,
  } as GuidedRecordInput;
}

describe("buildGuidedRecord — the successful abort terminal", () => {
  it("records the account as session-verified only when the preflight actually matched", () => {
    const record = buildGuidedRecord(input());
    expect(record.sellerAccountBinding).toBe("verified-against-open-session");
    expect(record.session.verdict).toBe("MATCH");
    // Three: before the outline, before the composer step, and after the operator's entry replaces the page.
    expect(record.session.reverifiedAtBarriers).toBe(3);
    expect(record.composer.operatorOutcome).toBe("SUBMISSION_ABORTED");
    expect(record.composer.verification).toBe("UNVERIFIED");
    // Pinned by the type, asserted here because it is the whole safety claim.
    expect(record.composer.draftEntered).toBe(false);
  });

  it("never claims session verification on a stop path", () => {
    for (const v of ["MISMATCH", "UNAVAILABLE"] as const) {
      const record = buildGuidedRecord(
        input({ terminal: "ACCOUNT_PREFLIGHT_FAILED", session: session({ verdict: v }) }),
      );
      expect(record.sellerAccountBinding, `for ${v}`).toBe("not-verified-against-session");
    }
  });

  it("degrades honestly when the account was never read at all", () => {
    const record = buildGuidedRecord(input({ session: null, terminal: "ACCOUNT_PREFLIGHT_FAILED" }));
    expect(record.session.verdict).toBe("UNAVAILABLE");
    expect(record.sellerAccountBinding).toBe("not-verified-against-session");
    // An unread session says so, rather than synthesizing a reason it never observed.
    expect(record.session.reason).toBe("preflight-not-run");
  });
});

describe("buildGuidedRecord — the review stops", () => {
  it("records a zero match without claiming a mode or a source", () => {
    const record = buildGuidedRecord(
      input({
        terminal: "REVIEW_NOT_RESOLVED",
        locate: { matched: false, reason: "ZERO_MATCH", matchCount: 0 },
        outline: null,
        operatorConfirmed: false,
        reachedBarrier: false,
        draftDisplayed: false,
        operatorOutcome: null,
        verification: null,
      }),
    );
    expect(record.review.matched).toBe(false);
    expect(record.review.failureReason).toBe("ZERO_MATCH");
    expect(record.review.matchMode).toBeNull();
    expect(record.review.matchedSource).toBeNull();
    expect(record.review.operatorConfirmed).toBe(false);
    expect(record.composer.reachedBarrier).toBe(false);
  });

  it("records a duplicate match with its count, and claims no row", () => {
    const record = buildGuidedRecord(
      input({
        terminal: "REVIEW_NOT_RESOLVED",
        locate: { matched: false, reason: "MULTIPLE_MATCH", matchCount: 2 },
        outline: null,
        operatorConfirmed: false,
      }),
    );
    expect(record.review.failureReason).toBe("MULTIPLE_MATCH");
    expect(record.review.matchCount).toBe(2);
    expect(record.review.matched).toBe(false);
  });

  it("carries truncation forward so a miss is never read as a proven absence", () => {
    const record = buildGuidedRecord(
      input({
        terminal: "REVIEW_NOT_RESOLVED",
        locate: { matched: false, reason: "ZERO_MATCH", matchCount: 0 },
        rowsTruncated: true,
        scanCount: 10,
      }),
    );
    expect(record.review.rowsTruncated).toBe(true);
    expect(record.review.scanCount).toBe(10);
  });

  it("records a mid-session account switch as its own terminal, with the reason", () => {
    const record = buildGuidedRecord(
      input({ terminal: "ACCOUNT_DRIFTED", driftReason: "verdict-changed", session: session({ verdict: "MISMATCH" }) }),
    );
    expect(record.terminal).toBe("ACCOUNT_DRIFTED");
    expect(record.session.driftReason).toBe("verdict-changed");
    expect(record.sellerAccountBinding).toBe("not-verified-against-session");
  });

  it("refuses to claim verification on a drift stop whose barrier verdict is still MATCH", () => {
    // The realistic drift shape, and the one a `verdict === MATCH` check alone would wave through: the
    // barrier re-read still MATCHes the same connection, but it was read from a DIFFERENT live field, so the
    // two verdicts are not the same observation. Only `driftReason` distinguishes it.
    const record = buildGuidedRecord(
      input({ terminal: "ACCOUNT_DRIFTED", driftReason: "evidence-changed", session: session({ verdict: "MATCH" }) }),
    );
    expect(record.session.verdict).toBe("MATCH");
    expect(record.sellerAccountBinding).toBe("not-verified-against-session");
  });
});

describe("buildGuidedRecord — nothing identity-bearing may reach disk", () => {
  it("contains no account id, store token, or digest — asserted against values ACTUALLY fed in", () => {
    // THIS TEST WAS VACUOUS, and its previous comment claimed the opposite. `GuidedRecordInput` has no
    // account-id, store-token or fingerprint field, so every "secret" it swept for was a value
    // `buildGuidedRecord` is never handed: the loop could not fail. The fix is to feed the canaries
    // through the one channel that genuinely reaches the builder — `session.signals` — and to sweep
    // RECURSIVELY, because the sibling key-shape test pins only TOP-LEVEL keys and a nested addition
    // under `record.session` was invisible to the whole file.
    const record = buildGuidedRecord(
      input({
        boundThisRun: true,
        session: {
          ...session(),
          signals: {
            urlCategory: "seller-center",
            loggedInSignal: true,
            sellerShellSignal: true,
            commerceIdCandidate: STORE_TOKEN,
            storeUrlPathCandidate: null,
            accountScopeCandidate: null,
          },
        },
      }),
    );

    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.entries(v).forEach(([k, val]) => (strings.push(k), walk(val)));
    };
    walk(record);
    const serialized = strings.join(" ");

    for (const secret of [
      ACCOUNT,
      STORE_TOKEN,
      "100200300",
      USER,
      fingerprintHash(STORE_TOKEN),
      sellerAccountFingerprint(ACCOUNT)!,
    ]) {
      expect(serialized, `leaked ${secret.slice(0, 16)}`).not.toContain(secret);
    }
  });

  it("keeps its nested shape pinned, not only its top-level keys", () => {
    // The gap the vacuous sweep left open: one added nested field — say the raw store token copied out of
    // `signals` — reached the on-disk record with the whole suite green.
    const record = buildGuidedRecord(input());
    expect(Object.keys(record.session).sort()).toEqual([
      "boundShopDisplayName",
      "boundThisRun",
      "driftReason",
      "observedShopName",
      "reason",
      "reverifiedAtBarriers",
      "shopNameDiffers",
      "shopNameSelectorIndex",
      "userIdSelectorIndex",
      "verdict",
    ]);
    expect(Object.keys(record.review).sort()).toEqual([
      "candidateRowCount",
      "failureReason",
      "matchCount",
      "matchMode",
      "matched",
      "matchedSource",
      "operatorConfirmed",
      "outline",
      "rowsTruncated",
      "scanCount",
      "tokensTruncated",
    ]);
    expect(Object.keys(record.composer).sort()).toEqual([
      "draftDisplayed",
      "draftEntered",
      "entryTransition",
      "operatorOutcome",
      "reachedBarrier",
      "verification",
    ]);
  });

  it("never pairs the success terminal with a run that skipped a barrier", () => {
    // COMPOSER_ABORT is the milestone's success terminal, and a stale abort sentinel could once produce it
    // from a run that aborted at LOCATE_ROW — reachedBarrier false, two barriers verified, no composer.
    // Nothing asserted the cross-field invariant, so that record read as a clean proof.
    const good = buildGuidedRecord(input());
    expect(good.terminal).toBe("COMPOSER_ABORT");
    expect(good.composer.reachedBarrier).toBe(true);
    expect(good.session.reverifiedAtBarriers).toBe(3);
    expect(good.composer.entryTransition).not.toBeNull();
  });

  it("reports which calibrated selector resolved, so a stop says what to fix", () => {
    const record = buildGuidedRecord(input());
    expect(record.session.userIdSelectorIndex).toBe(0);
    expect(record.session.shopNameSelectorIndex).toBe(0);
    const unread = buildGuidedRecord(input({ session: null, terminal: "ACCOUNT_PREFLIGHT_FAILED" }));
    expect(unread.session.userIdSelectorIndex).toBe(-1);
  });

  it("keeps the shop names — which make a rename legible — and never the user id", () => {
    const record = buildGuidedRecord(input({ session: session({ shopNameDiffers: true }) }));
    expect(record.session.observedShopName).toBe(SHOP);
    expect(record.session.boundShopDisplayName).toBe(SHOP);
    expect(record.session.shopNameDiffers).toBe(true);
    expect(JSON.stringify(record)).not.toContain(USER);
  });

  it("exposes exactly the expected top-level shape — no field may be added unnoticed", () => {
    expect(Object.keys(buildGuidedRecord(input())).sort()).toEqual([
      "channel",
      "composer",
      "review",
      "runId",
      "sellerAccountBinding",
      "session",
      "terminal",
    ]);
  });
});
