import type { TurnView } from "../lib/conversation/types";

/** A finished agent turn with one list artifact — enough to see rows on screen. Synthetic, no customer text. */
export function agentTurn(over: Partial<TurnView> = {}): TurnView {
  return {
    turnId: "t-agent-1",
    conversationId: "c-1",
    role: "AGENT",
    message: "이 상품에 미답변 문의는 없습니다.",
    artifacts: [
      {
        artifactId: "a-1",
        type: "LIST",
        title: "확인한 상품",
        items: [{ id: "p-1", primary: "선바로 몰딩", secondary: "미답변 문의 0", to: "/products/p-1" }],
      },
      {
        artifactId: "a-ev",
        type: "EVIDENCE",
        title: "확인한 자료",
        items: [{ label: "미답변 문의", count: 0, from: null, to: null, asOf: "2026-08-27", covered: true }],
      },
    ],
    suggestedActions: [{ label: "문의에서도 같은 문제가 있는지 봐줘", kind: "PROMPT", prompt: "문의에서도 같은 문제가 있는지 봐줘" }],
    continuation: { workingSet: null, pendingHumanAction: null, pendingPrepared: null },
    status: "DONE",
    createdAt: "2026-08-27T09:00:00Z",
    ...over,
  };
}

export const CAPS = {
  service: "x", version: "1", env: "test", intents: [], runStore: { kind: "memory", durable: false, multiInstanceSafe: false }, externalSend: "disabled",
} as const;
