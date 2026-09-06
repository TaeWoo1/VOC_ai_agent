/**
 * <b>First use — the same three turns, two worlds.</b>
 *
 * The conversations themselves live in {@link ./cases.ts}, so the benchmark grades the identical
 * turns with a live planner instead of a recording. This file is the CI half: recorded plans, no
 * vendor call, plus the one assertion that is about the PAIR of answers rather than either of them.
 */
import { describe, expect, it } from "vitest";
import { scenario, visibleTextOf, worldHarness } from "./scenario";
import { ABSENCE_LIE, ASK_WHAT_FIRST, FIRST_USE_CASES } from "./cases";
import { TOKEN, say } from "../conversation/support";

describe("first use — the same three turns, two worlds", () => {
  for (const c of FIRST_USE_CASES) scenario(c.name, c);
});

describe("the same question, the two worlds compared", () => {
  it("answers 「뭐부터 하면 되냐고」 differently for a shop with rows and a shop with none", async () => {
    const answers: Record<string, string> = {};
    for (const world of ["NO_CHANNEL", "WORKING"] as const) {
      const h = worldHarness(world);
      const { conversationId: id } = await h.service.create(TOKEN);
      answers[world] = visibleTextOf((await say(h, id, ASK_WHAT_FIRST)).turn);
    }
    expect(answers.NO_CHANNEL).not.toBe(answers.WORKING);
    // The difference is the point: one names the source that is missing, the other names the work.
    expect(answers.NO_CHANNEL).toContain("판매 채널 연결하기");
    expect(answers.WORKING).not.toContain("판매 채널 연결하기");
    // And neither of them says the sentence that started this package.
    expect(answers.NO_CHANNEL).not.toContain(ABSENCE_LIE);
  });
});
