/**
 * Pure summariser for the READ-ONLY store-identity diagnostic.
 *
 * Answers one question and refuses to answer any other: **which allow-listed identity
 * keys does the trusted page-load-time NAVER state actually expose, how many distinct
 * values does each carry, and which root produced it?**
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *  - It does not choose an identity. `chooseAccountIdentity` requires a PINNED key
 *    precisely because a key must be shown to DISCRIMINATE between stores before it
 *    may be bound, and one run cannot show that. This module gathers the evidence for
 *    that decision; it does not make it.
 *  - It does not persist anything, and nothing downstream of it can bind.
 *  - It never reports a raw value. A key name is NAVER's own API field name and a root
 *    label is a global variable name — neither is identity. A value is.
 *
 * WHY A TRUNCATED FINGERPRINT: the point of a later second run is to see whether a
 * key's value CHANGES between two stores, and that comparison needs a stable handle.
 * It reuses `fingerprintHash` over the same `key=value` token a real binding would
 * use, so a diagnostic digest and a bound digest match at their shared prefix.
 *
 * IT IS NOT A REDACTION, and an earlier version of this comment wrongly said it was.
 * The key name is printed beside the digest, so the preimage is `channelNo=<id>` over
 * a space of a few hundred million — a reviewer measured the full 9-digit space at
 * roughly nine minutes on one core. This is a SIZE reduction and a comparison handle.
 * What actually protects the value is that the record is owner-only (0600), local, and
 * never leaves the machine.
 *
 * Pure — no fs, no browser, no network, no clock.
 */

import { fingerprintHash } from "../../connection/connection";
import {
  ACCOUNT_ID_KEYS,
  ACCOUNT_ID_VALUE_PATTERN,
  type AccountIdHit,
} from "./session-account-identity";
import { TRUSTED_ROOT_LABELS } from "./session-account-probe-inpage";

/** Characters of digest kept. Enough to compare two runs; useless for recovery. */
export const DIAGNOSTIC_FINGERPRINT_CHARS = 12;

/** What one allow-listed key looked like on this page. Never carries a value. */
export interface KeyObservation {
  key: string;
  /** Roots that produced this key, deduped and sorted. Global variable names only. */
  roots: string[];
  /** How many DISTINCT values the key carried. 1 is the only usable answer. */
  distinctValueCount: number;
  /** True when the key carried more than one value — it cannot identify a store. */
  conflicting: boolean;
  /**
   * Truncated digest of `key=value`, present ONLY when the key is single-valued.
   * A conflicting key has no single value to fingerprint, and inventing one would
   * suggest a stability the evidence does not show.
   */
  truncatedFingerprint: string | null;
}

export interface StoreIdentityDiagnostic {
  /** Every allow-listed key seen, in allow-list order. */
  observations: KeyObservation[];
  /** Keys that are single-valued — the only ones that could ever be pinned. */
  candidateKeys: string[];
  /** Single-valued AND seen in an SPA state root. The subset the success test is allowed to use. */
  trustedCandidateKeys: string[];
  /** Keys seen with more than one value on this page. */
  conflictingKeys: string[];
  /** Roots walked, in order. Non-sensitive labels. */
  rootLabels: string[];
  /** True when a probe ceiling stopped the walk — a miss then proves nothing. */
  truncated: boolean;
  /**
   * The diagnostic's own success test: at least one single-valued candidate from a
   * trusted root. It does NOT mean the key discriminates between stores.
   */
  foundStableCandidate: boolean;
}

/**
 * Summarise probe hits. Values are consumed here into truncated digests and never
 * returned. A key whose value fails the shared shape check is ignored exactly as the
 * real chooser would ignore it, so the diagnostic reports the same key set the
 * binding path would see — reporting a key the chooser would drop would send the
 * operator to pin something that could never work.
 */
export function summariseStoreIdentity(
  hits: readonly AccountIdHit[],
  rootLabels: readonly string[],
  truncated: boolean,
): StoreIdentityDiagnostic {
  const byKey = new Map<string, { values: Set<string>; roots: Set<string> }>();
  for (const hit of hits) {
    if (!ACCOUNT_ID_KEYS.includes(hit.key)) continue;
    if (!ACCOUNT_ID_VALUE_PATTERN.test(hit.value)) continue;
    const entry = byKey.get(hit.key) ?? { values: new Set<string>(), roots: new Set<string>() };
    entry.values.add(hit.value);
    // Defensive against a null/odd root: this value crosses from an untrusted page, and a TypeError here
    // would kill the run after a long operator wait with no record written.
    if (typeof hit.root === "string" && hit.root.length > 0) entry.roots.add(hit.root);
    byKey.set(hit.key, entry);
  }

  const observations: KeyObservation[] = ACCOUNT_ID_KEYS.filter((k) => byKey.has(k)).map((key) => {
    const { values, roots } = byKey.get(key)!;
    const single = values.size === 1 ? [...values][0]! : null;
    return {
      key,
      roots: [...roots].sort(),
      distinctValueCount: values.size,
      conflicting: values.size > 1,
      truncatedFingerprint:
        single === null
          ? null
          : fingerprintHash(`${key}=${single}`).slice(0, DIAGNOSTIC_FINGERPRINT_CHARS),
    };
  });

  const candidateKeys = observations.filter((o) => !o.conflicting).map((o) => o.key);
  // "From a TRUSTED source" is part of the success criterion, so it has to be part of the test. A key seen
  // only in an SEO `ld+json` blob — or with no root at all — is the weakest evidence on the page and must
  // not read as success.
  const trustedCandidateKeys = observations
    .filter((o) => !o.conflicting && o.roots.some((r) => TRUSTED_ROOT_LABELS.includes(r)))
    .map((o) => o.key);
  return {
    observations,
    candidateKeys,
    conflictingKeys: observations.filter((o) => o.conflicting).map((o) => o.key),
    rootLabels: [...rootLabels],
    truncated,
    // A truncated walk may have hidden a second value for a key that looks single-valued
    // here, so it cannot support a "stable candidate" claim.
    trustedCandidateKeys,
    foundStableCandidate: !truncated && trustedCandidateKeys.length > 0,
  };
}
