// Action Window command envelope: UI/user intents sent to Runtime.

import { CommandType, isCommandType } from "./enums";
import { isCompatibleProtocolVersion } from "./protocol";
import { findForbiddenFields } from "./privacy";
import {
  fail,
  isBoolean,
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
  isSemanticCode,
  ok,
  rejectUnknownKeys,
  type ParseResult,
  type ValidationIssue,
} from "./result";

/** Immutable command envelope. `commandId` is the idempotency key. */
export type ActionWindowCommand = {
  protocolVersion: string;
  /** Idempotency key — the same id must never be executed twice. */
  commandId: string;
  runId: string;
  /** The run revision the UI issued this command against (optimistic concurrency). */
  expectedRevision: number;
  type: CommandType;
  payload?: unknown;
  /** ISO-8601 timestamp string, stamped by the issuer. */
  issuedAt: string;
};

/** Expected payload shape per command type (undefined ⇒ no payload). */
export type CommandPayloadMap = {
  START_RUN: { channelCode: string };
  PAUSE_RUN: undefined;
  RESUME_RUN: undefined;
  CANCEL_RUN: undefined;
  FIND_CURRENT_STEP: undefined;
  SWITCH_TO_MANUAL: undefined;
  SET_GUIDANCE_ENABLED: { enabled: boolean };
  REQUEST_STEP_RECHECK: { stepId: string };
};

const COMMAND_ENVELOPE_KEYS: readonly string[] = [
  "protocolVersion",
  "commandId",
  "runId",
  "expectedRevision",
  "type",
  "payload",
  "issuedAt",
];

function validatePayload(type: CommandType, payload: unknown, issues: ValidationIssue[]): void {
  switch (type) {
    case CommandType.START_RUN: {
      if (!isRecord(payload) || !isSemanticCode(payload["channelCode"])) {
        issues.push({ path: "payload.channelCode", message: "START_RUN requires { channelCode: string }" });
      } else {
        rejectUnknownKeys(payload, ["channelCode"], "payload", issues);
      }
      return;
    }
    case CommandType.SET_GUIDANCE_ENABLED: {
      if (!isRecord(payload) || !isBoolean(payload["enabled"])) {
        issues.push({ path: "payload.enabled", message: "SET_GUIDANCE_ENABLED requires { enabled: boolean }" });
      } else {
        rejectUnknownKeys(payload, ["enabled"], "payload", issues);
      }
      return;
    }
    case CommandType.REQUEST_STEP_RECHECK: {
      if (!isRecord(payload) || !isNonEmptyString(payload["stepId"])) {
        issues.push({ path: "payload.stepId", message: "REQUEST_STEP_RECHECK requires { stepId: string }" });
      } else {
        rejectUnknownKeys(payload, ["stepId"], "payload", issues);
      }
      return;
    }
    case CommandType.PAUSE_RUN:
    case CommandType.RESUME_RUN:
    case CommandType.CANCEL_RUN:
    case CommandType.FIND_CURRENT_STEP:
    case CommandType.SWITCH_TO_MANUAL: {
      if (payload !== undefined) {
        issues.push({ path: "payload", message: `${type} takes no payload` });
      }
      return;
    }
    default:
      return;
  }
}

/** Validate an untrusted command message. Unknown type / version fail closed. */
export function parseCommand(input: unknown): ParseResult<ActionWindowCommand> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return fail([{ path: "(root)", message: "command must be an object" }]);
  }

  rejectUnknownKeys(input, COMMAND_ENVELOPE_KEYS, "", issues);

  const protocolVersion = input["protocolVersion"];
  if (typeof protocolVersion !== "string" || !isCompatibleProtocolVersion(protocolVersion)) {
    issues.push({ path: "protocolVersion", message: "missing or unsupported protocol version" });
  }
  if (!isNonEmptyString(input["commandId"])) {
    issues.push({ path: "commandId", message: "commandId must be a non-empty string" });
  }
  if (!isNonEmptyString(input["runId"])) {
    issues.push({ path: "runId", message: "runId must be a non-empty string" });
  }
  if (!isNonNegativeInteger(input["expectedRevision"])) {
    issues.push({ path: "expectedRevision", message: "expectedRevision must be a non-negative integer" });
  }
  const type = input["type"];
  if (!isCommandType(type)) {
    issues.push({ path: "type", message: "unknown command type (fail-closed)" });
  } else {
    validatePayload(type, input["payload"], issues);
  }
  if (!isNonEmptyString(input["issuedAt"])) {
    issues.push({ path: "issuedAt", message: "issuedAt must be a non-empty ISO timestamp string" });
  }

  const forbidden = findForbiddenFields(input["payload"], "payload");
  for (const p of forbidden) {
    issues.push({ path: p, message: "forbidden (non-sanitized) field in payload" });
  }

  if (issues.length > 0) return fail(issues);
  return ok(input as ActionWindowCommand);
}

// --- Idempotency & concurrency helpers (pure) ------------------------------

/** A command is a duplicate if its id was already seen. */
export function isDuplicateCommand(command: ActionWindowCommand, seenIds: ReadonlySet<string>): boolean {
  return seenIds.has(command.commandId);
}

/** Stale: issued against an older revision than the run now holds — reject. */
export function isStaleCommand(command: ActionWindowCommand, currentRevision: number): boolean {
  return command.expectedRevision < currentRevision;
}

/** Applicable: targets exactly the run's current revision. */
export function isApplicableCommand(command: ActionWindowCommand, currentRevision: number): boolean {
  return command.expectedRevision === currentRevision;
}
