/**
 * Read-only bridge from the existing run/connection result vocabularies to the
 * pure Connector Sync State model.
 *
 * Maps a finished run-level `CollectorState` (`../status.ts`) or a connection-level
 * `ConnectionStatus` (`./types.ts`) to a sanitized `SyncOutcome`. **Pure functions
 * only** — no I/O, no persistence, no DB, no API, no worker, no scheduler, no
 * `manualSync`, no browser, no status write. It does NOT call `applySyncOutcome`
 * and does not change any existing runtime behavior; it only translates an
 * already-decided status enum into an outcome enum.
 *
 * Imports of `../status` and `./types` are **type-only** (erased at runtime), so
 * this module pulls in none of the status-writing fs code and stays a pure leaf.
 *
 * Sanitization: the inputs are status ENUMS and the output is an outcome ENUM with
 * a coarse error category — there is no path for a raw id, filename, path, URL,
 * selector, DOM, marketplace identifier, or row/cell content to flow through.
 */

import type { CollectorState } from "../status";
import type { ConnectionStatus } from "./types";
import type { SyncErrorCategory } from "./sync-state";
import type { ReconnectAuthStatus, SyncOutcome } from "./sync-state-reduce";

function assertNever(_x: never): never {
  throw new Error("sync-outcome-bridge: unhandled status");
}

const SUCCEEDED: SyncOutcome = { kind: "SUCCEEDED" };

function paused(): SyncOutcome {
  return { kind: "PAUSED" };
}
function failed(errorCategory: SyncErrorCategory): SyncOutcome {
  return { kind: "FAILED", errorCategory };
}
function partial(errorCategory: SyncErrorCategory): SyncOutcome {
  return { kind: "PARTIAL", errorCategory };
}
function reconnect(authStatus: ReconnectAuthStatus): SyncOutcome {
  return { kind: "AUTH_RECONNECT_REQUIRED", authStatus, errorCategory: "AUTH" };
}

/**
 * Map a finished run-level `CollectorState` to a sanitized `SyncOutcome`.
 *
 * Terminal results map directly; non-terminal/idle/discovery states (CONNECTED,
 * COLLECTING, the export-discovery and action-required halts, DISCONNECTED) map to
 * `PAUSED` — the honest "no completed sync happened" outcome, which the reducer
 * treats as a no-op for the snapshot (never fabricates a success).
 */
export function mapCollectorStateToSyncOutcome(state: CollectorState): SyncOutcome {
  switch (state) {
    case "LAST_SUCCESS":
      return SUCCEEDED;

    // Auth / session — a human must re-authenticate before sync can resume.
    case "SESSION_EXPIRED":
      return reconnect("EXPIRED");
    case "RECONNECT_REQUIRED":
      return reconnect("RECONNECT_REQUIRED");
    case "ACCOUNT_LOGIN_REQUIRED":
      return reconnect("RECONNECT_REQUIRED");
    case "ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA":
      return reconnect("AUTH_CHALLENGE");

    // Real failures — mapped to a sanitized error category.
    case "EXPORT_LAYOUT_CHANGED":
      return failed("EXPORT_LAYOUT_CHANGED");
    case "DOWNLOAD_FAILED":
      return failed("DOWNLOAD_FAILED");
    case "EXPORT_TARGET_UNKNOWN":
      return failed("UNKNOWN");
    // Captured but not delivered to the backend — partial progress, snapshot retained.
    case "UPLOAD_FAILED":
      return partial("NETWORK");

    // Non-terminal / idle / discovery / action-required halts — no completed sync.
    case "CONNECTED":
    case "COLLECTING":
    case "EXPORT_SYNC_DETECTED":
    case "EXPORT_ASYNC_JOB_DETECTED":
    case "EXPORT_TARGET_EMPTY":
    case "EXPORT_DATE_RANGE_REQUIRED":
    case "DISCONNECTED":
      return paused();

    default:
      return assertNever(state);
  }
}

/**
 * Map a connection-level `ConnectionStatus` to a sanitized `SyncOutcome`.
 * Onboarding/re-auth states require human action (→ reconnect); a bound-store
 * mismatch is a permission/identity failure; ready/connected states are idle.
 */
export function mapConnectionStatusToSyncOutcome(status: ConnectionStatus): SyncOutcome {
  switch (status) {
    case "PENDING_USER_LOGIN":
    case "PENDING_ACCOUNT_SELECTION":
    case "NEEDS_REAUTH":
      return reconnect("RECONNECT_REQUIRED");
    case "ACCOUNT_MISMATCH":
      return failed("PERMISSION");
    case "EXPORT_FAILED":
      return failed("UNKNOWN");
    case "CONNECTED":
    case "EXPORT_READY":
      return paused();
    default:
      return assertNever(status);
  }
}
