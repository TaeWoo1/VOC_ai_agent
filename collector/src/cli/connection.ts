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

function usage(): string {
  return "usage: connection.ts init --connection-id <id> --display-name <alias> [--store-file <path>]";
}

function main(): void {
  const args = process.argv.slice(2);
  const parsed = parseConnectionInitArgs(args);
  if (!parsed.ok) {
    console.error(`${parsed.errorCategory}\n${usage()}`);
    process.exit(2);
    return;
  }
  const storeFile = parsed.value.storeFile ?? defaultConnectionStorePath(collectorRoot);
  const now = new Date().toISOString();
  const outcome = runConnectionInit({ ...parsed.value, storeFile, now });
  if (!outcome.ok) {
    console.error(outcome.errorCategory);
    process.exit(5);
    return;
  }
  // Sanitized result only — note `profileName` is connectionId-derived; no hash,
  // no raw NAVER identity, no file path is printed.
  console.log(JSON.stringify(outcome.result, null, 2));
}

// Run only when executed directly (e.g. `tsx src/cli/connection.ts`), NOT when
// imported by tests — importing must have no side effects (no argv parse, no exit).
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
