import { describe, expect, it } from "vitest";
import { acquisitionOf } from "../../src/operator/capability/ChannelCapability";
import type { ChannelCapabilityOverview } from "../../src/spring/types";

function overview(code: string, paths: Array<{ method: string; recurrence: string }>, opts: { supported?: boolean; apiGap?: boolean } = {}): ChannelCapabilityOverview {
  return {
    channelCode: code, channelNameKo: null, connectorClass: null, autoCollectSupported: true,
    dataTypes: [{ dataType: "REVIEW", label: null, supported: opts.supported ?? false, verificationStatus: "LIVE_PROVEN",
      acquisitionPaths: paths.map((p) => ({ ...p, verificationStatus: "LIVE_PROVEN" })) }],
    unsupportedScopes: opts.apiGap ? [{ code: "REVIEW_API", label: "리뷰 API 없음" }] : [],
  };
}
const sources = (o: ChannelCapabilityOverview | null) => ({ overview: o, transports: null, publish: null, reviewChannel: null, localAgent: "UNKNOWN" as const });

describe("acquisition capability — a closed table over the overview, independent of freshness and of pairing", () => {
  it("a scheduled API path is AUTOMATIC; the backend's REVIEW_API gap overrides the connector bit", () => {
    expect(acquisitionOf("CAFE24", "REVIEW", sources(overview("CAFE24", [{ method: "API", recurrence: "SCHEDULED" }], { supported: true }))).acquisition).toBe("AUTOMATIC");
    expect(acquisitionOf("NAVER", "REVIEW", sources(overview("NAVER", [{ method: "API", recurrence: "SCHEDULED" }], { supported: true, apiGap: true }))).acquisition).not.toBe("AUTOMATIC");
  });

  it("NAVER EXPORT is guided with the file upload as FALLBACK only; Coupang ACTION_WINDOW is guided with no fallback", () => {
    const naver = acquisitionOf("NAVER", "REVIEW", sources(overview("NAVER", [{ method: "EXPORT", recurrence: "SELLER_REPEATED" }], { apiGap: true })));
    expect(naver).toMatchObject({ acquisition: "GUIDED_HUMAN_ACTION", guidedPath: "EXPORT_ACTION_WINDOW", requiresLocalAgent: true });
    expect(naver.fallback?.path).toBe("FILE_UPLOAD");
    const coupang = acquisitionOf("COUPANG", "REVIEW", sources(overview("COUPANG", [{ method: "ACTION_WINDOW", recurrence: "SELLER_REPEATED" }], { apiGap: true })));
    expect(coupang).toMatchObject({ acquisition: "GUIDED_HUMAN_ACTION", guidedPath: "WING_READ_ACTION_WINDOW", fallback: null });
  });

  it("an EXPORT on a channel with no reviewnary carrier is UNSUPPORTED — never turned into a file-upload primary (§12)", () => {
    const other = acquisitionOf("ESM", "REVIEW", sources(overview("ESM", [{ method: "EXPORT", recurrence: "ONE_OFF" }])));
    expect(other.acquisition).toBe("UNSUPPORTED");
    expect(other.guidedPath).toBeNull();
  });

  it("a channel whose own path IS the seller's file (MANUAL) reaches us by file upload", () => {
    const manual = acquisitionOf("ESM", "REVIEW", sources(overview("ESM", [{ method: "MANUAL", recurrence: "ONE_OFF" }])));
    expect(manual).toMatchObject({ acquisition: "GUIDED_HUMAN_ACTION", guidedPath: "FILE_UPLOAD", requiresLocalAgent: false });
  });

  it("no overview row ⇒ UNSUPPORTED, never a guess", () => {
    expect(acquisitionOf("NAVER", "REVIEW", sources(null)).acquisition).toBe("UNSUPPORTED");
  });
});
