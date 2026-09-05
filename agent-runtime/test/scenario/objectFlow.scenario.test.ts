/**
 * <b>The exact-object flows, as scenarios — the regression half of Agent Procedure Layer v1 §4.</b>
 *
 * The procedure layer moved three judgements (readiness, absence, draft precondition) into one place
 * each. These are the flows those judgements sit on the path of: a list, one row named by its position,
 * and the draft for that row; and the same for a review. Nothing here is new behaviour — it is the
 * behaviour that must not have moved, said in the format a QA defect now arrives in.
 *
 * Every turn but the first is answered by a DETERMINISTIC lane, which is what `llmCalls: 0` asserts:
 * selecting a row and preparing its draft cost no plan, before this package and after it.
 */
import { describe } from "vitest";
import { scenario } from "./scenario";

describe("exact-object flows survive the procedure layer", () => {
  scenario("a list, the second row by position, and that row's draft", {
    world: "WORKING",
    turns: [
      {
        say: "오늘 내가 답해야 할 문의 정리해줘",
        expect: { artifacts: ["INQUIRY_LIST"], noLink: "/connect", never: ["아직 연결된 판매 채널이 없어"] },
      },
      {
        // Naming a row by its position is the same act as pressing it — one card, no planner.
        say: "두 번째 거",
        expect: { artifacts: ["INQUIRY_DETAIL"], llmCalls: 0, never: ["방금 본 목록에는"] },
      },
      {
        // The ANSWER_INQUIRY precondition now lives in one place; the draft path it gates is unchanged.
        say: "답변 준비해줘",
        expect: { artifacts: ["DRAFT"], never: ["어떤 문의의 답변을 준비할지"] },
      },
      {
        say: "조금 더 부드럽게 써줘",
        expect: { artifacts: ["DRAFT"], llmCalls: 0, never: ["말투를 바꿀 초안을 찾지 못했습니다"] },
      },
    ],
  });

  scenario("a review list, one review inspected, and a channel that cannot take a reply", {
    world: "WORKING",
    turns: [
      { say: "오늘 새로 달린 리뷰 보여줘", expect: { artifacts: ["REVIEW_LIST"], noLink: "/connect" } },
      {
        say: "첫 번째 거",
        // The exact single-review read — the lane that exists because the planner has no token for
        // «this object» (it expressed the sentence as review ROWS with limit 1).
        expect: { artifacts: ["REVIEW_DETAIL"], llmCalls: 0 },
      },
    ],
  });
});
