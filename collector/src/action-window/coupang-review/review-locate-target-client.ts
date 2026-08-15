/**
 * **Turning an opaque binding into something to look for** — one POST, to one endpoint, over the loopback
 * backend.
 *
 * A separate module from the session that calls it, for the reason the review handoff client is separate:
 * the session can then be tested with no network at all, and the one function in this package that fetches a
 * locate target is this one, by itself, short enough to read in full.
 *
 * **Every refusal is `null`.** Spent, expired, another tenant's, malformed, backend unreachable, response not
 * JSON — the caller has exactly one response to all of them (end the run; the seller presses again), and a
 * client that distinguished them would be handing a caller reasons it has no use for and a log line more
 * detail about a seller's binding than "we did not get one".
 *
 * **It never logs the target and never reads a failed response body.** A 4xx here is diagnosed by its status
 * and nothing else; reading the body would make this the one place a refusal message and a review's
 * identifying fields could meet.
 */
import { log } from "../../log";
import type { ReviewLocateTarget } from "./review-locate";

type FetchImpl = typeof fetch;

const HEX16 = /^[0-9a-f]{16}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve `locateRef` into the target the matcher compares rows against, or `null`.
 *
 * The response is validated into the target's exact shape rather than cast: a backend that answered with a
 * partial object would otherwise produce a target that matches on fewer fields the emptier it got, and the
 * emptiest target of all matches every row — the failure `locateReviewOnPage` refuses at its own door, held
 * here too so a malformed answer never reaches it.
 */
export async function fetchReviewLocateTarget(
  baseUrl: string,
  token: string,
  locateRef: string,
  fetchImpl: FetchImpl = fetch,
): Promise<ReviewLocateTarget | null> {
  if (!HEX16.test(locateRef)) {
    log("aw_coupang_review_locate_target_refused", { reason: "MALFORMED_REF" });
    return null;
  }
  let res: Response;
  try {
    // The binding rides in the BODY. It is a single-use secret, and a path segment is written verbatim into
    // every access log between here and the backend — loopback today, not necessarily forever.
    res = await fetchImpl(`${baseUrl}/api/agent/review-locate-targets`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ locateRef }),
    });
  } catch {
    // The caught error is not inspected: a fetch failure can quote the request it failed on.
    log("aw_coupang_review_locate_target_refused", { reason: "TRANSPORT" });
    return null;
  }
  if (!res.ok) {
    log("aw_coupang_review_locate_target_refused", { httpStatus: res.status });
    return null;
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    log("aw_coupang_review_locate_target_refused", { reason: "MALFORMED_RESPONSE" });
    return null;
  }
  const target = parseTarget(body);
  log("aw_coupang_review_locate_target", { resolved: target !== null });
  return target;
}

/** The wire shape, checked field by field. Anything missing or off-shape is a refusal, never a partial target. */
export function parseTarget(body: unknown): ReviewLocateTarget | null {
  if (typeof body !== "object" || body === null) return null;
  const r = body as Record<string, unknown>;
  const productId = r.productId;
  const writtenOn = r.writtenOn;
  const rating = r.rating;
  const bodyFingerprint = r.bodyFingerprint;
  const vendorItemId = r.vendorItemId;
  if (typeof productId !== "string" || productId.length === 0) return null;
  if (typeof writtenOn !== "string" || !ISO_DATE.test(writtenOn)) return null;
  if (!Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 5) return null;
  if (typeof bodyFingerprint !== "string" || !FINGERPRINT.test(bodyFingerprint)) return null;
  // The option id narrows a match; it is genuinely absent on some rows, so absent is a value here and
  // anything that is neither a non-empty string nor absent is a malformed answer.
  if (vendorItemId !== null && vendorItemId !== undefined && typeof vendorItemId !== "string") return null;
  return {
    productId,
    vendorItemId: typeof vendorItemId === "string" && vendorItemId.length > 0 ? vendorItemId : null,
    writtenOn,
    rating: rating as number,
    bodyFingerprint,
  };
}
