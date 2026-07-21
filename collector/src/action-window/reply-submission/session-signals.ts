/**
 * The ONE producer of `AccountFingerprintRawSignals` for the guided session.
 *
 * WHY THIS IS A SEPARATE, PURE FUNCTION — it is a safety property expressed as a type
 * signature. Three times in this milestone a text-derived signal reached a session
 * gate (a network payload scan, a whole-document marker scan, a chrome-scoped marker
 * scan), and the last of those was fail-OPEN: a customer's review body could supply
 * the word the gate looked for, satisfying the gate that guards a PERMANENT binding.
 *
 * Each time, the fix was guarded by asserting that certain identifiers did not appear
 * in the source. An independent reviewer defeated every one of those guards by
 * renaming, by adding a downstream override, and by reading page text through an API
 * the blacklist had not named. Source substrings cannot express "no page text reaches
 * this decision".
 *
 * A signature can. This function takes a URL, a COUNT, and an already-chosen identity
 * — no page handle, no evaluate, no DOM, and deliberately not the probe object
 * either: passing the probe would leave `hits[].value` (arbitrary page-derived text)
 * one `||` away from a gate, and a reviewer demonstrated exactly that one-line edit.
 * A count cannot carry text. The CLI has one call to it and passes the result
 * straight to `verifySessionAccount`.
 *
 * Pure — no fs, no browser, no network, no clock.
 */

import type { AccountFingerprintRawSignals } from "../../naver/account-fingerprint-adapter";
import { urlCategory } from "../../naver/session-check";
import type { ChosenAccountIdentity } from "./session-account-identity";

/**
 * Hosts a NAVER seller session may legitimately live on.
 *
 * `urlCategory` matches `/commerce/i` ANYWHERE in the URL, so `https://x.example/commerce/`
 * classifies as `seller-center`. That helper is shared and pre-existing; rather than
 * change it under its other callers, the guided session adds the host check it needs.
 * An operator would have to be navigated somewhere hostile for this to matter, but a
 * `MATCH` there could walk them into a permanent wrong binding.
 */
const NAVER_HOST_SUFFIX = ".naver.com";

function isNaverHost(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== "https:") return false;
    return hostname === "naver.com" || hostname.endsWith(NAVER_HOST_SUFFIX);
  } catch {
    return false;
  }
}

/**
 * Derive the session gates from the URL and the parsed probe result.
 *
 * `loggedInSignal` — a NAVER seller-center URL. Named for the field it fills, but it
 * is NOT an authentication check, and nothing downstream should read it as one.
 *
 * `sellerShellSignal` — BOTH calibrated chrome fields resolved to well-formed values.
 *
 * It used to be "the page exposed at least one SPA state root", carried over from the
 * deleted SPA-state design. A live diagnostic then MEASURED that this seller center
 * exposes none, and the first live guided run duly refused to bind with
 * `seller-shell-unconfirmed` — a gate that could never pass on the only surface it runs
 * on. That is a worse failure than a weak gate: it is a gate that is always shut.
 *
 * Stated honestly, the replacement is not an INDEPENDENT signal — it is close to
 * "the identity was readable", which `verifyChromeIdentity` also requires. It earns its
 * place by covering the BIND path, which runs before any verdict exists. The gates that
 * do independent work are the https `*.naver.com` host check and the operator's own
 * confirmation; this one only ensures a bind cannot happen off a page whose calibrated
 * chrome did not resolve.
 */
export function sessionSignalsFrom(
  url: string,
  chromeIdentityReadable: boolean,
  chosen: ChosenAccountIdentity | null,
): Readonly<AccountFingerprintRawSignals> {
  const sellerCenter = urlCategory(url) === "seller-center" && isNaverHost(url);
  // FROZEN, and that is the guarantee rather than decoration. A reviewer defeated every source-level guard
  // over this value by MUTATING it after construction — `Object.assign(signals, {loggedInSignal: true})` and
  // even `signals.loggedInSignal = true` compiled, ran before the verifier, and left the whole suite green.
  // A frozen object turns that into a TypeError at the point of the edit, in every environment, with no
  // test needing to have anticipated the spelling.
  return Object.freeze({
    // Report the TRUE class. Relabelling a non-NAVER `…/commerce/` URL as seller-center would make the run
    // record misdescribe a hostile origin, even though `loggedInSignal` already blocks it.
    urlCategory: sellerCenter ? "seller-center" : isNaverHost(url) ? urlCategory(url) : "other",
    loggedInSignal: sellerCenter,
    sellerShellSignal: chromeIdentityReadable,
    commerceIdCandidate: chosen?.sourceCategory === "commerce-id" ? chosen.token : null,
    storeUrlPathCandidate: null,
    accountScopeCandidate: null,
  });
}
