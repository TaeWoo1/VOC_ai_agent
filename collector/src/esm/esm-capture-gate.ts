import type { ExtensionCategory } from "../naver/review-export";
import type { SessionVerdict } from "../naver/session-verdict";
import type { FrameAwareExportScan } from "./esm-frame-scan";

/**
 * Pure decision core for the ESM+ REVIEW **Gate 3 supervised approved-index single
 * capture** — SANITIZED, browser-free, fully testable.
 *
 * Gate 3 fires **exactly one** human-approved click on a single export control inside
 * the cross-origin **allowlisted** vendor frame that Gate 2 located, observes the one
 * download, structurally validates it, and deletes it (observe-and-discard). This
 * module owns every decision and stop condition; the live Playwright I/O (the single
 * click, the download wait, the save/delete) lives in the CLI and calls these pure
 * functions. No function here takes or returns DOM text, a raw URL/host, a selector, a
 * filename, or any identifier — only sanitized booleans / categories / coarse buckets,
 * an index, and the `approvedIndex`. So `JSON.stringify` of any result is leak-free.
 *
 * NON-GOALS (by design, enforced by absence): no upload, no row parsing, no column
 * schema inference, no dedup-key claim, no `CONFIRMED` capability, no scheduling.
 */

/** Every sanitized halt reason Gate 3 can record. The capture proceeds only when none fire. */
export type CaptureStop =
  | "no-login"
  | "auth-challenge"
  | "session-not-usable"
  | "not-actionable"
  | "scope-not-allowlisted-frame"
  | "actionable-count-not-one"
  | "frame-unavailable"
  | "approved-index-missing"
  | "approved-index-out-of-range"
  | "approved-index-not-actionable"
  | "no-actionable-candidate"
  | "multiple-actionable-candidates"
  | "consent-prompt-present"
  | "bind-not-unique"
  | "no-download-event"
  | "download-timeout"
  | "async-observed"
  | "unrecognized-format"
  // Gate-4 capture→inspect→delete additions (only reachable under `--inspect-schema-shape`):
  | "schema-inspect-failed"
  | "delete-failed";

/** Coarse category of an in-frame candidate, by accessible-text class (never the text). */
export type FrameCandidateCategory = "export-like" | "consent-like" | "other";

/** Sanitized per-candidate metadata from the allowlisted frame (index + booleans only). */
export interface SanitizedFrameCandidate {
  index: number;
  category: FrameCandidateCategory;
  visible: boolean;
  enabled: boolean;
  /** Derived: visible AND enabled. */
  actionable: boolean;
}

/** A gate verdict — `proceed` true only when there is no `stop`. */
export interface GateVerdict {
  proceed: boolean;
  stop: CaptureStop | null;
}

function ok(): GateVerdict {
  return { proceed: true, stop: null };
}
function halt(stop: CaptureStop): GateVerdict {
  return { proceed: false, stop };
}

/**
 * Pure: the session must be a usable logged-in seller-center session before any capture.
 * A login page, auth challenge, or any non-`LOGGED_IN` verdict halts (no click).
 */
export function captureSessionGate(verdict: SessionVerdict): GateVerdict {
  switch (verdict) {
    case "LOGGED_IN":
      return ok();
    case "ACCOUNT_LOGIN_REQUIRED":
      return halt("no-login");
    case "AUTH_CHALLENGE_REQUIRED":
      return halt("auth-challenge");
    default:
      // RECONNECT_REQUIRED / UNKNOWN — never proceed.
      return halt("session-not-usable");
  }
}

/**
 * Pure: the Gate-2 frame-aware result must show exactly one actionable export control,
 * located in the `allowlisted-frame` scope. Mirrors run #4's success shape; any other
 * shape halts (no click).
 */
export function capturePreconditionMet(scan: FrameAwareExportScan): GateVerdict {
  if (!scan.hasActionableExportCandidate) return halt("not-actionable");
  if (scan.actionableScope !== "allowlisted-frame") return halt("scope-not-allowlisted-frame");
  // Exactly one allowlisted, read frame that actually holds actionable candidate(s)...
  const actionableAllowlisted = scan.frames.filter(
    (f) => f.allowlisted && f.readResult === "read" && f.candidates !== null && f.candidates.actionable !== "none",
  );
  if (actionableAllowlisted.length !== 1) return halt("actionable-count-not-one");
  // ...and that frame must hold EXACTLY one actionable control (bucket "one").
  if (actionableAllowlisted[0]!.candidates!.actionable !== "one") return halt("actionable-count-not-one");
  return ok();
}

/**
 * Pure: validate the operator-approved index against the live, sanitized in-frame
 * candidate metadata. Proceeds ONLY when the approved index is the single actionable
 * export candidate and no consent prompt is present. A missing index, a consent-like
 * candidate, a zero/multiple actionable count, or an out-of-range / non-actionable index
 * each halts (no click). The consent guard fires first: this slice has no consent-approval
 * path, so any consent-like candidate means "appeared and was not explicitly approved".
 */
export function decideApprovedCapture(
  candidates: readonly SanitizedFrameCandidate[],
  approvedIndex: number | null,
): GateVerdict {
  if (approvedIndex === null) return halt("approved-index-missing");
  if (candidates.some((c) => c.category === "consent-like")) return halt("consent-prompt-present");

  const at = candidates.find((c) => c.index === approvedIndex);
  if (!at) return halt("approved-index-out-of-range");

  const actionable = candidates.filter((c) => c.actionable);
  if (actionable.length === 0) return halt("no-actionable-candidate");
  if (actionable.length > 1) return halt("multiple-actionable-candidates");
  if (!at.actionable) return halt("approved-index-not-actionable");
  // Exactly one actionable candidate, and the approved index IS it.
  return ok();
}

/** What the single bound click produced, as sanitized booleans (the CLI fills this live). */
export interface PostClickObservation {
  downloadFired: boolean;
  consentOrDialogAppeared: boolean;
  asyncJobAppeared: boolean;
  timedOut: boolean;
}

/** Sanitized classification of the post-click observation. */
export type PostClickOutcome =
  | "download-fired"
  | "consent-prompt-present"
  | "async-observed"
  | "download-timeout"
  | "no-download-event";

/**
 * Pure: classify the post-click observation. A clean download wins; otherwise the reason
 * is reported in precedence consent → async → timeout → no-event. Only `download-fired`
 * continues to validation; every other outcome is a stop.
 */
export function classifyPostClickOutcome(o: PostClickObservation): PostClickOutcome {
  if (o.downloadFired) return "download-fired";
  if (o.consentOrDialogAppeared) return "consent-prompt-present";
  if (o.asyncJobAppeared) return "async-observed";
  if (o.timedOut) return "download-timeout";
  return "no-download-event";
}

/** Map a non-download post-click outcome to its sanitized stop reason. */
export function postClickStop(outcome: Exclude<PostClickOutcome, "download-fired">): CaptureStop {
  switch (outcome) {
    case "consent-prompt-present":
      return "consent-prompt-present";
    case "async-observed":
      return "async-observed";
    case "download-timeout":
      return "download-timeout";
    case "no-download-event":
      return "no-download-event";
  }
}

/** Sanitized structural verdict of the captured file — magic-sniff / extension category only. */
export type FileStructure = "xlsx-valid" | "csv-category" | "unrecognized";

/**
 * Pure: structural-only file classification from the (already-sniffed) extension category
 * and the OOXML magic result. No row is ever read. `xlsx` requires the magic to pass;
 * `csv` is accepted by category (no magic exists for csv); anything else is unrecognized.
 */
export function classifyFileStructure(category: ExtensionCategory, xlsxReadable: boolean): FileStructure {
  if (category === "xlsx" && xlsxReadable) return "xlsx-valid";
  if (category === "csv") return "csv-category";
  return "unrecognized";
}

/** Final sanitized capture verdict. `STOPPED` carries the reason; success never claims schema. */
export type CaptureResult = "CAPTURED_VALID" | "STOPPED";

/**
 * Pure: parse `--approved-index N` from argv. Returns a non-negative integer, or null when
 * absent / malformed (the gate then halts with `approved-index-missing`). Accepts
 * `--approved-index 2` and `--approved-index=2`.
 */
export function parseApprovedIndexArg(args: readonly string[]): number | null {
  const FLAG = "--approved-index";
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    let raw: string | undefined;
    if (a === FLAG) raw = args[i + 1];
    else if (a.startsWith(`${FLAG}=`)) raw = a.slice(FLAG.length + 1);
    if (raw === undefined) continue;
    if (!/^\d+$/.test(raw.trim())) return null;
    return Number.parseInt(raw.trim(), 10);
  }
  return null;
}
