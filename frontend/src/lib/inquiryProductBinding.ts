import type { InquiryDetail } from "./types";

/**
 * How an inquiry's product attribution is described to a seller, and what the screen may offer next.
 *
 * ## Why the provenance is on screen at all
 *
 * Cafe24's 문의 board almost never names a product: 3,312 REAL inquiries in the canonical Demo Org,
 * 5 of them attributable by the channel's own identifier. Guessing the other 3,307 from the inquiry
 * text is forbidden, and rightly — a draft grounded in the wrong product's knowledge is a wrong
 * answer with a citation attached. What is left is to let the person who already knows say so.
 *
 * That makes two kinds of attribution on one screen, and they must not read the same. A channel
 * match can be re-checked by reading the channel again; a person's answer can only be checked by
 * asking that person. So the second one says "사용자 지정" and the first says nothing extra — the
 * unmarked case is the one the machine can defend on its own.
 */

/** The value the backend stores for an attribution a person made. */
export const USER_CONFIRMED = "USER_CONFIRMED";

/** The value the backend stores for an attribution the channel's own identifier made. */
export const SOURCE_EXACT = "SOURCE_EXACT";

/** The 409 code that means "you are about to overrule the channel; say so again". */
export const SOURCE_BINDING_EXISTS = "SOURCE_BINDING_EXISTS";

/** What the meta line says about this inquiry's product. */
export function productLabel(detail: Pick<InquiryDetail, "productName">): string {
  return detail.productName ?? "상품 미지정";
}

/**
 * The provenance suffix, or null when there is nothing worth saying.
 *
 * Only the person-made case is labelled. Marking the channel-made one too would turn a routine fact
 * into a warning and make every attributed inquiry look like it needed checking.
 */
export function bindingLabel(
  detail: Pick<InquiryDetail, "productId" | "productBinding">,
): string | null {
  if (!detail.productId) return null;
  return detail.productBinding === USER_CONFIRMED ? "사용자 지정" : null;
}

/**
 * Whether the seller may pick a product for this inquiry.
 *
 * Always, once the detail has loaded — including when one is already bound. An attribution the
 * channel made can still be wrong (the listing key moved, the mall reused a number), and a screen
 * that only offered the control while the field was empty would make a correction impossible without
 * a support ticket.
 */
export function canBindProduct(detail: InquiryDetail | null): boolean {
  return !!detail;
}

/**
 * Whether replacing the current binding needs a second confirmation.
 *
 * True only when the CHANNEL made the current one and the seller is choosing something else. Two
 * people disagreeing is ordinary; a person overruling the channel's own identifier is a claim about
 * the channel's data, and it should cost one more press than agreeing with it.
 */
export function needsOverrideConfirm(
  detail: Pick<InquiryDetail, "productId" | "productBinding">,
  nextProductId: string,
): boolean {
  return (
    detail.productBinding === SOURCE_EXACT &&
    !!detail.productId &&
    detail.productId !== nextProductId
  );
}

/** What to tell the seller when a bind attempt failed. */
export function bindErrorMessage(status: number | undefined, code?: string | null): string {
  if (code === SOURCE_BINDING_EXISTS) {
    return "이 문의는 채널이 알려준 상품 번호로 이미 연결돼 있습니다. 바꾸려면 한 번 더 확인해 주세요.";
  }
  if (status === 404) return "상품 또는 문의를 찾을 수 없습니다. 목록을 새로고침해 주세요.";
  if (status === 409) return "이 상품에는 문의를 연결할 수 없습니다.";
  if (status === 401 || status === 403) return "권한이 없습니다. 다시 로그인해 주세요.";
  return "상품을 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
