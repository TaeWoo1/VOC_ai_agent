/**
 * **The credential handoff: the one function in the codebase that holds a marketplace secret.**
 *
 * Barrier → one read → one POST → a value-free record. Nothing else, and nothing in between.
 *
 * ## The plaintext scope, stated as precisely as it can be
 *
 * The three values exist inside {@link handOffCoupangCredential}'s body and nowhere else. They are not returned,
 * not assigned to any object that outlives the call, not put in a closure, not written to a file, a clipboard, an
 * environment variable, a fixture, or a status record, and not passed to {@link log}. The only thing they are
 * given to is the `post` seam, which puts them in one request body.
 *
 * **What is NOT claimed:** that the plaintext is erased. JavaScript strings are immutable and garbage-collected;
 * there is no `memset` for them. Overwriting the variable afterwards would replace a reference, not the bytes, so
 * this code does not do it and does not pretend to. What is true is the narrower statement above — one scope, one
 * consumer — and that is what the tests pin.
 *
 * ## Why the seams
 *
 * `confirm`, `read`, and `post` are injected rather than imported. Partly so this is testable with no browser and
 * no backend, but mainly so the ORDER is a property of this file: a test can hand it a `read` that records
 * whether `confirm` had already resolved true, which is the one invariant that matters and the one that a
 * call-site could otherwise quietly invert.
 *
 * See `docs/coupang_credential_handoff_v1.md` for the contract this implements.
 */
import { log } from "../log";
import type { CredentialCellRefusal } from "../action-window/coupang-wing-credential-cells";
import {
  CredentialDigestSalt,
  credentialEvidenceFor,
  credentialFieldsDistinct,
  type CredentialFieldEvidence,
} from "./credential-evidence";

/** What the one-shot in-page read returned. The success arm is the only place a value appears in this module. */
export type CredentialReadResult =
  | { readonly ok: true; readonly values: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly reason: CredentialCellRefusal; readonly id?: string };

/** What the backend answered. Value-free by construction — the endpoint returns no secret and no provider body. */
export interface CredentialHandoffResponse {
  /** Whether the credential was stored. */
  readonly stored: boolean;
  /** The safe connection-test status: `SUCCESS` / `FAILED` / `UNSUPPORTED` / `NOT_CONFIGURED`. */
  readonly connectionStatus: string;
  /** The safe reason code, when the test did not succeed. Never a provider message. */
  readonly connectionReason?: string | null;
}

/** How a handoff ended. Every member except `STORED_AND_VERIFIED` means no credential is in use. */
export const CREDENTIAL_HANDOFF_OUTCOMES = [
  /** Stored, and the read-only Coupang connection check passed. */
  "STORED_AND_VERIFIED",
  /** Stored, but the connection check did not pass. The safe reason travels with it. */
  "STORED_NOT_VERIFIED",
  /** The operator did not allow the read. Nothing was read and nothing was sent. */
  "NOT_ALLOWED",
  /** The screen did not resolve unambiguously. Nothing was read and nothing was sent. */
  "READ_REFUSED",
  /** The three values were not three distinct things. Read, never sent. */
  "VALUES_NOT_DISTINCT",
  /** The backend refused or was unreachable. Read and sent; nothing is stored. */
  "STORE_FAILED",
] as const;
export type CredentialHandoffOutcome = (typeof CREDENTIAL_HANDOFF_OUTCOMES)[number];

/** The record a handoff emits. Value-free: this type has no field that can hold a secret. */
export interface CredentialHandoffRecord {
  readonly outcome: CredentialHandoffOutcome;
  /** Present once a read succeeded — a shape and a salted digest per field, never a value. */
  readonly evidence: readonly CredentialFieldEvidence[];
  /** The in-page refusal, when the read was the thing that stopped it. */
  readonly readRefusal?: CredentialCellRefusal;
  /** Which field the refusal was about. An id from the contract, never page text. */
  readonly readRefusalId?: string;
  /** The safe connection status, once the backend answered. */
  readonly connectionStatus?: string;
  /** The safe connection reason code, when the check did not succeed. */
  readonly connectionReason?: string;
}

export interface CredentialHandoffSeams {
  /**
   * The trusted operator confirmation. Resolves `true` ONLY for a verified press — a timeout and an abort are
   * both `false`, because a caller that cannot tell them apart cannot get them wrong.
   */
  readonly confirm: () => Promise<boolean>;
  /** The ONE in-page read. Called at most once, and never before `confirm` has resolved true. */
  readonly read: () => Promise<CredentialReadResult>;
  /** Hands the secrets to the backend. Called at most once, and only with three distinct non-empty values. */
  readonly post: (secrets: Readonly<Record<string, string>>) => Promise<CredentialHandoffResponse>;
  /** Test seam: a fixed digest salt. Production passes nothing and gets a fresh per-run one. */
  readonly salt?: CredentialDigestSalt;
}

/**
 * Run the handoff. Returns a record that cannot carry a value; every early exit is a full stop, and no exit
 * leaves a partial credential behind (the backend's own intake is all-or-nothing, and this never sends a
 * partial map).
 */
export async function handOffCoupangCredential(seams: CredentialHandoffSeams): Promise<CredentialHandoffRecord> {
  // 1. A PERSON decides. Before this resolves true, nothing has looked at a credential field.
  if (!(await seams.confirm())) {
    log("coupang_credential_handoff", { outcome: "NOT_ALLOWED", read: false, sent: false });
    return { outcome: "NOT_ALLOWED", evidence: [] };
  }

  // 2. ONE read. From here to the end of this function, three secrets exist in this scope.
  const read = await seams.read();
  if (!read.ok) {
    log("coupang_credential_handoff", {
      outcome: "READ_REFUSED",
      reason: read.reason,
      ...(read.id ? { field: read.id } : {}),
      sent: false,
    });
    return {
      outcome: "READ_REFUSED",
      evidence: [],
      readRefusal: read.reason,
      ...(read.id ? { readRefusalId: read.id } : {}),
    };
  }

  const salt = seams.salt ?? CredentialDigestSalt.forRun();
  const evidence = credentialEvidenceFor(read.values, salt);

  // 3. Three cells that hold the same text are not three credentials. Checked on digests, before anything is
  //    sent — a triple this shape means the locator read one thing three times, and storing it would produce a
  //    credential that fails verification with nothing in the record to say why.
  if (!credentialFieldsDistinct(evidence)) {
    log("coupang_credential_handoff", { outcome: "VALUES_NOT_DISTINCT", sent: false });
    return { outcome: "VALUES_NOT_DISTINCT", evidence };
  }

  // 4. ONE POST. The only consumer of the plaintext in this process.
  let response: CredentialHandoffResponse;
  try {
    response = await seams.post(read.values);
  } catch {
    // The thrown error is deliberately not inspected, logged, or re-raised with its message: a fetch/JSON error
    // can quote a response body, and a body is exactly what must not appear. The caller gets the outcome.
    log("coupang_credential_handoff", { outcome: "STORE_FAILED", sent: true, stored: false });
    return { outcome: "STORE_FAILED", evidence };
  }

  if (!response.stored) {
    // The client's reason is a status code or a safe backend constant — the only diagnosis a refused store
    // offers, and worth carrying so "the backend said no" is distinguishable from "the backend was not there".
    const refusal = response.connectionReason ?? undefined;
    log("coupang_credential_handoff", {
      outcome: "STORE_FAILED",
      sent: true,
      stored: false,
      ...(refusal ? { connectionReason: refusal } : {}),
    });
    return { outcome: "STORE_FAILED", evidence, ...(refusal ? { connectionReason: refusal } : {}) };
  }

  const verified = response.connectionStatus === "SUCCESS";
  const reason = response.connectionReason ?? undefined;
  log("coupang_credential_handoff", {
    outcome: verified ? "STORED_AND_VERIFIED" : "STORED_NOT_VERIFIED",
    connectionStatus: response.connectionStatus,
    ...(reason ? { connectionReason: reason } : {}),
    fields: evidence.length,
  });
  return {
    outcome: verified ? "STORED_AND_VERIFIED" : "STORED_NOT_VERIFIED",
    evidence,
    connectionStatus: response.connectionStatus,
    ...(reason ? { connectionReason: reason } : {}),
  };
}
