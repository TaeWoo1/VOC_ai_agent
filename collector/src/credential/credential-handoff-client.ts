/**
 * **The wire half of the credential handoff** — one POST, to one endpoint, over the loopback backend.
 *
 * It is a separate module from the flow that calls it so that the flow can be tested with no network at all, and
 * so that the only function in this package which puts a secret on a socket is this one, by itself, and short
 * enough to read in full.
 *
 * **What it must never do, and does not:** log the body, log the response body, echo a value into an error
 * message, retry (a retry is a second copy of the same secret on the wire, and the backend's intake is not
 * idempotent in a way that makes one safe), or return anything the caller could mistake for a value.
 */
import { log } from "../log";
import type { CredentialHandoffResponse } from "./coupang-credential-handoff";

type FetchImpl = typeof fetch;

/**
 * **Which approved run this handoff belongs to**, presented back to the backend so it can check the request
 * against the identity it was armed with out of band.
 *
 * Every field is an environment token minted by the bootstrap — no credential, no seller identity — and all
 * four travel because each closes a different way to reuse a grant. The backend refuses a request that presents
 * an identity nobody armed, before the vault is touched. See `CredentialHandoffArming` on the backend side.
 */
export interface CredentialHandoffRunBinding {
  readonly approvalId: string;
  readonly runId: string;
  readonly gitCommit: string;
  readonly phase: string;
}

/** A network failure, carrying no body and no value. The HTTP status is the whole diagnosis it offers. */
export class CredentialHandoffTransportError extends Error {
  constructor(readonly httpStatus?: number) {
    super(httpStatus === undefined ? "credential handoff transport failed" : `credential handoff failed (${httpStatus})`);
    this.name = "CredentialHandoffTransportError";
  }
}

/**
 * Hand the secrets to the backend, which resolves the opaque slot, stores them through the existing vault path,
 * and runs the read-only connection check.
 *
 * An HTTP error is RETURNED as a non-stored result carrying only the status code, rather than thrown: the caller
 * has to record a value-free outcome either way, and a thrown `fetch`/JSON error is the classic route by which a
 * response body reaches a log line. A transport failure — where there is no response at all — throws
 * {@link CredentialHandoffTransportError}, which carries nothing.
 */
export async function postCoupangCredentialHandoff(
  baseUrl: string,
  token: string,
  accountSlot: string,
  channelCode: string,
  secrets: Readonly<Record<string, string>>,
  runBinding: CredentialHandoffRunBinding,
  fetchImpl: FetchImpl = fetch,
): Promise<CredentialHandoffResponse> {
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}/api/agent/credential-handoff`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ accountSlot, channelCode, secrets, runBinding }),
    });
  } catch {
    // The caught error is not inspected: a fetch failure can quote the request it failed on.
    throw new CredentialHandoffTransportError();
  }
  if (!res.ok) {
    // No body is read. A 4xx from this endpoint is one of its own safe reason constants, but reading it here
    // would make this function a place where a response body exists, and it does not need to be one.
    log("credential.handoff.rejected", { httpStatus: res.status });
    return { stored: false, connectionStatus: "FAILED", connectionReason: `HTTP_${res.status}` };
  }
  let body: { stored?: unknown; connectionStatus?: unknown; connectionReason?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // A non-JSON 200 (a proxy page, an HTML redirect) must not surface as a SyntaxError whose message quotes
    // that page. It also cannot be treated as a successful store: fail closed.
    log("credential.handoff.rejected", { httpStatus: res.status, parsed: false });
    return { stored: false, connectionStatus: "FAILED", connectionReason: "MALFORMED_RESPONSE" };
  }
  const stored = body.stored === true;
  const connectionStatus = typeof body.connectionStatus === "string" ? body.connectionStatus : "UNKNOWN";
  const connectionReason = typeof body.connectionReason === "string" ? body.connectionReason : null;
  // Status and reason only — both are backend-authored safe constants, and neither is derived from a secret.
  log("credential.handoff.stored", { stored, connectionStatus, ...(connectionReason ? { connectionReason } : {}) });
  return { stored, connectionStatus, connectionReason };
}
