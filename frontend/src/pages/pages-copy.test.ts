import { describe, expect, it } from "vitest";
// Raw source imports (Vite ?raw, no new deps) — pure string scan, no DOM.
import aiSearch from "./AiSearch.tsx?raw";
import reports from "./Reports.tsx?raw";

// Guard the AI 검색 / 리포트 pages against roadmap / coming-soon placeholder copy and
// keep them anchored to honest, data-grounded wording. Scoped to these two files only;
// "준비 중" is legitimate elsewhere (channel status).
const BANNED_ROADMAP_PHRASES = [
  "다음 단계에서",
  "곧",
  "연결 예정",
  "준비 중",
  "운영 정상화",
  "예시 화면",
];

describe("AI 검색 / 리포트 — honest workspace copy", () => {
  it("contains no roadmap / coming-soon placeholder wording", () => {
    for (const [name, src] of [["AiSearch", aiSearch], ["Reports", reports]] as const) {
      for (const banned of BANNED_ROADMAP_PHRASES) {
        expect(src, `${name} must not contain "${banned}"`).not.toContain(banned);
      }
    }
  });

  it("anchors each page to honest, data-grounded copy", () => {
    expect(aiSearch).toContain("연결된 리뷰·문의 데이터");
    expect(reports).toContain("수집된 리뷰·문의 데이터를 기준으로");
  });

  it("no longer depends on the deleted ComingSoon placeholder component", () => {
    expect(reports).not.toContain("ComingSoon");
  });
});
