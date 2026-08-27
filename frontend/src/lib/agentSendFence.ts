/**
 * Words that ask the Agent to SEND something.
 *
 * The runtime cannot send — its tool catalogue is READ-only and the Human Approval contract lives on
 * the inquiry screen — so 「답변 보내줘」 typed into the panel does not need to be refused; it needs to
 * be answered honestly before the seller waits twenty seconds for a planner to say the same thing.
 * This is a display rule, not a guard: the sentence still goes to the planner unchanged, and the fence
 * that actually prevents a WRITE is structural (`agentPanelWriteFence.test.tsx`).
 */
const SEND_WORDS = ["보내", "전송", "발송", "게시해", "올려", "등록해"] as const;

export function asksToSend(text: string): boolean {
  const t = text.replace(/\s+/g, "");
  return SEND_WORDS.some((w) => t.includes(w));
}

export const SEND_FENCE_COPY = "보내는 일은 AI 담당자가 하지 않습니다. 초안을 확인한 뒤 문의 화면의 승인 단계에서 보냅니다.";
