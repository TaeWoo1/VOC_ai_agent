import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COPY_FALLBACK, resolveCopy } from "../actionWindow/copy";

/**
 * <b>이 lane이 판매자에게 말하지 않기로 한 것들.</b>
 *
 * 소스 스캔인 이유는 이것들이 <b>렌더 경로 하나</b>가 아니라 성질이기 때문이다 — 어느 상태에서든 이 단어가
 * 화면에 나타나면 안 된다는 것이고, 상태를 전부 렌더해서 확인하는 것은 그중 하나를 빠뜨리는 방법이다.
 */
const LANE = [
  "src/lib/connect/reviewCollection.ts",
  "src/lib/connect/coupangCapabilities.ts",
  "src/pages/app/ReviewCollectionFlow.tsx",
  "src/components/connect/coupang/CoupangChannelView.tsx",
  "src/components/connect/coupang/CapabilityCard.tsx",
];

function source(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

/** 한글이 들어 있는 문자열 리터럴 — 판매자가 읽게 되는 것의 상한. */
function sellerStrings(code: string): string[] {
  return (code.match(/"[^"\n]*[가-힣][^"\n]*"/g) ?? []).map((s) => s.slice(1, -1));
}

describe("리뷰 수집 lane — 기술어는 판매자 문장이 되지 않는다", () => {
  it("정상 흐름의 press는 기술 동작의 이름을 달지 않는다", () => {
    for (const file of LANE) {
      for (const line of sellerStrings(source(file))) {
        for (const banned of ["확인 완료", "직접 진행", "안내를 준비하고 있어요", "리체크"]) {
          expect(`${file}: ${line.includes(banned) ? line : "-"}`).toBe(`${file}: -`);
        }
      }
    }
  });

  it("우리 쪽 낱말은 판매자 문장에 없다", () => {
    for (const file of LANE) {
      for (const line of sellerStrings(source(file))) {
        for (const banned of ["carrier", "슬롯", "브리지", "Action Window", "provider", "러너", "핸드오프"]) {
          expect(`${file}: ${line.includes(banned) ? line : "-"}`).toBe(`${file}: -`);
        }
      }
    }
  });

  it("이 lane의 모든 단계에 문장이 있다", () => {
    // 넷 다 매핑이 없어 fallback으로 렌더됐고, 체크포인트 카드는 그 fallback을 20px 굵은 지시문으로 올렸다.
    for (const key of [
      "actionWindow.reviewAcquisition.run",
      "actionWindow.reviewAcquisition.openList",
      "actionWindow.reviewAcquisition.confirmPage",
      "actionWindow.reviewAcquisition.handoff",
    ]) {
      expect(resolveCopy(key)).not.toBe(COPY_FALLBACK);
    }
  });

  it("커넥터의 영문 note는 어느 화면에서도 렌더되지 않는다", () => {
    const settings = source("src/components/connect/CollectionSettingsSection.tsx");
    expect(settings).not.toMatch(/\{\s*capability\?\.notes/);
    expect(settings).not.toMatch(/capability\?\.notes\s*\?\?/);
  });

  it("쿠팡 화면은 지운 표면을 다시 들이지 않는다", () => {
    const view = source("src/components/connect/coupang/CoupangChannelView.tsx");
    for (const gone of ["ChannelSummaryCards", "CapabilityBadges", "CommunityArticleList", "NextActionPanel"]) {
      expect(`${gone}:${view.includes(gone)}`).toBe(`${gone}:false`);
    }
  });

  it("이 화면은 마켓플레이스에 쓰지 않는다", () => {
    for (const file of LANE) {
      const code = source(file);
      for (const writer of ["publish", "approve", "submit(", "execute("]) {
        expect(`${file}:${code.includes(writer)}`).toBe(`${file}:false`);
      }
    }
  });
});
