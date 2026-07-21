/**
 * Pure selection of a NAVER seller/store identity token from read-only evidence.
 *
 * Sits between the in-page probe (which produces raw key/value hits) and the existing offline fingerprint chain
 * (`toAccountFingerprintInput` -> `extractAccountFingerprint` -> `fingerprintHash`).
 *
 * WHY THIS MODULE EXISTS AT ALL — the precedence/ambiguity split:
 * `extractAccountFingerprint` treats two DISTINCT tokens as
 * `ambiguous-seller-context`. That rule is correct for its own design, where several
 * candidates are the SAME identity seen under different labels. It is wrong for
 * candidates of different KINDS: a commerce id ("12345") and a store url path
 * ("mystore") are both correct and will never be equal, so handing both to the
 * extractor would make every page ambiguous and nothing could ever bind.
 *
 * So this module hands down at most ONE candidate - the key the product owner has
 * pinned - and nothing else. The extractor's ambiguity rule still does real work — it guards the
 * case this module cannot see — and this module applies the same conservatism
 * WITHIN a source: a key that appears with two different values is DROPPED, never
 * resolved by picking.
 *
 * THE TOKEN CARRIES ITS KEY (`channelNo=12345`, not `12345`). Two different keys
 * holding the same number would otherwise digest identically and one could stand in
 * for the other. It also means a MISMATCH is diagnosable: the run record reports
 * which key was read this run, so key drift is distinguishable from a real
 * store change.
 *
 * SAFETY CONTRACT: raw values live only in the returned token, which the caller
 * consumes immediately into `fingerprintHash`. Only KEY NAMES (NAVER's own API field
 * names, not identity) and counts are ever reported or logged.
 *
 * Pure — no fs, no browser, no network, no clock.
 */

import type { FingerprintSourceCategory } from "../../connection/types";

/**
 * Candidate state keys that may carry a stable NAVER store identity. This is an
 * ALLOW-LIST and a report order, not a precedence order: only the pinned key is ever
 * chosen, so being listed first confers nothing.
 *
 * [EXTERNAL-RESEARCH — NOT REPOSITORY-VERIFIED] This list is a hypothesis about
 * NAVER's field naming. Nothing downstream trusts it: an absent key yields
 * `UNAVAILABLE` (fail closed), never a guess, and the first live run reports which
 * of these keys actually appear so the list can be narrowed to what is real.
 */
export const ACCOUNT_ID_KEYS: readonly string[] = [
  "channelNo",
  "channelId",
  "mallNo",
  "mallSeq",
  "merchantNo",
  "storeNo",
  "storeId",
  "sellerNo",
  "accountNo",
];

/**
 * A value only qualifies as an identity if it is a compact, opaque id. Free text,
 * whitespace, punctuation, and anything long enough to be a name or a sentence are
 * rejected — an identity we cannot recognise is better than a wrong one.
 */
export const ACCOUNT_ID_VALUE_PATTERN = /^[A-Za-z0-9_-]{2,40}$/;

/** Upper bound on hits carried out of a scan, so a hostile page cannot flood us. */
export const MAX_ACCOUNT_ID_HITS = 200;

/** One `key: value` observation from parsed page state. */
export interface AccountIdHit {
  key: string;
  value: string;
  /**
   * Which state root produced it (`__NEXT_DATA__`, `inline-json`, …). Diagnostics
   * only — never consulted when choosing an identity, so it cannot influence a gate.
   * Non-sensitive: a global variable name, never page content.
   */
  root?: string;
}

export interface ChosenAccountIdentity {
  sourceCategory: FingerprintSourceCategory;
  /** Raw, self-describing identity token. Never logged — hashed by the caller. */
  token: string;
  /** The state/response key this token came from. Loggable — it is a field name. */
  key: string;
}

/** Log-safe view of what a scan saw. Key names and counts only — never a value. */
export interface AccountIdentityEvidence {
  /** Allow-listed keys observed at least once, in precedence order. */
  keysPresent: string[];
  /** Keys dropped because they carried more than one distinct value. */
  keysConflicting: string[];
  /** True when distinct evidence overflowed the cap — the view was incomplete. */
  hitsTruncated: boolean;
  /** The key the product owner pinned, or `null` while the decision is outstanding. */
  pinnedKey: string | null;
  chosenSourceCategory: FingerprintSourceCategory | null;
  chosenKey: string | null;
}

/**
 * Group hits by key, keeping only keys whose value is unambiguous. A key seen with
 * two different values is dropped: on a page that can show two stores, picking one
 * is exactly the guess this whole chain exists to avoid.
 *
 * THE CAP COUNTS DISTINCT PAIRS, AND OVERFLOWING IT IS FATAL, both deliberately.
 * An earlier version capped the RAW hit list before detecting conflicts, which is
 * strictly worse in two ways: a review list repeating one store's id on every row
 * would exhaust the budget with redundant evidence, and — far worse — evidence of a
 * SECOND store arriving after the cap would be sliced away, turning a conflict into
 * a confident answer. Counting distinct pairs makes repetition free, and refusing
 * outright on overflow means a truncated view can never be reported as a clean one.
 */
function unambiguousByKey(hits: readonly AccountIdHit[]): {
  resolved: Map<string, string>;
  conflicting: string[];
  truncated: boolean;
} {
  const values = new Map<string, Set<string>>();
  let distinct = 0;
  let truncated = false;
  for (const hit of hits) {
    if (!ACCOUNT_ID_KEYS.includes(hit.key)) continue;
    if (!ACCOUNT_ID_VALUE_PATTERN.test(hit.value)) continue;
    const set = values.get(hit.key) ?? new Set<string>();
    if (!set.has(hit.value)) {
      if (distinct >= MAX_ACCOUNT_ID_HITS) {
        truncated = true;
        break;
      }
      distinct += 1;
    }
    set.add(hit.value);
    values.set(hit.key, set);
  }
  const resolved = new Map<string, string>();
  const conflicting: string[] = [];
  for (const [key, set] of values) {
    if (set.size === 1) resolved.set(key, [...set][0]!);
    else conflicting.push(key);
  }
  return { resolved, conflicting, truncated };
}

export interface ChooseAccountIdentityInput {
  /** Hits from page state, in any order. */
  hits: readonly AccountIdHit[];
  /**
   * The ONE key allowed to carry identity, decided by the product owner from live
   * evidence. `null` means undecided, and undecided yields NO identity.
   *
   * WHY THIS IS REQUIRED RATHER THAN INFERRED: `ACCOUNT_ID_KEYS` is a hypothesis
   * (see its own annotation). Picking the strongest key that happens to be present
   * will, on a page where the real store key is absent, happily bind a build-time
   * CONSTANT such as `channelId: "default"` — byte-identical across every store the
   * operator owns. That is a permanent false MATCH, and it is the exact fail-open
   * shape the url-path source was deleted for. A key is eligible only once it has
   * been shown to DISCRIMINATE between stores, and a single run cannot show that.
   * So the runtime refuses to choose one for you.
   */
  pinnedKey: string | null;
  /**
   * True when the in-page walk discarded evidence (its node, depth, hit or
   * inline-JSON ceilings). It must be threaded
   * in, not inferred — this function cannot see what never reached it, and evidence
   * of a SECOND store is exactly what a cap drops first. Truncated evidence yields
   * no identity at all.
   */
  evidenceTruncated?: boolean;
}

/**
 * Choose at most one identity token: the PINNED key, when it is present and
 * unambiguous, as a `commerce-id`. Returns `null` when nothing qualifies — including
 * when no key is pinned — which the caller must treat as UNAVAILABLE.
 *
 * WHY THERE IS NO URL-PATH FALLBACK (removed after review found it unsafe):
 * a seller center's path is the same for every store the operator owns
 * (`/naver/review/manage` and the like). Binding that path would produce a
 * fingerprint that matches EVERY store — a permanent, silent false `MATCH`, and one
 * that a mid-session store switch would sail straight through because the path
 * never changes. Nothing verified that any seller-center path varies by store, and
 * unlike a missing key — which fails closed — a store-agnostic path fails OPEN.
 * That asymmetry is the whole argument: a source whose failure mode is a false
 * match must not exist until it is proven to discriminate.
 *
 * `account-scope` is likewise not produced: no read-only source for it has been
 * verified, and inventing one would be a guess.
 */
export function chooseAccountIdentity(
  input: ChooseAccountIdentityInput,
): { chosen: ChosenAccountIdentity | null; evidence: AccountIdentityEvidence } {
  const grouped = unambiguousByKey(input.hits);
  const { resolved, conflicting } = grouped;
  const keysPresent = ACCOUNT_ID_KEYS.filter((k) => resolved.has(k));

  // Truncation ANYWHERE means we did not see everything the page offered, so no
  // answer drawn from it can be trusted. This is the whole lesson of [D-036] applied
  // to identity: a miss inside a truncated view proves nothing, and the one thing a
  // cap is most likely to discard is the evidence that would have contradicted us.
  const truncated = grouped.truncated || input.evidenceTruncated === true;

  // ANY conflicting key refuses the whole read — not just that key.
  //
  // Falling through to the next unambiguous key looks conservative and is not. Store
  // A emits `channelNo=A` and `mallNo=A`; the operator switches to store B, which
  // emits only `channelNo=B`. The accumulated evidence conflicts on `channelNo`, so
  // that key is dropped — and precedence then happily returns `mallNo=A`, binding or
  // matching STORE A while the operator is looking at store B. That is the same
  // "resolve by picking" this module exists to refuse, one level up: a page showing
  // two identities is a page we cannot read, whatever else it agrees on.
  const conflicted = conflicting.length > 0;
  const pinned = input.pinnedKey !== null && ACCOUNT_ID_KEYS.includes(input.pinnedKey)
    ? input.pinnedKey
    : null;
  const eligible = truncated || conflicted || pinned === null ? undefined : pinned;
  const chosenKey = eligible !== undefined && resolved.has(eligible) ? eligible : undefined;
  const chosen: ChosenAccountIdentity | null =
    chosenKey === undefined
      ? null
      : {
          sourceCategory: "commerce-id",
          token: `${chosenKey}=${resolved.get(chosenKey)!}`,
          key: chosenKey,
        };

  return {
    chosen,
    evidence: {
      keysPresent,
      keysConflicting: conflicting.sort(),
      hitsTruncated: truncated,
      pinnedKey: pinned,
      chosenSourceCategory: chosen?.sourceCategory ?? null,
      chosenKey: chosen?.key ?? null,
    },
  };
}
