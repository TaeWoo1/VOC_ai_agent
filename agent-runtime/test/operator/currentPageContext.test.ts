/**
 * The screen the seller was standing on, carried into the run — Chat-first Agent Shell Completion v1 §9.
 *
 * <b>The seam existed and nothing travelled through it.</b> `agentContext` has carried
 * `{goal, productId, channelCode, surface}` into the `/agent` URL since Agent Command Center v1, and
 * the Agent page read it back — and then sent `goalText` alone. The product id died at the request
 * boundary. It was invisible because every screen that offers the link also writes the product's NAME
 * into the suggested sentence, so the planner resolved it by name and the answer looked right; what
 * the seller paid was a resolve call and the obligation to keep describing a product they were
 * already looking at. 「이 상품만 봐줘」 — the sentence with no name in it — could not work.
 *
 * <b>A hint is not a fact, and these tests are about that difference.</b> The id arrives from a URL,
 * so it proves nothing: not that the row exists, not that it is this org's, not what it is called. The
 * runtime spends one org-scoped read to turn it into a verified entity or drops it silently. Nothing
 * downstream can tell the result apart from an entity the run resolved by name, which is the property
 * that lets every scope invariant keep asking the question it already asked.
 */
import { describe, expect, it } from "vitest";
import { OperatorAgentRuntime } from "../../src/operator/operatorRuntime";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { twoInquiries } from "../support/fixtures";
import { fourIssues } from "../support/issueFixtures";
import {
  ANALYSES, CABLE, CUP_BIN, INBOX, KNOWLEDGE, MEMORY, MOLDING, REPEATS,
  coveredSignals, cupBinKnowledge, cupBinSignals, unlinkedSignals,
} from "../support/operatorFixtures";
import { RECORDED_PLANS, REPAIRED_PLANS } from "../support/recordedPlans";

const PRODUCT_GOAL = "전선몰딩 상품 요즘 문제 있어?";

function build() {
  const operator = new FakeOperatorSpringClient({
    inbox: INBOX,
    products: [MOLDING, CABLE, CUP_BIN],
    signals: {
      [MOLDING.id]: coveredSignals(),
      [CABLE.id]: unlinkedSignals(),
      [CUP_BIN.id]: cupBinSignals(),
    },
    knowledge: { ...KNOWLEDGE, [CUP_BIN.id]: cupBinKnowledge() },
    customerMemory: MEMORY,
    repeats: REPEATS,
    itemAnalyses: ANALYSES,
    plansByGoal: RECORDED_PLANS,
    repairedPlansByGoal: REPAIRED_PLANS,
  });
  return {
    operator,
    runtime: new OperatorAgentRuntime({
      operator,
      inquiry: new FakeSpringClient(twoInquiries()),
      issue: new FakeIssueSpringClient(fourIssues()),
    }),
  };
}

describe("§9 — the current entity reaches the run", () => {
  it("without the hint the run has to look the product up by name", async () => {
    const { operator, runtime } = build();

    await runtime.run("t-no-context", { text: PRODUCT_GOAL });

    // The control. This is what a seller pays today for a product they are already looking at.
    expect(operator.calls.products).toBeGreaterThan(0);
  });

  it("with the hint the product is already resolved — nothing is looked up by name", async () => {
    const { operator, runtime } = build();

    const result = await runtime.run("t-context", { text: PRODUCT_GOAL, productId: MOLDING.id });

    expect(operator.calls.products).toBe(0);
    // Resolved by a READ, not by assignment: the one call that verified the id is accounted for.
    expect(operator.calls.signals).toBeGreaterThan(0);
    expect(result.status).toBe("DONE");
  });

  it("an id this org cannot read is dropped in silence, and the run proceeds exactly as before", async () => {
    const { operator, runtime } = build();

    // A stale bookmark, a deleted product, another org's id — the fake refuses all three the same way
    // the org-scoped endpoint does.
    const result = await runtime.run("t-foreign", {
      text: PRODUCT_GOAL,
      productId: "00000000-0000-0000-0000-000000000000",
    });

    expect(result.status).toBe("DONE");
    // It fell back to resolving by name, which is the whole of "exactly as before".
    expect(operator.calls.products).toBeGreaterThan(0);
  });
});
