import { describe, expect, it } from "vitest";
import { withSubject, withTopic } from "../../src/korean";

/**
 * The three sentences this repository has already shipped wrong, pinned.
 *
 * Every one was found by reading a live answer, never by a test: "쿠팡는" (Cross-Channel v1),
 * "쿠팡가 매출의 60%" (the backend's first Overview read) and the literal placeholder "은(는)" printed
 * at a seller by ProductOps. A channel or product name is DATA, and a particle concatenated to data
 * without looking at it is a defect that returns with every new name.
 */
describe("한국어 조사", () => {
  it("받침 있는 이름", () => {
    expect(withTopic("쿠팡")).toBe("쿠팡은");
    expect(withSubject("쿠팡")).toBe("쿠팡이");
  });

  it("받침 없는 이름", () => {
    expect(withTopic("스토어")).toBe("스토어는");
    expect(withSubject("스토어")).toBe("스토어가");
  });

  it("이 제품이 실제로 쓰는 이름들", () => {
    expect(withTopic("네이버 스마트스토어")).toBe("네이버 스마트스토어는");
    expect(withTopic("카페24 자사몰")).toBe("카페24 자사몰은");
    expect(withTopic("브랜드")).toBe("브랜드는");
    expect(withTopic("제조사")).toBe("제조사는");
    // The literal that was on screen: "…의 brand은(는) 선바로입니다".
    expect(withTopic("브랜드")).not.toContain("(");
  });

  it("한글이 아닌 끝은 열린 음절 형태를 쓴다 — 읽는 사람이 그렇게 읽는다", () => {
    expect(withTopic("Cafe24")).toBe("Cafe24는");
    expect(withSubject("NAVER")).toBe("NAVER가");
  });

  it("빈 이름은 조사만 남기지 않는다", () => {
    expect(withTopic("")).toBe("");
    expect(withSubject("   ")).toBe("");
  });
});
