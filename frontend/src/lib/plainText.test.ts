import { describe, expect, it } from "vitest";
import { plainText, previewText } from "./plainText";

describe("plainText", () => {
  it("removes the markup Cafe24 actually sends", () => {
    // The literal opening of the first inquiry on this org's 문의 screen.
    expect(plainText('<meta charset="utf-8">안녕하세요.\n연동 테스트 중입니다.')).toBe(
      "안녕하세요.\n연동 테스트 중입니다.",
    );
  });

  it("decodes the entities NAVER review bodies arrive with", () => {
    expect(plainText("설명에 &ldquo;두 개씩&rdquo; 이라고 &amp; 적혀")).toBe(
      "설명에 “두 개씩” 이라고 & 적혀",
    );
  });

  it("keeps paragraphs a channel expressed as tags, and collapses the empty ones", () => {
    expect(plainText("<p>첫 줄</p><p>둘째 줄</p>")).toBe("첫 줄\n둘째 줄");
    expect(plainText("한 줄<br><br><br>다음 줄")).toBe("한 줄\n\n다음 줄");
  });

  it("never turns markup into markup", () => {
    expect(plainText("<script>alert(1)</script>안녕")).toBe("alert(1)안녕");
    expect(plainText("&lt;b&gt;굵게&lt;/b&gt;")).toBe("<b>굵게</b>");
  });

  it("leaves an unknown entity alone rather than guessing", () => {
    expect(plainText("&notanentity; 남음")).toBe("&notanentity; 남음");
  });

  it("is empty for empty input, never the string 'null'", () => {
    expect(plainText(null)).toBe("");
    expect(plainText(undefined)).toBe("");
    expect(plainText("   ")).toBe("");
  });

  it("previewText puts a row on one line", () => {
    expect(previewText("<p>첫 줄</p><p>둘째 줄</p>")).toBe("첫 줄 둘째 줄");
  });
});
