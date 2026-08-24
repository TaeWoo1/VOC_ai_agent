import { describe, expect, it } from "vitest";
import {
  bindErrorMessage,
  bindingLabel,
  canBindProduct,
  needsOverrideConfirm,
  productLabel,
  SOURCE_BINDING_EXISTS,
} from "./inquiryProductBinding";
import type { InquiryDetail } from "./types";

const base = {
  productId: null,
  productName: null,
  productBinding: null,
} as unknown as InquiryDetail;

describe("문의 상품 연결 — 사람이 정한 것과 채널이 정한 것", () => {
  it("상품이 없으면 없다고 말한다 — 빈칸으로 두지 않는다", () => {
    // "(미지정 상품)" is why a draft could not be grounded; hiding it makes the limitation above the
    // draft look arbitrary.
    expect(productLabel({ productName: null })).toBe("상품 미지정");
    expect(productLabel({ productName: "선바로 전선몰딩" })).toBe("선바로 전선몰딩");
  });

  it("사람이 지정한 연결만 표시가 붙는다", () => {
    expect(bindingLabel({ productId: "p1", productBinding: "USER_CONFIRMED" })).toBe("사용자 지정");
    // The channel-made case is unmarked on purpose: labelling it too would make every attributed
    // inquiry look like it needed checking.
    expect(bindingLabel({ productId: "p1", productBinding: "SOURCE_EXACT" })).toBeNull();
    expect(bindingLabel({ productId: null, productBinding: "USER_CONFIRMED" })).toBeNull();
  });

  it("이미 연결된 문의에서도 상품을 바꿀 수 있다", () => {
    // A channel match can still be wrong. A control that only appeared while the field was empty
    // would make a correction impossible without a support ticket.
    expect(canBindProduct({ ...base, productId: "p1" } as InquiryDetail)).toBe(true);
    expect(canBindProduct(null)).toBe(false);
  });

  it("채널이 정한 연결을 바꿀 때만 한 번 더 묻는다", () => {
    const source = { productId: "p1", productBinding: "SOURCE_EXACT" };
    expect(needsOverrideConfirm(source, "p2")).toBe(true);
    // Choosing the same product is agreeing, not overruling.
    expect(needsOverrideConfirm(source, "p1")).toBe(false);
    // Replacing a person's own earlier answer is ordinary and needs no ceremony.
    expect(needsOverrideConfirm({ productId: "p1", productBinding: "USER_CONFIRMED" }, "p2")).toBe(false);
    expect(needsOverrideConfirm({ productId: null, productBinding: null }, "p2")).toBe(false);
  });

  it("덮어쓰기 확인이 필요한 409는 실패 문구가 아니라 질문이 된다", () => {
    expect(bindErrorMessage(409, SOURCE_BINDING_EXISTS)).toContain("한 번 더 확인");
    // A different 409 is a real refusal and must not borrow that sentence.
    expect(bindErrorMessage(409, null)).not.toContain("한 번 더 확인");
    expect(bindErrorMessage(404)).toContain("찾을 수 없습니다");
    expect(bindErrorMessage(undefined)).toContain("다시 시도");
  });
});
