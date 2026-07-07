/**
 * Pure path helper for the local-agent **human-completed** re-verification sentinel.
 *
 * After a browser connection settles `NEEDS_USER_ACTION`, local-agent keeps the same process/browser
 * alive and waits for an explicit, per-connection operator signal before running ONE fresh in-session
 * re-inspection (`humanCompleted`). The signal is a sentinel file (the project's established
 * supervised-continuation idiom — a terminal keypress can't be relied on).
 *
 * Contract encoded here:
 *  - **Connection-specific**: the filename derives from a salted one-way HASH of the connection id, so
 *    connection A's file can never match connection B's, and an arbitrary/hostile connection id is
 *    path-safe (no separators, no traversal) and never appears raw (no account identifier in the path).
 *  - **Located** next to the collector status file (the same `.status/` dir the rest of the live layer
 *    uses), honouring a `COLLECTOR_STATUS_FILE` override.
 *  - The file's PRESENCE is the whole signal — it carries no credentials, URLs, cookies, tokens, or ids.
 *
 * Pure + import-safe (no I/O, launches nothing) so it is unit-testable without any CLI side effect.
 */
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

const PREFIX = "local-agent-human-completed";
const SUFFIX = ".signal";

/** The absolute sentinel path for one connection, next to `statusFile`. Pass `cfg.statusFile`. */
export function humanSignalPathFor(statusFile: string, connectionId: string): string {
  const hash = createHash("sha256").update("local-agent-human-completed " + connectionId).digest("hex").slice(0, 24);
  return resolve(dirname(resolve(statusFile)), PREFIX + "." + hash + SUFFIX);
}
