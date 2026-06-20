import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The collector's externally-visible state. The POC focuses on LAST_SUCCESS plus
 * the failure states; CONNECTED/COLLECTING/DISCONNECTED round out the lifecycle.
 */
export type CollectorState =
  | "CONNECTED"
  | "COLLECTING"
  | "LAST_SUCCESS"
  | "SESSION_EXPIRED"
  | "RECONNECT_REQUIRED"
  | "ACCOUNT_LOGIN_REQUIRED"
  | "ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA"
  | "EXPORT_LAYOUT_CHANGED"
  | "EXPORT_ASYNC_JOB_DETECTED"
  | "EXPORT_SYNC_DETECTED"
  | "DOWNLOAD_FAILED"
  | "UPLOAD_FAILED"
  | "DISCONNECTED";

export type SessionState = "LOGGED_IN" | "LOGGED_OUT" | "AUTH_CHALLENGE";
export type ExportOutcome =
  | "CAPTURED"
  | "SYNC_DOWNLOAD_DETECTED"
  | "ASYNC_JOB_DETECTED"
  | "LAYOUT_UNRECOGNIZED"
  | "DOWNLOAD_FAILED"
  | "NOT_ATTEMPTED";
export type UploadOutcome = "OK" | "FAILED" | "NOT_ATTEMPTED";

export interface RunSignals {
  /** Collector is paired with a SellerOps account (has a usable token/credential). */
  paired: boolean;
  /** Result of the seller-center session check. */
  session: SessionState;
  /** Result of the export attempt (omit/NOT_ATTEMPTED when session invalid). */
  exportOutcome?: ExportOutcome;
  /** Result of the upload to SellerOps (omit/NOT_ATTEMPTED when nothing captured). */
  uploadOutcome?: UploadOutcome;
}

/**
 * Pure mapping from a run's signals to a single state. Precedence is deliberate:
 * pairing first, then the stop-and-ask session states, then export, then upload.
 * No path returns LAST_SUCCESS unless a file was both captured AND uploaded — so
 * a fake success state is structurally impossible.
 */
export function decideState(s: RunSignals): CollectorState {
  if (!s.paired) return "DISCONNECTED";
  if (s.session === "AUTH_CHALLENGE") return "ACTION_REQUIRED_FOR_2FA_OR_CAPTCHA";
  if (s.session === "LOGGED_OUT") return "SESSION_EXPIRED";

  const exportOutcome = s.exportOutcome ?? "NOT_ATTEMPTED";
  if (exportOutcome === "LAYOUT_UNRECOGNIZED") return "EXPORT_LAYOUT_CHANGED";
  // Export is a job, not an immediate download — a discovery/halt state for
  // milestone 1, classified before CAPTURED so an async export is never mistaken
  // for a captured file.
  if (exportOutcome === "ASYNC_JOB_DETECTED") return "EXPORT_ASYNC_JOB_DETECTED";
  if (exportOutcome === "DOWNLOAD_FAILED") return "DOWNLOAD_FAILED";
  // A no-click classifier recognized a sync export control but DID NOT trigger it —
  // so no file exists. Returned here (before the upload leg) so it can never become
  // COLLECTING/LAST_SUCCESS; "sync detected" is discovery, not capture.
  if (exportOutcome === "SYNC_DOWNLOAD_DETECTED") return "EXPORT_SYNC_DETECTED";
  if (exportOutcome === "NOT_ATTEMPTED") return "CONNECTED";

  const uploadOutcome = s.uploadOutcome ?? "NOT_ATTEMPTED";
  if (uploadOutcome === "FAILED") return "UPLOAD_FAILED";
  if (uploadOutcome === "NOT_ATTEMPTED") return "COLLECTING";
  return "LAST_SUCCESS";
}

export interface StatusRecord {
  state: CollectorState;
  detail?: string;
  lastCollectedAt?: string;
  updatedAt: string;
}

/** Persist the latest status locally. Only scalar state metadata — never secrets. */
export function writeStatus(path: string, record: StatusRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(record, null, 2), "utf8");
}
