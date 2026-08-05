import { describe, expect, it } from "vitest";
import * as content from "./landingContent";
import { CTA_DEMO_LABEL, CTA_DIAGNOSIS_LABEL } from "./publicCta";

// Every string the public page can render, flattened. Scanning the content module (rather than
// the JSX) is the point of having one: a copy edit anywhere on the landing page passes through
// here, so these guards cannot be sidestepped by writing prose directly into a component.
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      collectStrings(entry, out);
    }
  } else if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) {
      collectStrings(entry, out);
    }
  }
  return out;
}

const ALL_COPY = collectStrings(content).join("\n");

describe("landing content — structure", () => {
  it("orders twelve sections from hero to closing", () => {
    expect(content.SECTION_ORDER).toHaveLength(12);
    expect(content.SECTION_ORDER[0]).toBe("hero");
    expect(content.SECTION_ORDER[content.SECTION_ORDER.length - 1]).toBe("closing");
    expect(new Set(content.SECTION_ORDER).size).toBe(content.SECTION_ORDER.length);
  });

  it("keeps the CTA wording identical to the shared contract", () => {
    expect(content.CTA_LABELS.primary).toBe(CTA_DIAGNOSIS_LABEL);
    expect(content.CTA_LABELS.secondary).toBe(CTA_DEMO_LABEL);
  });
});

describe("landing content — no channel claims", () => {
  // Support is declared per (channel × data type × operation), and the production-supported level
  // does not back a channel list. Naming a marketplace on a public page is therefore a claim the
  // product cannot stand behind — the page answers with connection METHODS instead.
  const CHANNEL_TOKENS = [
    "네이버",
    "스마트스토어",
    "쿠팡",
    "카페24",
    "Cafe24",
    "11번가",
    "지마켓",
    "옥션",
    "ESM",
    "SSG",
    "오늘의집",
    "NAVER",
    "Coupang",
  ];

  for (const token of CHANNEL_TOKENS) {
    it(`never names "${token}"`, () => {
      expect(ALL_COPY).not.toContain(token);
    });
  }
});

describe("landing content — no roadmap or over-claim wording", () => {
  const ROADMAP_TOKENS = [
    "곧 ",
    "곧이어",
    "출시 예정",
    "연결 예정",
    "지원 예정",
    "준비 중",
    "연동 완료",
    "자동 연동",
    "자동 수집 완료",
    "전체 채널 지원",
    "운영 정상화",
    "다음 단계에서",
    "실시간",
  ];

  for (const token of ROADMAP_TOKENS) {
    it(`never says "${token.trim()}"`, () => {
      expect(ALL_COPY).not.toContain(token);
    });
  }
});

describe("landing content — no implementation mechanism", () => {
  // The seller-facing promise is the operating outcome. How data is fetched is not a selling
  // point, and naming it invites a conversation about tooling instead of about their operation.
  const MECHANISM_TOKENS = [
    "로컬 에이전트",
    "브라우저 자동화",
    "스크래핑",
    "크롤링",
    "매크로",
    "백엔드",
    "서버",
  ];

  for (const token of MECHANISM_TOKENS) {
    it(`never says "${token}"`, () => {
      expect(ALL_COPY).not.toContain(token);
    });
  }
});

describe("landing content — no unbacked proof", () => {
  // Percentages, multiples, customer counts, logos and testimonials all assert measurement that
  // has not happened. A single invented figure would be the fastest way to lose an owner-operator.
  const METRIC_PATTERNS = [
    /\d+\s*%/,
    /\d+\s*배\b/,
    /\d+\s*시간\s*(단축|절약)/,
    /\d+\s*(개사|곳|팀|명)\s*(이|가)?\s*(사용|도입)/,
  ];

  for (const pattern of METRIC_PATTERNS) {
    it(`states no measured claim matching ${pattern}`, () => {
      expect(ALL_COPY).not.toMatch(pattern);
    });
  }

  for (const token of ["고객사", "도입 사례", "만족도", "평점", "★"]) {
    it(`presents no social proof via "${token}"`, () => {
      expect(ALL_COPY).not.toContain(token);
    });
  }
});

describe("landing content — the diagnosis is described as human work", () => {
  it("never presents the diagnosis as an automated feature", () => {
    expect(ALL_COPY).not.toContain("자동 진단");
    expect(ALL_COPY).not.toContain("AI 진단");
    expect(ALL_COPY).not.toContain("자동으로 진단");
  });

  it("says outright that it is not an automatic feature", () => {
    expect(ALL_COPY).toContain("자동으로 돌아가는 기능이 아닙니다");
  });

  it("names what the seller receives", () => {
    expect(content.CLOSING.deliverables).toEqual([
      "반복해서 들어오는 문의",
      "방치되고 있는 부정 리뷰",
      "FAQ로 만들 후보",
      "상세페이지에서 고칠 후보",
    ]);
  });

  it("asks for no credentials", () => {
    expect(ALL_COPY).toContain("계정 정보나 비밀번호는 필요하지 않습니다");
  });
});

describe("landing content — the file-import route keeps its confirmed name", () => {
  it("uses 정기 자료 가져오기", () => {
    expect(ALL_COPY).toContain("정기 자료 가져오기");
  });

  it("never fronts it as 엑셀 업로드", () => {
    expect(ALL_COPY).not.toContain("엑셀 업로드");
    expect(ALL_COPY).not.toContain("엑셀 파일");
  });
});

describe("landing content — sending stays with the seller", () => {
  it("states that SellerOps does not send on the seller's behalf", () => {
    expect(ALL_COPY).toContain("보내지 않습니다");
    expect(content.GUIDE.notItems).toContain("판매자를 대신해 고객에게 답변을 보내는 도구");
  });
});
