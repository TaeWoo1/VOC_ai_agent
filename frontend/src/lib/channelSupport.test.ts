import { describe, expect, it } from "vitest";
import {
  BANNED_SUPPORT_PHRASES,
  channelSupportDisplay,
  SUPPORT_COPY,
} from "./channelSupport";
import { mockChannels } from "./mocks";
import type { ChannelResponse } from "./types";

const channels = mockChannels();
const byCode = (code: string): ChannelResponse =>
  channels.find((c) => c.code === code) ?? (() => { throw new Error(`missing ${code}`); })();

const allStrings = (c: ChannelResponse): string[] => {
  const d = channelSupportDisplay(c);
  return [d.primaryLabel, ...d.chips, d.uploadQualifier].filter((s): s is string => !!s);
};

describe("channel coverage — 8 target seller centers", () => {
  it("represents all 8 target channels (G마켓/옥션 combined into one card)", () => {
    // Auction is represented inside the combined GMARKET card, not as its own code.
    for (const code of ["COUPANG", "NAVER", "CAFE24", "ELEVENST", "GMARKET", "SSG", "OHOUSE"]) {
      expect(channels.some((c) => c.code === code)).toBe(true);
    }
    const gmarket = byCode("GMARKET");
    expect(gmarket.nameKo).toContain("G마켓");
    expect(gmarket.nameKo).toContain("옥션");
  });
});

describe("honest copy rules", () => {
  it("never emits banned over-claim / roadmap wording for any channel", () => {
    for (const c of channels) {
      for (const text of allStrings(c)) {
        for (const banned of BANNED_SUPPORT_PHRASES) {
          expect(text).not.toContain(banned);
        }
        // The over-confirming "엑셀 업로드로 수집: 리뷰·문의·주문" pattern must never appear.
        expect(text).not.toContain("엑셀 업로드로 수집");
      }
    }
  });

  it("only NAVER is shown as auto-collecting, and only NAVER names a verified upload format", () => {
    for (const c of channels) {
      const display = channelSupportDisplay(c);
      const autoShown = display.primaryLabel.startsWith(SUPPORT_COPY.autoCollect);
      const namesVerifiedFormat = allStrings(c).some((s) =>
        s.includes(SUPPORT_COPY.naverVerifiedUpload),
      );
      if (c.code === "NAVER") {
        expect(autoShown).toBe(true);
        expect(namesVerifiedFormat).toBe(true);
      } else {
        expect(autoShown).toBe(false);
        expect(namesVerifiedFormat).toBe(false);
      }
    }
  });
});

describe("per-channel display", () => {
  it("NAVER: auto-collect order + verified review-export upload, no caveat", () => {
    const d = channelSupportDisplay(byCode("NAVER"));
    expect(d.primaryLabel).toBe(`${SUPPORT_COPY.autoCollect}: 주문`);
    expect(d.chips).toEqual([SUPPORT_COPY.naverVerifiedUpload]);
    expect(d.uploadQualifier).toBeNull(); // NAVER is the verified-format exception
  });

  it("GMARKET (templated, no auto-collect): conservative upload wording + format caveat", () => {
    const d = channelSupportDisplay(byCode("GMARKET"));
    expect(d.primaryLabel).toBe(SUPPORT_COPY.fileUpload);
    expect(d.uploadQualifier).toBe(SUPPORT_COPY.fileUploadQualifier);
    expect(d.chips).toEqual([]);
  });

  it("OHOUSE (no template): upload only, still caveated", () => {
    const d = channelSupportDisplay(byCode("OHOUSE"));
    expect(d.primaryLabel).toBe(SUPPORT_COPY.fileUpload);
    expect(d.chips).toEqual([]);
    expect(d.uploadQualifier).toBe(SUPPORT_COPY.fileUploadQualifier);
  });

  it("connector facts (connection check, credential template) never render as chips (A6)", () => {
    // They describe how SellerOps is built, not what the row does for the seller — every row used to
    // carry "연결 확인 가능 · 연결 정보 저장 가능" as boilerplate.
    for (const c of channels) {
      for (const text of allStrings(c)) {
        expect(text).not.toContain("연결 확인 가능");
        expect(text).not.toContain("연결 정보 저장 가능");
      }
    }
  });
});
