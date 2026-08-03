import { describe, expect, it } from "vitest";
// Raw source imports (Vite ?raw, no new deps) — pure string scan, no DOM.
import reports from "./app/ReportsV2.tsx?raw";

// Guard the 리포트 page against roadmap / coming-soon placeholder copy and keep it
// anchored to honest, data-grounded wording. (The standalone AI 검색 page was
// removed in the Product Shell slice — future RAG is a contextual panel, not a
// nav page — so it is no longer guarded here.) "준비 중" is legitimate elsewhere
// (channel status), so this stays scoped to Reports.
const BANNED_ROADMAP_PHRASES = [
  "다음 단계에서",
  "곧",
  "연결 예정",
  "준비 중",
  "운영 정상화",
  "예시 화면",
];

describe("리포트 — honest workspace copy", () => {
  it("contains no roadmap / coming-soon placeholder wording", () => {
    for (const banned of BANNED_ROADMAP_PHRASES) {
      expect(reports, `Reports must not contain "${banned}"`).not.toContain(banned);
    }
  });

  it("anchors the page to honest, data-grounded copy", () => {
    expect(reports).toContain("수집된 문의·리뷰를 기준으로");
  });

  it("no longer depends on the deleted ComingSoon placeholder component", () => {
    expect(reports).not.toContain("ComingSoon");
  });

  it("asserts no business outcome it cannot measure", () => {
    // A report that claims 매출/전환율/만족도 improvement teaches the reader to distrust the rows
    // that ARE true. Nothing in the data measures any of them.
    for (const claim of ["매출 향상", "매출 증가", "전환율", "만족도", "성과 개선"]) {
      expect(reports, `리포트에 "${claim}" 주장이 있으면 안 됩니다`).not.toContain(claim);
    }
  });
});

// Seller-facing error-copy guard (Product Shell slice): developer-facing backend
// troubleshooting copy must never return to a user-facing surface. The Korean
// token "백엔드" only ever appeared in the "백엔드가 실행 중인지 확인해 주세요"
// error strings (now replaced with seller-facing recovery copy); English
// "backend" in code identifiers/comments is a different token and is not matched.
// Scans every page, component, and lib source (test files excluded).
// Recursive on purpose. The globs used to be flat (`./*.tsx`, `../components/*.tsx`,
// `../lib/*.{ts,tsx}`), which silently exempted every feature subfolder — including the public
// product surface, where copy discipline matters most. Widening them is what makes the guard
// mean what its name says.
const sources = {
  ...import.meta.glob("./**/*.tsx", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../components/**/*.tsx", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../lib/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }),
} as Record<string, string>;

describe("셀러향 오류 문구 — no developer backend instructions", () => {
  for (const [path, src] of Object.entries(sources)) {
    if (path.includes(".test.")) {
      continue;
    }
    it(`${path} contains no user-facing 백엔드 troubleshooting copy`, () => {
      expect(src, `${path} must not contain user-facing "백엔드" copy`).not.toContain("백엔드");
    });
  }
});
