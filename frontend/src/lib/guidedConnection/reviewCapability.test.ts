// REVIEW_IMPORT capability overlay: the Local-Agent pairing state affects ONLY the REVIEW_IMPORT line,
// and nothing about the order connection. Pure/node-env.
import { describe, it, expect } from "vitest";
import { overlayReviewImport, reviewImportNeedsSetup } from "./reviewCapability";
import type { ConnectionCapabilityView } from "../types";

function cap(reviewState = "GUIDED_CONFIRMATION"): ConnectionCapabilityView {
  return {
    sellerAccountId: "acc-1",
    channelCode: "NAVER",
    connectionStatus: "CONNECTED",
    credentialPresent: true,
    identityConfirmed: true,
    firstSyncStatus: "SUCCESS",
    overall: "AVAILABLE",
    reason: null,
    features: [
      { feature: "ORDER_READ", state: "AVAILABLE", label: "주문 조회", reason: null },
      { feature: "REVIEW_IMPORT", state: reviewState, label: "리뷰 가져오기", reason: "GUIDED_EXPORT_ONLY" },
      { feature: "REVIEW_REPLY", state: "NOT_ENABLED", label: "리뷰 답변", reason: "REPLY_UNVERIFIED" },
      { feature: "INQUIRY_READ", state: "INTEGRATION_PENDING", label: "문의 조회", reason: "INTEGRATION_PENDING" },
    ],
  };
}

const review = (v: ConnectionCapabilityView) => v.features.find((f) => f.feature === "REVIEW_IMPORT")!;
const other = (v: ConnectionCapabilityView) => v.features.filter((f) => f.feature !== "REVIEW_IMPORT");

describe("overlayReviewImport", () => {
  it("NOT paired → REVIEW_IMPORT becomes SETUP_REQUIRED (setup reason)", () => {
    const out = overlayReviewImport(cap(), false);
    expect(review(out).state).toBe("SETUP_REQUIRED");
    expect(review(out).reason).toBe("REVIEW_SETUP_REQUIRED");
  });

  it("paired → REVIEW_IMPORT is GUIDED_CONFIRMATION (guided-export reason)", () => {
    const out = overlayReviewImport(cap("SETUP_REQUIRED"), true);
    expect(review(out).state).toBe("GUIDED_CONFIRMATION");
    expect(review(out).reason).toBe("GUIDED_EXPORT_ONLY");
  });

  it("touches ONLY the REVIEW_IMPORT line — order / reply / inquiry are byte-identical", () => {
    const input = cap();
    const out = overlayReviewImport(input, false);
    expect(other(out)).toEqual(other(input));
    // top-level fields unchanged
    expect(out.overall).toBe(input.overall);
    expect(out.identityConfirmed).toBe(input.identityConfirmed);
    expect(out.firstSyncStatus).toBe(input.firstSyncStatus);
  });

  it("does not rewrite a non-guided review-import state (e.g. a future NEEDS_ATTENTION)", () => {
    const input = cap("NEEDS_ATTENTION");
    expect(overlayReviewImport(input, true)).toBe(input); // returned as-is (same reference)
  });
});

describe("reviewImportNeedsSetup", () => {
  it("true when a guided REVIEW_IMPORT line exists and the agent is not paired", () => {
    expect(reviewImportNeedsSetup(cap(), false)).toBe(true);
    expect(reviewImportNeedsSetup(cap("SETUP_REQUIRED"), false)).toBe(true);
  });
  it("false once the agent is paired", () => {
    expect(reviewImportNeedsSetup(cap(), true)).toBe(false);
  });
});
