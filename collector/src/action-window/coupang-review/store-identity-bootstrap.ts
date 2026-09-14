/**
 * **Store identity bootstrap** — the one place a raw WING 업체코드 may live, and for how long.
 *
 * ## The rule this module exists to hold
 *
 * > Raw store identity is never carried on the shared run contract. During identity bootstrap the paired
 * > seller browser may read it over authenticated loopback, and it may be stored on the backend only after
 * > the seller has confirmed it.
 *
 * Everything else about the acquisition run is unchanged: the run still compares a digest, still fails
 * closed without a MATCH, still reads no row on an unproven store, and still logs counts rather than
 * values. This module is reachable in exactly one situation — the backend had **no expectation at all**
 * (`NO_EXPECTATION`), which is the situation a seller is in before they have ever told us which store
 * this account is.
 *
 * ## Why the raw value, and not a digest
 *
 * A seller cannot confirm a hash. The thing they are being asked — "is this your store?" — can only be
 * answered against the code their own screen prints. The value travels helper → paired browser over
 * loopback, both on the seller's own machine; it reaches this product's backend only when they press the
 * confirmation, and then as a plain non-secret account fact (`seller_accounts.store_identity`).
 *
 * ## What this module must never do, and does not
 *
 * - **Never on the shared contract.** Nothing here touches the Action Window run view, whose own contract
 *   says it carries no app/store/account identity. The browser asks the helper directly.
 * - **Never logged.** Callers log `state` and counts. The value appears in no log line here or upstream.
 * - **Never persisted.** Memory only — no file, no profile, no status directory.
 * - **Never long-lived.** Bound to the account slot the run resolved, replaced by the next run on that
 *   slot, and expired by {@link BOOTSTRAP_TTL_MS}. A candidate nobody confirmed simply stops existing.
 * - **Never a chooser.** Two codes on one screen is an ambiguity this product refuses to guess at; it is
 *   reported as such and the seller types the code instead. No candidate list, no selection UI.
 */
import type { WingIdentityReading } from "./wing-identity-inpage";
import { wingStoreFingerprint, type WingStoreAssertion } from "./wing-store-identity";

/** How long an unconfirmed candidate may sit in memory. Matches the acquisition ref's own TTL. */
export const BOOTSTRAP_TTL_MS = 10 * 60_000;

/**
 * What the run could establish about which store this is, when it had nothing to compare against.
 *
 * `NONE` and `AMBIGUOUS` are different words for the same next step — the seller types the code — and they
 * are kept apart because the sentence a seller reads differs, exactly as `UNRESOLVED` is kept apart from
 * `MISMATCH` one layer down.
 */
export type StoreIdentityBootstrap =
  | { readonly state: "CANDIDATE"; readonly value: string }
  | { readonly state: "NONE" }
  | { readonly state: "AMBIGUOUS" };

/**
 * Read a bootstrap outcome from an assertion the run already made.
 *
 * Only `NO_EXPECTATION` yields anything: every other reason means the backend DID say which store this is,
 * and a run that already had an expectation is not bootstrapping — it is being compared, and its answer is
 * the comparison, not a new candidate.
 */
export function bootstrapOf(
  assertion: WingStoreAssertion,
  reading: WingIdentityReading,
): StoreIdentityBootstrap | null {
  if (assertion.reason !== "NO_EXPECTATION") return null;
  if (reading.values.length === 0) return { state: "NONE" };
  if (reading.values.length > 1) return { state: "AMBIGUOUS" };
  const only = reading.values[0] ?? "";
  // The same well-formedness the comparison requires. A token this product would refuse to fingerprint is
  // not a code worth showing a seller as theirs.
  if (wingStoreFingerprint(only) === null) return { state: "NONE" };
  return { state: "CANDIDATE", value: only };
}

interface Held {
  readonly outcome: StoreIdentityBootstrap;
  readonly expiresAtMs: number;
}

/**
 * The candidate from the most recent bootstrap run, per account slot.
 *
 * One entry per slot and the newest run wins: a candidate is about the screen that was open, and an older
 * one is about a screen that may no longer be.
 */
export class StoreIdentityBootstrapStore {
  private readonly held = new Map<string, Held>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  put(accountSlot: string, outcome: StoreIdentityBootstrap): void {
    if (accountSlot.trim() === "") return;
    this.held.set(accountSlot, { outcome, expiresAtMs: this.now() + BOOTSTRAP_TTL_MS });
  }

  /** The live candidate for a slot, or null when there is none, it expired, or it was already used. */
  peek(accountSlot: string): StoreIdentityBootstrap | null {
    const held = this.held.get(accountSlot);
    if (!held) return null;
    if (held.expiresAtMs <= this.now()) {
      this.held.delete(accountSlot);
      return null;
    }
    return held.outcome;
  }

  /** Drop a slot's candidate — used once the seller has confirmed, so the raw value stops existing. */
  clear(accountSlot: string): void {
    this.held.delete(accountSlot);
  }

  /** The single most recent live candidate across slots, for a browser that knows the run but not the slot. */
  latest(): { accountSlot: string; outcome: StoreIdentityBootstrap } | null {
    let best: { accountSlot: string; outcome: StoreIdentityBootstrap; expiresAtMs: number } | null = null;
    for (const [accountSlot, held] of this.held) {
      if (held.expiresAtMs <= this.now()) {
        this.held.delete(accountSlot);
        continue;
      }
      if (!best || held.expiresAtMs > best.expiresAtMs) {
        best = { accountSlot, outcome: held.outcome, expiresAtMs: held.expiresAtMs };
      }
    }
    return best ? { accountSlot: best.accountSlot, outcome: best.outcome } : null;
  }
}
