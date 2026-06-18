/**
 * Minimal in-memory connection registry. A thin keyed store over
 * `CollectorConnection`, with serialization that reuses the record layer's
 * allow-list validation. No fs, no DB, no env, no logging — purely in-memory.
 *
 * The registry holds no raw NAVER identity beyond what the connections themselves
 * already carry (hash + category + the user-provided alias); it adds none.
 */

import {
  parseConnectionRecord,
  toConnectionRecord,
  type ConnectionRecord,
  type ParseErrorCategory,
} from "./record";
import type { CollectorConnection } from "./types";

/** Updater for `apply`: receives the current connection, returns the next one. */
export type ConnectionUpdater = (current: CollectorConnection) => CollectorConnection;

export interface ConnectionRegistry {
  /** Get a connection by id, or undefined if absent. */
  get(connectionId: string): CollectorConnection | undefined;
  /** All connections, in insertion order. */
  list(): CollectorConnection[];
  /** Insert or replace a connection (keyed by its connectionId). */
  upsert(connection: CollectorConnection): void;
  /** Remove a connection; returns true if one was removed. */
  remove(connectionId: string): boolean;
  /**
   * Apply an updater to an existing connection and store the result. Throws a
   * SANITIZED error (category only — the id is not attacker-controlled identity,
   * but no raw values are echoed) when the connection is absent.
   */
  apply(connectionId: string, updater: ConnectionUpdater): CollectorConnection;
  /** Serialize all connections to JSON-safe records. */
  toRecords(): ConnectionRecord[];
}

/** Result of building a registry from untrusted records. */
export type FromRecordsResult =
  | { ok: true; registry: ConnectionRegistry }
  | { ok: false; errorCategory: ParseErrorCategory };

/**
 * Create an in-memory registry, optionally seeded with connections. The seed is
 * copied into the internal map (later mutations of the input array do not affect
 * the registry).
 */
export function createConnectionRegistry(
  initialConnections: readonly CollectorConnection[] = [],
): ConnectionRegistry {
  const store = new Map<string, CollectorConnection>();
  for (const c of initialConnections) store.set(c.connectionId, c);

  return {
    get(connectionId) {
      return store.get(connectionId);
    },
    list() {
      return [...store.values()];
    },
    upsert(connection) {
      store.set(connection.connectionId, connection);
    },
    remove(connectionId) {
      return store.delete(connectionId);
    },
    apply(connectionId, updater) {
      const current = store.get(connectionId);
      if (current === undefined) {
        throw new Error("registry: connection-not-found");
      }
      const next = updater(current);
      store.set(connectionId, next);
      return next;
    },
    toRecords() {
      return [...store.values()].map(toConnectionRecord);
    },
  };
}

/**
 * Build a registry from untrusted records. Each record is validated through
 * `parseConnectionRecord`; the first malformed record fails the whole load with a
 * sanitized `errorCategory`. The offending raw value is never echoed.
 */
export function registryFromRecords(records: readonly unknown[]): FromRecordsResult {
  const connections: CollectorConnection[] = [];
  for (const record of records) {
    const parsed = parseConnectionRecord(record);
    if (!parsed.ok) {
      return { ok: false, errorCategory: parsed.errorCategory };
    }
    connections.push(parsed.connection);
  }
  return { ok: true, registry: createConnectionRegistry(connections) };
}
