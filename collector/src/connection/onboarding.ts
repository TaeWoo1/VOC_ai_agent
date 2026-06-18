/**
 * Offline bind orchestration — composes the persisted connection, sanitized
 * structural signals, the fingerprint extractor, and the binding helpers into one
 * pure-ish step. NO browser, Playwright, network, or backend: it takes
 * already-sanitized `AccountFingerprintRawSignals` (the future live CLI will fill
 * these from a logged-in page) and a local store file, and returns a sanitized
 * result or a fixed error category.
 *
 * Product rule: this assumes the human has ALREADY manually logged in and
 * manually selected the intended NAVER account/store. It never auto-selects and
 * never guesses on ambiguous candidates — an ambiguous/absent identity is a
 * conservative non-bind, not a best-effort pick.
 *
 * SAFETY CONTRACT: the raw identity token is consumed in-line (`fingerprintHash`)
 * and never logged, never persisted raw, never returned. Results/errors carry only
 * fixed categories — never a token, hash, file path, URL, or raw signal value.
 */

import {
  completeManualAccountSelection,
} from "./workflow";
import { fingerprintHash } from "./connection";
import {
  loadConnectionRegistryFromFile,
  saveConnectionRegistryToFile,
} from "./store";
import { connectionToStatusSnapshot } from "./status-bridge";
import {
  extractAccountFingerprint,
  type FingerprintUnresolvableReason,
} from "../naver/account-fingerprint";
import {
  toAccountFingerprintInput,
  type AccountFingerprintRawSignals,
} from "../naver/account-fingerprint-adapter";
import type { ConnectionRegistry } from "./registry";
import type { CollectorState } from "../status";
import type { FingerprintSourceCategory, Platform, ConnectionStatus } from "./types";

export type BindErrorCategory =
  | "invalid-input"
  | "connection-not-found"
  | "fingerprint-not-resolvable"
  | "store-load-failed"
  | "store-save-failed";

/** Sanitized success result — no token, no hash, no path, no raw identity. */
export interface BindResult {
  connectionId: string;
  platform: Platform;
  connectionStatus: ConnectionStatus;
  sourceCategory: FingerprintSourceCategory;
  statusState: CollectorState;
  statusDetail: string;
  updatedAt: string;
}

export type BindOutcome =
  | { ok: true; result: BindResult }
  | { ok: false; errorCategory: BindErrorCategory; reasonCategory?: FingerprintUnresolvableReason };

/** Injectable store side effects (defaults to the real local-file store). */
export interface ConnectionStoreIO {
  load(path: string): ConnectionRegistry;
  save(path: string, registry: ConnectionRegistry): void;
}

const DEFAULT_IO: ConnectionStoreIO = {
  load: loadConnectionRegistryFromFile,
  save: saveConnectionRegistryToFile,
};

export interface BindFromSignalsOptions {
  connectionId: string;
  storeFile: string;
  rawSignals: AccountFingerprintRawSignals;
  /** ISO timestamp, passed in for deterministic output. */
  now: string;
  /** Optional SellerOps alias override (user's own label); defaults to the existing alias. */
  userProvidedDisplayNameOverride?: string;
}

/**
 * Bind a pending connection to the account/store the user already selected, from
 * sanitized structural signals. Loads the registry, finds the connection, extracts
 * a fingerprint, and — only when resolvable — hashes it, binds (CONNECTED), and
 * saves. Every failure path is a fixed category; nothing raw is bound, saved, or
 * returned on a non-resolvable / not-found / store error.
 */
export function runConnectionBindFromSignals(
  opts: BindFromSignalsOptions,
  io: ConnectionStoreIO = DEFAULT_IO,
): BindOutcome {
  if (!opts.connectionId || opts.connectionId.trim().length === 0) {
    return { ok: false, errorCategory: "invalid-input" };
  }

  let registry: ConnectionRegistry;
  try {
    registry = io.load(opts.storeFile);
  } catch {
    // Malformed/unreadable store — never echo the raw cause or path.
    return { ok: false, errorCategory: "store-load-failed" };
  }

  const connection = registry.get(opts.connectionId);
  if (connection === undefined) {
    return { ok: false, errorCategory: "connection-not-found" };
  }

  const fingerprintInput = toAccountFingerprintInput(opts.rawSignals);
  const extraction = extractAccountFingerprint(fingerprintInput);
  if (!extraction.resolvable) {
    // Conservative non-bind: nothing is hashed, bound, or saved.
    return {
      ok: false,
      errorCategory: "fingerprint-not-resolvable",
      reasonCategory: extraction.reasonCategory,
    };
  }

  // Resolvable: consume the raw token immediately into a one-way hash.
  const bound = completeManualAccountSelection(
    connection,
    fingerprintHash(extraction.rawIdentityToken),
    extraction.sourceCategory,
    opts.userProvidedDisplayNameOverride ?? connection.userProvidedDisplayName,
    opts.now,
  );

  registry.upsert(bound);
  try {
    io.save(opts.storeFile, registry);
  } catch {
    return { ok: false, errorCategory: "store-save-failed" };
  }

  const snapshot = connectionToStatusSnapshot(bound, opts.now);
  return {
    ok: true,
    result: {
      connectionId: bound.connectionId,
      platform: bound.platform,
      connectionStatus: bound.connectionStatus,
      sourceCategory: extraction.sourceCategory,
      statusState: snapshot.state,
      statusDetail: snapshot.detail ?? "",
      updatedAt: snapshot.updatedAt,
    },
  };
}
