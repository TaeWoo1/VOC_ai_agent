/**
 * <b>The product owner's three sentences, asked of two different shops.</b>
 *
 * Agent Procedure Layer v1 §4. These are the exact turns measured live on 2026-09-05, in order, and
 * the whole reason the scenario format exists: before it, the clean-organisation defect and the
 * working-organisation regression could not be expressed as one thing asked twice.
 *
 * The four minimum guarantees, one `never` each:
 *   1. NO_CHANNEL never hears 「지금 먼저 하실 일은 없습니다」.
 *   2. A follow-up never repeats the capability card.
 *   3. A WORKING seller is never offered the connect step.
 *   4. Neither world is told about rows the other one has.
 */
import { describe, expect, it } from "vitest";
import { scenario, visibleTextOf, worldHarness } from "./scenario";
import { TOKEN, say } from "../conversation/support";

const ASK_CAPABILITY = "이 서비스를 통해 할 수 있는 일이 뭐야?";
const ASK_START = "아직 쇼핑몰을 연결하지 않았는데 어떻게 시작해?";
const ASK_WHAT_FIRST = "뭐부터 하면 되냐고";

/** 「없습니다」 said about rows that could not exist — the sentence this whole layer was built for. */
const ABSENCE_LIE = "지금 먼저 하실 일은 없습니다";

describe("first use — the same three turns, two worlds", () => {
  scenario("a seller who has connected nothing is told what to connect, not that there is nothing to do", {
    world: "NO_CHANNEL",
    turns: [
      {
        say: ASK_CAPABILITY,
        expect: {
          artifacts: ["SUMMARY"], says: ["판매 채널을 연결하시면", "아직 연결된 판매 채널이 없어"],
          link: "/connect",
          // Every prompt this answer used to offer asks about rows this org cannot have.
          never: ["답변 안 한 문의 보여줘", "별점 낮은 리뷰 보여줘", "최근 7일 매출 알려줘"],
        },
      },
      {
        say: ASK_START,
        expect: {
          artifacts: ["SUMMARY"], says: ["판매 채널을 연결하는 것부터"], link: "/connect", differsFrom: 0,
          // §2 — the capability card is a fact, and a fact is said once. Also: the local 도우미 is not
          // put in front of a seller who has not chosen a channel yet.
          never: ["제가 도와드릴 수 있는 일", "도우미"],
        },
      },
      {
        say: ASK_WHAT_FIRST,
        expect: {
          status: "DONE", artifacts: ["CHECKLIST"],
          // The zero cards go with the zero sentences.
          noArtifacts: ["INQUIRY_LIST", "REVIEW_LIST", "EVIDENCE"],
          says: ["아직 연결된 판매 채널이 없어서", "판매 채널 연결하기"],
          never: [ABSENCE_LIE, "0건"],
        },
      },
    ],
  });

  scenario("a seller who has connected everything is answered from rows, and never offered the connect step", {
    world: "WORKING",
    turns: [
      {
        say: ASK_CAPABILITY,
        expect: {
          artifacts: ["SUMMARY"], says: ["지금 연결된 채널은"],
          noLink: "/connect",
          never: ["아직 연결된 판매 채널이 없어", "판매 채널을 연결하시면"],
        },
      },
      {
        // §2 again, in the other world: a fact is said once whatever shop is asking. Measured live on
        // the Demo organisation (2026-09-06), this turn re-printed the whole card.
        say: ASK_START,
        expect: {
          noArtifacts: ["SUMMARY"], says: ["이미 연결돼 있습니다"], noLink: "/connect", differsFrom: 0,
          never: ["제가 도와드릴 수 있는 일", "판매 채널을 연결하는 것부터"],
        },
      },
      {
        say: ASK_WHAT_FIRST,
        expect: {
          status: "DONE", artifacts: ["CHECKLIST"], says: ["지금 하실 일을 정리했습니다"],
          noLink: "/connect",
          never: ["아직 연결된 판매 채널이 없어서", ABSENCE_LIE],
        },
      },
    ],
  });

  scenario("connected this morning and holding nothing yet — a third state, and it is not the other two", {
    world: "CONNECTED_NO_DATA",
    turns: [
      {
        say: ASK_WHAT_FIRST,
        expect: {
          status: "DONE", says: ["연결은 끝났고, 아직 가져온 자료가 없습니다"],
          // Neither the absence lie nor the step they have already taken.
          never: [ABSENCE_LIE, "아직 연결된 판매 채널이 없어서"],
          noLink: "/connect",
        },
      },
    ],
  });
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
