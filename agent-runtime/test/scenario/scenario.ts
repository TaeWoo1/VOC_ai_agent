/**
 * <b>Multi-turn scenario eval — a conversation stated as data, run against the real assembly.</b>
 *
 * Agent Procedure Layer v1 §4. The runner is deliberately thin: it is a declarative layer over the
 * harness the conversation suites already use ({@code test/conversation/support.ts}), which runs the
 * real {@link ConversationService}, the real operator graph and the real planner + validator, with only
 * the TRANSPORT faked. Nothing here is a second execution path.
 *
 * <b>Why the format exists.</b> The architecture audit measured the cost of not having it: 38 test
 * files each assembled their own plan recordings, eight assembled their own coverage fixture, and every
 * QA defect arrived as a new file. The axis that actually distinguishes the answers — WHAT KIND OF SHOP
 * this is — was dissolved into those fixtures, so the same sentence could not be asked of a clean
 * seller and a working one and the two answers compared. {@link WORLD} makes that axis a parameter.
 *
 * <b>`never` is a first-class assertion.</b> Every symptom of the defect this layer was built for was a
 * sentence that should not have been said — 「지금 먼저 하실 일은 없습니다」 to a shop with no channels,
 * the capability card printed twice, a connect CTA at a seller who has connected everything. A format
 * that can only say what MUST appear cannot express any of them, so {@link Expectation.never} scans
 * everything the seller can see: the message, the notes, every artifact's title, lines, items and
 * labels, and every suggested action.
 *
 * <b>CI calls no vendor.</b> Plans are replayed at `planGoal` from {@link SCENARIO_PLANS}; a sentence
 * with no recording fails with that sentence printed, so adding a turn is «record it once, paste it in»
 * rather than «hand-write a plan to the wire schema».
 */
import { expect, it } from "vitest";
import type { TurnView } from "../../src/conversation/contract";
import { TOKEN, say } from "../conversation/support";
import { visibleTextOf, violationsOf, worldHarness } from "./grade";
import type { Expectation, Scenario } from "./grade";

export * from "./grade";

function assertTurn(turn: TurnView, e: Expectation, seen: readonly string[], sentence: string): void {
  const bad = violationsOf(turn, e, seen);
  expect(bad, `${sentence} → ${bad.join(" · ")}\n--- visible ---\n${visibleTextOf(turn)}`).toEqual([]);
}

/** Run one scenario as one `it`. The world is the parameter; the turns are the data. */
export function scenario(name: string, s: Scenario): void {
  it(`[${s.world}] ${name}`, async () => {
    const h = worldHarness(s.world);
    const { conversationId: id } = await h.service.create(TOKEN);
    const seen: string[] = [];
    for (const t of s.turns) {
      const { turn } = await say(h, id, t.say);
      // A sentence nobody recorded a plan for reaches the planner and is refused by the fake — which
      // would otherwise read as a product failure. Say which sentence, so recording it is the fix.
      if (turn.failureCode === "GOAL_UNSUPPORTED" && !t.expect.status) {
        throw new Error(`no recorded plan for «${t.say}» — record it once and add it to SCENARIO_PLANS`);
      }
      assertTurn(turn, t.expect, seen, t.say);
      seen.push(visibleTextOf(turn));
    }
  });
}
