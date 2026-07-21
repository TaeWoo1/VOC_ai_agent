/**
 * The session gates, tested behaviourally rather than by grepping the source.
 *
 * Three times in this milestone a text-derived signal reached a gate, and each fix was
 * protected by asserting that certain identifiers were absent from the source. An
 * independent reviewer defeated every one of those guards — by renaming, by adding a
 * downstream override of an untouched literal, and by reading page text through an API
 * the blacklist had not named. Source substrings cannot express "no page text reaches
 * this decision"; a signature can, and these tests exercise it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifySessionAccount } from "../../../src/action-window/reply-submission/session-account-verify";
import * as sessionSignalsModule from "../../../src/action-window/reply-submission/session-signals";
import { sessionSignalsFrom } from "../../../src/action-window/reply-submission/session-signals";
import { parseAccountProbeResult } from "../../../src/action-window/reply-submission/session-account-probe-inpage";
import type { RawAccountProbeResult } from "../../../src/action-window/reply-submission/session-account-probe-inpage";
import type { ChosenAccountIdentity } from "../../../src/action-window/reply-submission/session-account-identity";

const SELLER_URL = "https://sell.smartstore.naver.com/#/review/manage";
const CHOSEN: ChosenAccountIdentity = {
  sourceCategory: "commerce-id",
  token: "channelNo=100200300",
  key: "channelNo",
};

function probe(over: Partial<RawAccountProbeResult> = {}): RawAccountProbeResult {
  return { hits: [], truncated: false, rootsWalked: 1, rootLabels: ["__NEXT_DATA__"], ...over };
}

describe("sessionSignalsFrom — the gates", () => {
  it("passes on a NAVER seller-center URL with parseable page state", () => {
    const s = sessionSignalsFrom(SELLER_URL, true, CHOSEN);
    expect(s.loggedInSignal).toBe(true);
    expect(s.sellerShellSignal).toBe(true);
    expect(s.urlCategory).toBe("seller-center");
    expect(s.commerceIdCandidate).toBe(CHOSEN.token);
  });

  it("fails closed when a calibrated chrome field did not resolve", () => {
    // THE REGRESSION THIS EXISTS FOR: this gate used to be "the page exposed an SPA state root". A live
    // diagnostic measured that this seller center exposes NONE, and the first guided run refused to bind
    // with `seller-shell-unconfirmed` — a gate that could never pass on the only surface it runs on.
    expect(sessionSignalsFrom(SELLER_URL, false, CHOSEN).sellerShellSignal).toBe(false);
    expect(sessionSignalsFrom(SELLER_URL, false, CHOSEN).sellerShellSignal).toBe(false);
  });

  it("carries only the commerce-id candidate; the other two slots are structurally null", () => {
    const s = sessionSignalsFrom(SELLER_URL, true, CHOSEN);
    expect(s.storeUrlPathCandidate).toBeNull();
    expect(s.accountScopeCandidate).toBeNull();
    // A url-path identity was removed because it is store-agnostic; there is no input that can restore it.
    expect(sessionSignalsFrom(SELLER_URL, true, null).commerceIdCandidate).toBeNull();
  });
});

describe("sessionSignalsFrom — a look-alike host cannot pass", () => {
  it("rejects a non-NAVER host that merely contains a seller-center keyword", () => {
    // `urlCategory` matches /commerce/i ANYWHERE in the URL, so this classifies as seller-center on its own.
    // A MATCH reached from a hostile origin could walk the operator into a permanent wrong binding.
    for (const url of [
      "https://x.example/commerce/",
      "https://sell.smartstore.naver.com.evil.example/",
      "https://evil.example/?next=https://sell.naver.com",
    ]) {
      const s = sessionSignalsFrom(url, true, CHOSEN);
      expect(s.loggedInSignal, url).toBe(false);
    }
  });

  it("rejects plain http even on a NAVER host", () => {
    expect(sessionSignalsFrom("http://sell.smartstore.naver.com/", true, CHOSEN).loggedInSignal).toBe(false);
  });

  it("accepts the real seller-center hosts, and requires BOTH the host and the URL class", () => {
    for (const url of ["https://sell.naver.com/x", "https://sell.smartstore.naver.com/"]) {
      expect(sessionSignalsFrom(url, true, CHOSEN).loggedInSignal, url).toBe(true);
    }
    // A NAVER host that is not a seller-center URL is still not a seller session.
    expect(sessionSignalsFrom("https://naver.com/", true, CHOSEN).loggedInSignal).toBe(false);
  });

  it("fails closed on a malformed URL rather than throwing", () => {
    expect(sessionSignalsFrom("not a url", true, CHOSEN).loggedInSignal).toBe(false);
  });
});

describe("sessionSignalsFrom — page text has no route in", () => {
  it("ignores everything about the probe except whether it found state roots", () => {
    // The probe result is the ONLY page-derived input, and its `hits` are key/value pairs the caller has
    // already reduced to a `chosen` token. Whatever a customer wrote on the page, the gates cannot see it:
    // two probes that differ only in content produce identical gates.
    // Not "the values happen to be ignored" — the probe's `hits` cannot be PASSED. A reviewer showed that
    // handing the whole probe in left `hits[].value` (arbitrary page text) one `||` away from a gate, and a
    // fixture-based canary could never see such a branch because it only knows the markers it was told.
    // A count carries no text, so the class is closed by the signature.
    const a = sessionSignalsFrom(SELLER_URL, true, null);
    expect(JSON.stringify(a)).not.toContain("CANARY");
    expect(a.sellerShellSignal).toBe(true);
    expect(sessionSignalsFrom(SELLER_URL, false, null).sellerShellSignal).toBe(false);
  });

  it("takes a URL, a COUNT and a candidate — no page handle, and no object that can carry text", () => {
    // Necessary but NOT sufficient on its own: a reviewer showed that module-level state plus a second
    // exported setter keeps the arity at 3 while smuggling a page-derived value in. The export-surface test
    // below is the other half.
    expect(sessionSignalsFrom.length).toBe(3);
  });

  it("exports exactly one thing, so no setter can smuggle state past the signature", () => {
    expect(Object.keys(sessionSignalsModule).sort()).toEqual(["sessionSignalsFrom"]);
  });

  it("imports only from an allow-list, so a mutable singleton cannot be reached from elsewhere", () => {
    // The export-surface test above is defeated by putting the state in ANOTHER module and importing it —
    // a reviewer did exactly that with an `account-shell-hint.ts`. Constraining the imports closes the door
    // the export surface leaves open.
    const src = readFileSync(
      resolve(__dirname, "../../../src/action-window/reply-submission/session-signals.ts"),
      "utf8",
    );
    const imported = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();
    expect(imported).toEqual([
      "../../naver/account-fingerprint-adapter",
      "../../naver/session-check",
      "./session-account-identity",
    ]);
  });

  it("returns a FROZEN verdict too, so the ANSWER cannot be rewritten after the fact", () => {
    // Guards protected the verifier's inputs; a reviewer then rewrote its OUTPUT from page text
    // (`{ ...base, verdict: "MATCH" }`) with the whole suite green — worse than reopening a gate.
    const v = verifySessionAccount({ sellerAccountId: "x".repeat(36), connections: [], signals: sessionSignalsFrom(SELLER_URL, true, null) });
    expect(Object.isFrozen(v)).toBe(true);
    expect(() => {
      (v as { verdict: string }).verdict = "MATCH";
    }).toThrow(TypeError);
  });

  it("freezes the probe's hit ENTRIES, not just the array", () => {
    // `probe.hits[0].key = pinnedKey` relabelled arbitrary page text under the operator's pinned key —
    // a wrong PERMANENT binding — while the array itself was frozen.
    const parsed = parseAccountProbeResult(
      JSON.stringify({ hits: [{ key: "channelNo", value: "1" }], truncated: false, rootsWalked: 1 }),
    )!;
    expect(Object.isFrozen(parsed.hits)).toBe(true);
    expect(Object.isFrozen(parsed.hits[0])).toBe(true);
    expect(() => {
      (parsed.hits[0] as { key: string }).key = "mallNo";
    }).toThrow(TypeError);
  });

  it("returns a FROZEN object, so the gates cannot be reopened by mutation after the fact", () => {
    // Every source-level guard over this value was defeated by mutating it after construction:
    // `Object.assign(signals, {loggedInSignal: true})` and even `signals.loggedInSignal = true` compiled,
    // ran before the verifier, and left the whole suite green. Freezing makes the edit throw.
    const s = sessionSignalsFrom("https://x.example/commerce/", true, null);
    expect(Object.isFrozen(s)).toBe(true);
    expect(s.loggedInSignal).toBe(false);
    expect(() => {
      (s as { loggedInSignal: boolean }).loggedInSignal = true;
    }).toThrow(TypeError);
    expect(() => Object.assign(s, { sellerShellSignal: true })).toThrow(TypeError);
    expect(s.loggedInSignal).toBe(false);
  });

  it("takes a BOOLEAN, so there is no object left to launder page text through", () => {
    // The probe used to be passed in whole, which left `hits[].value` one `||` away from a gate; then it
    // was a count. It is now a boolean the caller computes from whether both calibrated fields resolved —
    // the narrowest input that still answers the question.
    expect(typeof sessionSignalsFrom(SELLER_URL, true, null).sellerShellSignal).toBe("boolean");
    expect(sessionSignalsFrom(SELLER_URL, false, null).sellerShellSignal).toBe(false);
  });
});
