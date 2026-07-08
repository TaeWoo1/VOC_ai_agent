// Action Window event envelope: facts emitted by Runtime.

import { EventType, isEventType } from "./enums";
import { isCompatibleProtocolVersion } from "./protocol";
import { findForbiddenFields } from "./privacy";
import {
  fail,
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
  ok,
  rejectUnknownKeys,
  type ParseResult,
  type ValidationIssue,
} from "./result";

const EVENT_ENVELOPE_KEYS: readonly string[] = [
  "protocolVersion",
  "eventId",
  "runId",
  "sequence",
  "revision",
  "type",
  "occurredAt",
  "payload",
];

/** Immutable event envelope. `eventId` supports duplicate suppression. */
export type ActionWindowEvent = {
  protocolVersion: string;
  /** Duplicate-suppression key. */
  eventId: string;
  runId: string;
  /** Monotonically increasing within a single run. */
  sequence: number;
  /** Identifies the authoritative run view this event advances to. */
  revision: number;
  type: EventType;
  /** ISO-8601 timestamp string. */
  occurredAt: string;
  payload?: unknown;
};

/** Validate an untrusted Bridge event. Unknown type / version fail closed. */
export function parseEvent(input: unknown): ParseResult<ActionWindowEvent> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return fail([{ path: "(root)", message: "event must be an object" }]);
  }

  rejectUnknownKeys(input, EVENT_ENVELOPE_KEYS, "", issues);

  const protocolVersion = input["protocolVersion"];
  if (typeof protocolVersion !== "string" || !isCompatibleProtocolVersion(protocolVersion)) {
    issues.push({ path: "protocolVersion", message: "missing or unsupported protocol version" });
  }
  if (!isNonEmptyString(input["eventId"])) {
    issues.push({ path: "eventId", message: "eventId must be a non-empty string" });
  }
  if (!isNonEmptyString(input["runId"])) {
    issues.push({ path: "runId", message: "runId must be a non-empty string" });
  }
  if (!isNonNegativeInteger(input["sequence"])) {
    issues.push({ path: "sequence", message: "sequence must be a non-negative integer" });
  }
  if (!isNonNegativeInteger(input["revision"])) {
    issues.push({ path: "revision", message: "revision must be a non-negative integer" });
  }
  if (!isEventType(input["type"])) {
    issues.push({ path: "type", message: "unknown event type (fail-closed)" });
  }
  if (!isNonEmptyString(input["occurredAt"])) {
    issues.push({ path: "occurredAt", message: "occurredAt must be a non-empty ISO timestamp string" });
  }

  const forbidden = findForbiddenFields(input["payload"], "payload");
  for (const p of forbidden) {
    issues.push({ path: p, message: "forbidden (non-sanitized) field in payload" });
  }

  if (issues.length > 0) return fail(issues);
  return ok(input as ActionWindowEvent);
}

// --- Ordering & dedup helpers (pure) ---------------------------------------

/** Duplicate if the event id was already applied. */
export function isDuplicateEvent(event: ActionWindowEvent, seenIds: ReadonlySet<string>): boolean {
  return seenIds.has(event.eventId);
}

/**
 * Sequence regression: within one run, `sequence` must strictly increase. An
 * event whose sequence is <= the last applied sequence must not advance state.
 */
export function isSequenceRegression(previousSequence: number, event: ActionWindowEvent): boolean {
  return event.sequence <= previousSequence;
}

/** Apply only strictly-newer sequences (and never a duplicate id). */
export function shouldApplyEvent(
  event: ActionWindowEvent,
  previousSequence: number,
  seenIds: ReadonlySet<string>,
): boolean {
  if (isDuplicateEvent(event, seenIds)) return false;
  return !isSequenceRegression(previousSequence, event);
}
