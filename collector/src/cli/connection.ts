/**
 * Offline connection onboarding CLI (skeleton).
 *
 *   npm run connection -- init --connection-id <id> --display-name <alias> [--store-file <path>]
 *
 * This slice is OFFLINE ONLY: it creates a pending SellerOps↔NAVER connection
 * record, persists it to the local `.connections` store, and prints a sanitized
 * status snapshot. There is NO live NAVER, browser, Playwright, fingerprint
 * extraction, or upload here — those come in a later, separately-approved slice
 * (and will be gated behind the explicit per-run approval flag). No live flag is
 * accepted yet.
 *
 * `--display-name` is the user-provided SellerOps alias (the user's own label),
 * never scraped NAVER identity. The profile name is derived from the connectionId,
 * not the display name. The printed result carries no fingerprint hash, no raw
 * NAVER identity, and no raw file path.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createPendingConnection,
  profileNameForConnection,
} from "../connection/connection";
import {
  defaultConnectionStorePath,
  loadConnectionRegistryFromFile,
  saveConnectionRegistryToFile,
} from "../connection/store";
import { connectionToStatusSnapshot } from "../connection/status-bridge";
import type { ConnectionRegistry } from "../connection/registry";
import type { CollectorState } from "../status";
import type { ConnectionStatus, Platform } from "../connection/types";
import {
  toAccountSignalSnapshot,
  type AccountSignalPageProbe,
} from "../naver/account-signal-page";
import { captureAccountSignals, type CaptureFailureReason } from "../naver/account-signal-capture";
import {
  runConnectionBindFromSignals,
  type BindErrorCategory,
  type BindResult,
} from "../connection/onboarding";
import type { FingerprintUnresolvableReason } from "../naver/account-fingerprint";

const here = dirname(fileURLToPath(import.meta.url));
const collectorRoot = resolve(here, "..", "..");

/** Parsed `init` arguments (pure). */
export interface ConnectionInitArgs {
  connectionId: string;
  displayName: string;
  /** Optional; defaults to the local default store path when omitted. */
  storeFile?: string;
}

export type ParseInitResult =
  | { ok: true; value: ConnectionInitArgs }
  | { ok: false; errorCategory: "unknown-command" | "missing-connection-id" | "missing-display-name" };

function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v !== undefined && !v.startsWith("--") ? v : undefined;
}

/** Pure: parse the `init` subcommand args into a validated shape. */
export function parseConnectionInitArgs(args: readonly string[]): ParseInitResult {
  if (args[0] !== "init") return { ok: false, errorCategory: "unknown-command" };
  const connectionId = flagValue(args, "--connection-id");
  if (!connectionId) return { ok: false, errorCategory: "missing-connection-id" };
  const displayName = flagValue(args, "--display-name");
  if (!displayName) return { ok: false, errorCategory: "missing-display-name" };
  const storeFile = flagValue(args, "--store-file");
  return { ok: true, value: { connectionId, displayName, storeFile } };
}

export interface ConnectionInitOptions {
  connectionId: string;
  displayName: string;
  storeFile: string;
  /** ISO timestamp, passed in for deterministic, testable output. */
  now: string;
}

/** Sanitized result of an init — no hash, no raw identity, no file path. */
export interface ConnectionInitResult {
  connectionId: string;
  platform: Platform;
  connectionStatus: ConnectionStatus;
  profileName: string;
  statusState: CollectorState;
  statusDetail: string;
  updatedAt: string;
}

export type ConnectionInitOutcome =
  | { ok: true; result: ConnectionInitResult }
  | { ok: false; errorCategory: "duplicate-connection-id" };

/** Injectable store side effects (defaults to the real local-file store). */
export interface ConnectionStoreIO {
  load(path: string): ConnectionRegistry;
  save(path: string, registry: ConnectionRegistry): void;
}

const DEFAULT_IO: ConnectionStoreIO = {
  load: loadConnectionRegistryFromFile,
  save: saveConnectionRegistryToFile,
};

/**
 * Core, testable init: load the registry (missing file → empty), refuse a
 * duplicate connectionId (no overwrite), create a PENDING_USER_LOGIN connection,
 * persist, and return a sanitized result + status snapshot. Side effects are
 * confined to the injected store IO over `storeFile`.
 */
export function runConnectionInit(
  opts: ConnectionInitOptions,
  io: ConnectionStoreIO = DEFAULT_IO,
): ConnectionInitOutcome {
  const registry = io.load(opts.storeFile);
  if (registry.get(opts.connectionId) !== undefined) {
    return { ok: false, errorCategory: "duplicate-connection-id" };
  }

  const connection = createPendingConnection({
    connectionId: opts.connectionId,
    platform: "NAVER_SMARTSTORE",
    userProvidedDisplayName: opts.displayName,
    now: opts.now,
  });
  registry.upsert(connection);
  io.save(opts.storeFile, registry);

  const snapshot = connectionToStatusSnapshot(connection, opts.now);
  return {
    ok: true,
    result: {
      connectionId: connection.connectionId,
      platform: connection.platform,
      connectionStatus: connection.connectionStatus,
      profileName: connection.profileName,
      statusState: snapshot.state,
      statusDetail: snapshot.detail ?? "",
      updatedAt: snapshot.updatedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// `connect` — bind a pending connection from a SANITIZED probe JSON (offline).
// No live NAVER, no browser, no Playwright: the probe is synthetic structural
// input that a future live page reader would otherwise produce.
// ---------------------------------------------------------------------------

export interface ConnectionConnectArgs {
  connectionId: string;
  probeJson: string;
  storeFile?: string;
}

export type ParseConnectResult =
  | { ok: true; value: ConnectionConnectArgs }
  | { ok: false; errorCategory: "unknown-command" | "missing-connection-id" | "missing-probe-json" };

/** Pure: parse the `connect` subcommand args. */
export function parseConnectionConnectArgs(args: readonly string[]): ParseConnectResult {
  if (args[0] !== "connect") return { ok: false, errorCategory: "unknown-command" };
  const connectionId = flagValue(args, "--connection-id");
  if (!connectionId) return { ok: false, errorCategory: "missing-connection-id" };
  const probeJson = flagValue(args, "--probe-json");
  if (!probeJson) return { ok: false, errorCategory: "missing-probe-json" };
  const storeFile = flagValue(args, "--store-file");
  return { ok: true, value: { connectionId, probeJson, storeFile } };
}

/**
 * Parse + shape a sanitized page probe from untrusted JSON. Returns null on
 * malformed JSON or a wrong-typed required field; unknown extra keys are dropped.
 * Never throws and never echoes the raw input.
 */
function parseProbeJson(raw: string): AccountSignalPageProbe | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  if (
    typeof p.currentUrl !== "string" ||
    typeof p.loggedInSignal !== "boolean" ||
    typeof p.sellerShellSignal !== "boolean"
  ) {
    return null;
  }
  // Optional candidate fields: keep only string|null; drop any other type to undefined.
  const optStr = (v: unknown): string | null | undefined =>
    v === undefined ? undefined : v === null ? null : typeof v === "string" ? v : undefined;
  return {
    currentUrl: p.currentUrl,
    loggedInSignal: p.loggedInSignal,
    sellerShellSignal: p.sellerShellSignal,
    commerceIdCandidate: optStr(p.commerceIdCandidate),
    storeUrlPathCandidate: optStr(p.storeUrlPathCandidate),
    accountScopeCandidate: optStr(p.accountScopeCandidate),
  };
}

export interface ConnectionConnectOptions {
  connectionId: string;
  storeFile: string;
  probeJson: string;
  /** ISO timestamp, passed in for deterministic output. */
  now: string;
}

export type ConnectErrorCategory =
  | "invalid-probe-json"
  | "signal-capture-failed"
  | BindErrorCategory;

export type ConnectionConnectOutcome =
  | { ok: true; result: BindResult }
  | {
      ok: false;
      errorCategory: ConnectErrorCategory;
      reasonCategory?: CaptureFailureReason | FingerprintUnresolvableReason;
    };

/**
 * Offline connect: parse a sanitized probe JSON → snapshot → capture → bind.
 * Capture failure short-circuits (no bind, no save). All outputs are sanitized
 * categories / the bind result; raw probe JSON, token, hash, URL, and store path
 * are never returned. No browser, no Playwright, no live flag.
 */
export function runConnectionConnect(
  opts: ConnectionConnectOptions,
  io: ConnectionStoreIO = DEFAULT_IO,
): ConnectionConnectOutcome {
  const probe = parseProbeJson(opts.probeJson);
  if (probe === null) {
    return { ok: false, errorCategory: "invalid-probe-json" };
  }
  const capture = captureAccountSignals(toAccountSignalSnapshot(probe));
  if (!capture.ok) {
    return { ok: false, errorCategory: "signal-capture-failed", reasonCategory: capture.reasonCategory };
  }
  const bind = runConnectionBindFromSignals(
    { connectionId: opts.connectionId, storeFile: opts.storeFile, rawSignals: capture.rawSignals, now: opts.now },
    io,
  );
  if (!bind.ok) {
    return { ok: false, errorCategory: bind.errorCategory, reasonCategory: bind.reasonCategory };
  }
  return { ok: true, result: bind.result };
}

function usage(): string {
  return [
    "usage:",
    "  connection.ts init    --connection-id <id> --display-name <alias> [--store-file <path>]",
    "  connection.ts connect --connection-id <id> --probe-json <json> [--store-file <path>]",
  ].join("\n");
}

function runInitMain(args: string[]): void {
  const parsed = parseConnectionInitArgs(args);
  if (!parsed.ok) {
    console.error(`${parsed.errorCategory}\n${usage()}`);
    process.exit(2);
    return;
  }
  const storeFile = parsed.value.storeFile ?? defaultConnectionStorePath(collectorRoot);
  const outcome = runConnectionInit({ ...parsed.value, storeFile, now: new Date().toISOString() });
  if (!outcome.ok) {
    console.error(outcome.errorCategory);
    process.exit(5);
    return;
  }
  // Sanitized result only — `profileName` is connectionId-derived; no hash,
  // no raw NAVER identity, no file path is printed.
  console.log(JSON.stringify(outcome.result, null, 2));
}

function runConnectMain(args: string[]): void {
  const parsed = parseConnectionConnectArgs(args);
  if (!parsed.ok) {
    console.error(`${parsed.errorCategory}\n${usage()}`);
    process.exit(2);
    return;
  }
  const storeFile = parsed.value.storeFile ?? defaultConnectionStorePath(collectorRoot);
  const outcome = runConnectionConnect({
    connectionId: parsed.value.connectionId,
    storeFile,
    probeJson: parsed.value.probeJson,
    now: new Date().toISOString(),
  });
  if (!outcome.ok) {
    // Sanitized failure — fixed categories only; never the raw probe/token/path.
    console.error(JSON.stringify({ errorCategory: outcome.errorCategory, reasonCategory: outcome.reasonCategory }));
    process.exit(6);
    return;
  }
  console.log(JSON.stringify(outcome.result, null, 2));
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === "init") return runInitMain(args);
  if (command === "connect") return runConnectMain(args);
  console.error(`unknown-command\n${usage()}`);
  process.exit(2);
}

// Run only when executed directly (e.g. `tsx src/cli/connection.ts`), NOT when
// imported by tests — importing must have no side effects (no argv parse, no exit).
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
