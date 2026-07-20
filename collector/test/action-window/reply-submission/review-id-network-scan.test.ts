/**
 * Rung 6 — the review-list network response scan. The response body is the rawest data in this milestone, so
 * these tests pin the two properties that matter: the target identity is detectable in it, and **nothing that
 * comes out of the scan can be turned back into review data**.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_SCANNED_CHARS,
  networkResponseExposesReviewId,
  scanTextForReviewIdFingerprints,
} from "../../../src/action-window/reply-submission/review-id-network-scan";
import { channelReviewIdFingerprint } from "../../../src/action-window/reply-submission/review-id-fingerprint";

const TARGET_ID = "1234567890";
const TARGET_FP = channelReviewIdFingerprint(TARGET_ID)!;

describe("scanTextForReviewIdFingerprints", () => {
  it("finds an id embedded in a JSON response and reports it only as a digest", () => {
    const body = JSON.stringify({ reviews: [{ reviewNo: TARGET_ID, body: "배송이 느려요", writer: "user***" }] });
    const scan = scanTextForReviewIdFingerprints(body);
    expect(scan.fingerprints.has(TARGET_FP)).toBe(true);
    // Nothing recognisable from the body survives: the result is digests only.
    for (const fp of scan.fingerprints) {
      expect(fp).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(JSON.stringify([...scan.fingerprints])).not.toContain(TARGET_ID);
    expect(JSON.stringify([...scan.fingerprints])).not.toContain("배송");
  });

  it("does not find an id that is not there", () => {
    const scan = scanTextForReviewIdFingerprints(JSON.stringify({ reviews: [{ reviewNo: "5555555555" }] }));
    expect(scan.fingerprints.has(TARGET_FP)).toBe(false);
  });

  it("ignores tokens too short to be an id, so ordinary numbers do not become identities", () => {
    const scan = scanTextForReviewIdFingerprints("rating 5, page 12, count 345");
    expect(scan.fingerprints.size).toBe(0);
  });

  it("is null/empty safe", () => {
    expect(scanTextForReviewIdFingerprints(null).fingerprints.size).toBe(0);
    expect(scanTextForReviewIdFingerprints(undefined).tokenCount).toBe(0);
    expect(scanTextForReviewIdFingerprints("").truncated).toBe(false);
  });

  it("flags a truncated scan, so a miss is never reported as a proven absence", () => {
    const filler = "x".repeat(MAX_SCANNED_CHARS);
    const scan = scanTextForReviewIdFingerprints(`${filler}${TARGET_ID}`);
    expect(scan.truncated).toBe(true);
    expect(scan.fingerprints.has(TARGET_FP)).toBe(false);
  });

  it("repeated calls are independent — the module-level /g regexes carry no state between scans", () => {
    const body = JSON.stringify({ reviewNo: TARGET_ID });
    const first = scanTextForReviewIdFingerprints(body);
    const second = scanTextForReviewIdFingerprints(body);
    const third = scanTextForReviewIdFingerprints(body);
    expect(first.fingerprints.has(TARGET_FP)).toBe(true);
    expect(second.fingerprints.has(TARGET_FP)).toBe(true);
    expect(third.fingerprints.has(TARGET_FP)).toBe(true);
    expect(second.tokenCount).toBe(first.tokenCount);
    expect(third.tokenCount).toBe(first.tokenCount);
  });

  it("dedupes repeats of the same id across a paginated body", () => {
    const body = [TARGET_ID, TARGET_ID, TARGET_ID].join(",");
    const scan = scanTextForReviewIdFingerprints(body);
    expect([...scan.fingerprints].filter((f) => f === TARGET_FP)).toHaveLength(1);
  });
});

describe("networkResponseExposesReviewId", () => {
  it("reports presence together with the scan, so truncation travels with the verdict", () => {
    const hit = networkResponseExposesReviewId(TARGET_FP, `{"id":"${TARGET_ID}"}`);
    expect(hit.present).toBe(true);
    expect(hit.scan.truncated).toBe(false);

    const miss = networkResponseExposesReviewId(TARGET_FP, `{"id":"0000000001"}`);
    expect(miss.present).toBe(false);
  });

  it("a truncated miss is still a miss, but is reported as truncated", () => {
    const result = networkResponseExposesReviewId(TARGET_FP, `${"x".repeat(MAX_SCANNED_CHARS)}${TARGET_ID}`);
    expect(result.present).toBe(false);
    expect(result.scan.truncated).toBe(true);
  });
});
