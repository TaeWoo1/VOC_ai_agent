/**
 * **Spending an `acquisitionRef`** — one POST, to one endpoint, over the loopback backend.
 *
 * The acquisition sibling of `review-locate-target-client.ts`, with the same posture: every refusal is `null`
 * (spent, expired, another tenant's, malformed, unreachable, not JSON — the caller has one response to all of
 * them: end the run, the seller starts again), the ref rides in the BODY (single-use, and a path segment is
 * written into every access log between here and the backend), a failed response body is never read, and
 * nothing about the resolved account is logged.
 *
 * What comes back is the ONE thing the handoff needs that the tab must never send: the opaque 24-hex
 * `accountSlot` the review-handoff endpoint already keys on. The endpoint is the lane-A mint's spend side
 * (`POST /api/agent/review-acquisition-targets`); until it exists every run ends `ACQUISITION_TARGET_UNRESOLVED`,
 * which is the honest ending for a binding nobody can resolve.
 */
import { log } from "../../log";

type FetchImpl = typeof fetch;

const HEX16 = /^[0-9a-f]{16}$/;
const SLOT = /^[0-9a-f]{24}$/;

export interface ReviewAcquisitionTarget {
  /** Opaque account-session slot the handoff is keyed on. 24 lowercase hex. */
  readonly accountSlot: string;
  /** The channel the binding was minted for — `COUPANG` today; checked by the session, never assumed. */
  readonly channelCode: string;
}

export async function fetchReviewAcquisitionTarget(
  baseUrl: string,
  token: string,
  acquisitionRef: string,
  fetchImpl: FetchImpl = fetch,
): Promise<ReviewAcquisitionTarget | null> {
  if (!HEX16.test(acquisitionRef)) {
    log("aw_coupang_review_acquisition_target_refused", { reason: "MALFORMED_REF" });
    return null;
  }
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}/api/agent/review-acquisition-targets`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ acquisitionRef }),
    });
  } catch {
    log("aw_coupang_review_acquisition_target_refused", { reason: "TRANSPORT" });
    return null;
  }
  if (!res.ok) {
    log("aw_coupang_review_acquisition_target_refused", { httpStatus: res.status });
    return null;
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    log("aw_coupang_review_acquisition_target_refused", { reason: "MALFORMED_RESPONSE" });
    return null;
  }
  const target = parseAcquisitionTarget(body);
  log("aw_coupang_review_acquisition_target", { resolved: target !== null });
  return target;
}

/** The wire shape, checked field by field. Anything off-shape is a refusal, never a partial target. */
export function parseAcquisitionTarget(body: unknown): ReviewAcquisitionTarget | null {
  if (typeof body !== "object" || body === null) return null;
  const r = body as Record<string, unknown>;
  const accountSlot = r.accountSlot;
  const channelCode = r.channelCode;
  if (typeof accountSlot !== "string" || !SLOT.test(accountSlot)) return null;
  if (typeof channelCode !== "string" || !/^[A-Z][A-Z0-9_]{1,31}$/.test(channelCode)) return null;
  return { accountSlot, channelCode };
}
